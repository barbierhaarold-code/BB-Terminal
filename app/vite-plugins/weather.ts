// Weather alerts (MAP > Weather Alerts layer) — three regional official feeds,
// deliberately NOT global:
//   US      NOAA/NWS api.weather.gov            (free, no key, needs a User-Agent)
//   Europe  MeteoAlarm feeds.meteoalarm.org     (free; areas are NUTS3 codes → geometry from Eurostat GISCO)
//   Canada  Environment Canada api.weather.gc.ca (free OGC API, polygons included)
// Each region is fetched independently and reported with its own status, so
// one feed being down degrades only that region instead of the whole layer.
import type { Plugin } from "vite";
import { errMessage, fetchWithTimeout, mapLimit, middlewarePlugin, sendJson } from "./shared";

const UA = "BB-Terminal/1.0 (personal terminal; contact via github.com/barbierhaarold-code)";
const TTL_MS = 5 * 60_000;

type Ring = [number, number][]; // [lat, lon] — Leaflet order
export type Severity = "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";

export interface WeatherAlert {
  id: string;
  region: "us" | "eu" | "ca";
  event: string;
  severity: Severity;
  headline: string;
  area: string;
  onset: string | null;
  expires: string | null;
  source: string;
  /** Representative point for the marker. */
  lat: number;
  lon: number;
  /** Simplified outline(s), lat/lon. May be empty if only a point is known. */
  rings: Ring[];
}

interface RegionStatus { status: "ok" | "error"; count: number; error?: string }

type GeoGeometry = { type: string; coordinates: any } | null;

/** Flattens Polygon/MultiPolygon GeoJSON into simplified outer rings in Leaflet [lat, lon] order. */
function geometryToRings(g: GeoGeometry, maxPoints = 40): Ring[] {
  if (!g) return [];
  const polys: number[][][][] = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.map((poly) => {
    const outer = poly[0] ?? [];
    const step = Math.max(1, Math.ceil(outer.length / maxPoints));
    const ring: Ring = [];
    for (let i = 0; i < outer.length; i += step) ring.push([Math.round(outer[i][1] * 100) / 100, Math.round(outer[i][0] * 100) / 100]);
    return ring;
  }).filter((r) => r.length >= 3);
}

function ringsCentre(rings: Ring[]): { lat: number; lon: number } | null {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180, any = false;
  for (const ring of rings) for (const [lat, lon] of ring) {
    any = true;
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  }
  return any ? { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 } : null;
}

const SEVERITY_RANK: Record<Severity, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
function normSeverity(s: string | undefined): Severity {
  return s === "Extreme" || s === "Severe" || s === "Moderate" || s === "Minor" ? s : "Unknown";
}

// ── US (NWS) ────────────────────────────────────────────────────────────
// ~70% of active NWS alerts carry no polygon, only a list of forecast-zone
// URLs, so zone geometry is fetched once and cached for the process lifetime
// (zone boundaries are effectively static).
const zoneCache = new Map<string, Ring[] | null>();

async function loadZone(url: string): Promise<Ring[]> {
  if (zoneCache.has(url)) return zoneCache.get(url) ?? [];
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/geo+json" } }, 15_000);
  if (!r.ok) throw new Error(`NWS zone ${url.split("/").pop()} HTTP ${r.status}`);
  const j = await r.json();
  const rings = geometryToRings(j.geometry, 24);
  zoneCache.set(url, rings);
  return rings;
}

async function fetchUs(): Promise<WeatherAlert[]> {
  const r = await fetchWithTimeout("https://api.weather.gov/alerts/active?status=actual&message_type=alert", {
    headers: { "User-Agent": UA, Accept: "application/geo+json" },
  }, 30_000);
  if (!r.ok) throw new Error(`NWS returned HTTP ${r.status}`);
  const j = await r.json();
  const features: any[] = j.features ?? [];

  const needZones = new Set<string>();
  for (const f of features) if (!f.geometry) for (const z of f.properties.affectedZones ?? []) if (!zoneCache.has(z)) needZones.add(z);
  await mapLimit([...needZones], 8, loadZone); // individual zone failures just leave that zone unmapped

  const out: WeatherAlert[] = [];
  for (const f of features) {
    const p = f.properties;
    let rings = geometryToRings(f.geometry, 60);
    if (rings.length === 0) rings = (p.affectedZones ?? []).flatMap((z: string) => zoneCache.get(z) ?? []);
    const c = ringsCentre(rings);
    if (!c) continue; // can't place it on a map → don't fake a position
    out.push({
      id: p.id, region: "us", event: p.event, severity: normSeverity(p.severity),
      headline: p.headline ?? p.event, area: p.areaDesc ?? "",
      onset: p.onset ?? p.effective ?? null, expires: p.ends ?? p.expires ?? null,
      source: p.senderName ?? "NWS", lat: c.lat, lon: c.lon,
      rings: rings.length > 12 ? rings.slice(0, 12) : rings,
    });
  }
  return out;
}

// ── Canada (ECCC) ───────────────────────────────────────────────────────
async function fetchCa(): Promise<WeatherAlert[]> {
  const r = await fetchWithTimeout("https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=1000", {}, 30_000);
  if (!r.ok) throw new Error(`Environment Canada returned HTTP ${r.status}`);
  const j = await r.json();
  const now = Date.now();
  const out: WeatherAlert[] = [];
  for (const f of j.features ?? []) {
    const p = f.properties;
    if (p.expiration_datetime && Date.parse(p.expiration_datetime) < now) continue;
    // ECCC types: warning / watch / advisory / statement / ended
    if (p.alert_type === "ended") continue;
    const rings = geometryToRings(f.geometry, 40);
    const c = ringsCentre(rings);
    if (!c) continue;
    const sev: Severity = p.alert_type === "warning" ? "Severe" : p.alert_type === "watch" ? "Moderate" : "Minor";
    out.push({
      id: f.id, region: "ca", event: p.alert_name_en ?? p.alert_short_name_en ?? "Alert", severity: sev,
      headline: p.alert_name_en ?? "Alert", area: p.feature_name_en ?? p.province ?? "",
      onset: p.validity_datetime ?? p.publication_datetime ?? null, expires: p.expiration_datetime ?? null,
      source: "Environment Canada", lat: c.lat, lon: c.lon, rings,
    });
  }
  return out;
}

// ── Europe (MeteoAlarm) ─────────────────────────────────────────────────
const METEOALARM_COUNTRIES = [
  "austria", "belgium", "bosnia-herzegovina", "bulgaria", "croatia", "cyprus", "czechia", "denmark", "estonia",
  "finland", "france", "germany", "greece", "hungary", "iceland", "ireland", "israel", "italy", "latvia",
  "lithuania", "luxembourg", "malta", "moldova", "montenegro", "netherlands", "north-macedonia", "norway",
  "poland", "portugal", "romania", "serbia", "slovakia", "slovenia", "spain", "sweden", "switzerland",
  "united-kingdom",
];
let nutsCache: Map<string, Ring[]> | null = null;

async function loadNuts(): Promise<Map<string, Ring[]>> {
  if (nutsCache) return nutsCache;
  const r = await fetchWithTimeout("https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_60M_2021_4326_LEVL_3.geojson", {}, 30_000);
  if (!r.ok) throw new Error(`Eurostat GISCO NUTS boundaries returned HTTP ${r.status}`);
  const j = await r.json();
  const m = new Map<string, Ring[]>();
  for (const f of j.features ?? []) m.set(f.properties.NUTS_ID, geometryToRings(f.geometry, 30));
  nutsCache = m;
  return m;
}

const AWARENESS_SEVERITY: Record<string, Severity> = { "2": "Minor", "3": "Moderate", "4": "Severe" }; // 2 yellow · 3 orange · 4 red

async function fetchEu(): Promise<{ alerts: WeatherAlert[]; failedCountries: string[] }> {
  const [nuts, feeds] = await Promise.all([
    loadNuts(),
    mapLimit(METEOALARM_COUNTRIES, 6, async (c) => {
      const r = await fetchWithTimeout(`https://feeds.meteoalarm.org/api/v1/warnings/feeds-${c}`, { headers: { "User-Agent": UA } }, 20_000);
      if (!r.ok) throw new Error(`MeteoAlarm ${c} HTTP ${r.status}`);
      return (await r.json()) as { warnings?: any[] };
    }),
  ]);
  const okFeeds = feeds.filter((f): f is PromiseFulfilledResult<{ warnings?: any[] }> => f.status === "fulfilled");
  if (okFeeds.length === 0) throw new Error("MeteoAlarm feeds unreachable for every country");

  const now = Date.now();
  const out: WeatherAlert[] = [];
  for (const feed of okFeeds) {
    for (const w of feed.value.warnings ?? []) {
      const infos: any[] = w.alert?.info ?? [];
      const info = infos.find((i) => /^en/i.test(i.language ?? "")) ?? infos[0];
      if (!info) continue;
      // The feed also carries expired, future-dated and "green/all clear" entries — only yellow-or-above, currently active.
      const level = String(info.parameter?.find((p: any) => p.valueName === "awareness_level")?.value ?? "").split(";")[0].trim();
      const severity = AWARENESS_SEVERITY[level];
      if (!severity) continue;
      if (!(Date.parse(info.expires) > now) || !(Date.parse(info.onset ?? info.effective) <= now + 24 * 3_600_000)) continue;
      const areas: any[] = info.area ?? [];
      const rings = areas.flatMap((a) => (a.geocode ?? []).flatMap((g: any) => nuts.get(g.value) ?? []));
      const c = ringsCentre(rings);
      if (!c) continue;
      out.push({
        id: `${w.alert.identifier}:${severity}:${info.event}`, region: "eu", event: info.event ?? "Warning", severity,
        headline: info.headline ?? info.event ?? "Warning",
        area: areas.map((a) => a.areaDesc).filter(Boolean).slice(0, 6).join(", ") + (areas.length > 6 ? ` +${areas.length - 6} more` : ""),
        onset: info.onset ?? null, expires: info.expires ?? null,
        source: info.senderName ?? "MeteoAlarm", lat: c.lat, lon: c.lon,
        rings: rings.length > 12 ? rings.slice(0, 12) : rings,
      });
    }
  }
  return { alerts: out, failedCountries: METEOALARM_COUNTRIES.filter((_, i) => feeds[i].status === "rejected") };
}

// ── Aggregate ───────────────────────────────────────────────────────────
let cache: { body: unknown; expires: number } | null = null;
let inflight: Promise<unknown> | null = null;

async function build() {
  const [us, eu, ca] = await Promise.allSettled([fetchUs(), fetchEu(), fetchCa()]);
  const regions: Record<string, RegionStatus> = {};
  const alerts: WeatherAlert[] = [];
  const take = (key: "us" | "eu" | "ca", s: PromiseSettledResult<WeatherAlert[]>, note?: string) => {
    if (s.status === "fulfilled") { alerts.push(...s.value); regions[key] = { status: "ok", count: s.value.length, ...(note ? { error: note } : {}) }; }
    else regions[key] = { status: "error", count: 0, error: errMessage(s.reason) };
  };
  take("us", us);
  take("ca", ca);
  if (eu.status === "fulfilled") take("eu", { status: "fulfilled", value: eu.value.alerts }, eu.value.failedCountries.length ? `no feed: ${eu.value.failedCountries.join(", ")}` : undefined);
  else take("eu", eu as PromiseRejectedResult);
  alerts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return { results: alerts, regions, fetchedAt: Date.now() };
}

export function weatherProxyPlugin(): Plugin {
  return middlewarePlugin("bbterminal-weather-proxy", async (req, res, next) => {
    if (req.url !== "/weather-proxy/alerts" || req.method !== "GET") { next(); return; }
    try {
      if (!cache || cache.expires < Date.now()) {
        inflight ??= build().finally(() => { inflight = null; });
        cache = { body: await inflight, expires: Date.now() + TTL_MS };
      }
      sendJson(res, cache.body);
    } catch (err) {
      sendJson(res, { results: [], warnings: [{ message: errMessage(err) }] }, 502);
    }
  });
}
