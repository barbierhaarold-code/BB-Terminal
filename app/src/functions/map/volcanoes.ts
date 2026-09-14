// Volcano data comes from two free, keyless, CORS-open government sources —
// no single free feed covers both "where are the world's volcanoes" and
// "which ones are erupting right now":
//
// 1. NOAA NCEI Significant Volcanic Eruptions database (historical base
//    layer, worldwide). The Smithsonian GVP's own web services
//    (webservices.volcano.si.edu) were tried first and are unreliable from
//    this environment — repeated requests to its GeoServer WFS endpoint
//    connected but never returned a response (timed out at 40s, twice).
//    NOAA NCEI's `hazard-service` API is a stable, documented, no-key
//    government REST API (used by NOAA's own Natural Hazards Viewer) that
//    tracks the same class of events (verified confidence/deaths/damage
//    fields, VEI). It's a "significant eruptions" catalog, not a full list
//    of every Holocene volcano — that distinction is stated honestly in the
//    UI rather than presenting it as a complete volcano inventory.
//    https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/volcanoes
// 2. USGS Volcano Notification Service "elevated volcanoes" feed — genuine
//    real-time alert-level data (WATCH/WARNING/ADVISORY + color code),
//    limited to the ~161 volcanoes monitored by the five US volcano
//    observatories (Alaska/Cascades/Hawaii/Yellowstone/California). This is
//    the "USGS volcano hazards program... usable public feed" — it's real
//    and live, just US-only, which is disclosed rather than implied global.
//    https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated

export interface HistoricalVolcano {
  kind: "historical";
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  elevationM: number | null;
  morphology: string | null;
  lastEruptionYear: number;
  vei: number | null;
  deaths: number | null;
}

export interface LiveVolcanoAlert {
  kind: "live";
  id: string;
  name: string;
  lat: number;
  lon: number;
  observatory: string;
  alertLevel: string;
  colorCode: string;
  synopsis: string;
  url: string;
  updatedAt: number;
}

export type VolcanoMarker = HistoricalVolcano | LiveVolcanoAlert;

interface NoaaVolcanoItem {
  volcanoLocationId: number;
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  elevation: number | null;
  morphology: string | null;
  year: number;
  vei: number | null;
  deathsTotal: number | null;
}

const NOAA_BASE = "https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/volcanoes";

export async function fetchHistoricalVolcanoes(): Promise<HistoricalVolcano[]> {
  const first = await fetch(NOAA_BASE);
  if (!first.ok) throw new Error(`NOAA volcano feed failed: HTTP ${first.status}`);
  const firstJson = await first.json();
  const totalPages: number = firstJson.totalPages ?? 1;

  const rest = await Promise.all(
    Array.from({ length: Math.max(totalPages - 1, 0) }, (_, i) =>
      fetch(`${NOAA_BASE}?page=${i + 2}`).then((r) => (r.ok ? r.json() : { items: [] }))
    )
  );
  const allItems: NoaaVolcanoItem[] = [firstJson, ...rest].flatMap((page) => page.items ?? []);

  // One marker per volcano: keep the most recent significant eruption on
  // record for that location, since the same volcano can appear many times
  // across the centuries it's been erupting.
  const byLocation = new Map<number, NoaaVolcanoItem>();
  for (const item of allItems) {
    const existing = byLocation.get(item.volcanoLocationId);
    if (!existing || (item.year ?? -Infinity) > (existing.year ?? -Infinity)) {
      byLocation.set(item.volcanoLocationId, item);
    }
  }

  return Array.from(byLocation.values())
    .filter((v) => Number.isFinite(v.latitude) && Number.isFinite(v.longitude))
    .map((v) => ({
      kind: "historical" as const,
      id: `noaa-${v.volcanoLocationId}`,
      name: v.name,
      country: v.country,
      lat: v.latitude,
      lon: v.longitude,
      elevationM: v.elevation ?? null,
      morphology: v.morphology ?? null,
      lastEruptionYear: v.year,
      vei: v.vei ?? null,
      deaths: v.deathsTotal ?? null,
    }));
}

interface UsgsElevatedItem {
  vName: string;
  vnum: string;
  obs: string;
  lat: number;
  long: number;
  alertLevel: string;
  colorCode: string;
  noticeSynopsis: string;
  noticeUrl: string;
  sentUtc: string;
}

export async function fetchLiveVolcanoAlerts(): Promise<LiveVolcanoAlert[]> {
  const res = await fetch("https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated");
  if (!res.ok) throw new Error(`USGS volcano alert feed failed: HTTP ${res.status}`);
  const items: UsgsElevatedItem[] = await res.json();
  return items
    .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.long))
    .map((v) => ({
      kind: "live" as const,
      id: `usgs-${v.vnum}`,
      name: v.vName,
      lat: v.lat,
      lon: v.long,
      observatory: v.obs.toUpperCase(),
      alertLevel: v.alertLevel,
      colorCode: v.colorCode,
      synopsis: v.noticeSynopsis,
      url: v.noticeUrl,
      updatedAt: Date.parse(v.sentUtc.replace(" ", "T") + "Z") || Date.now(),
    }));
}

const USGS_COLOR: Record<string, string> = {
  GREEN: "#22ee22",
  YELLOW: "#eeb022",
  ORANGE: "#ff8c22",
  RED: "#ff3b3b",
};

export function volcanoAlertColor(colorCode: string): string {
  return USGS_COLOR[colorCode.toUpperCase()] ?? "#b45cff";
}

/** Merges the live USGS alert list into the historical base list: a live alert whose name+distance roughly matches an existing historical marker replaces it in place (so it isn't drawn twice); an unmatched live alert (a currently-active volcano with no entry in the "significant eruptions" catalog) is appended as its own marker. */
export function mergeVolcanoSources(historical: HistoricalVolcano[], live: LiveVolcanoAlert[]): VolcanoMarker[] {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const matched = new Set<string>();
  const merged: VolcanoMarker[] = historical.map((h) => {
    const hit = live.find(
      (l) =>
        !matched.has(l.id) &&
        (normalize(l.name) === normalize(h.name) || normalize(h.name).includes(normalize(l.name))) &&
        Math.abs(l.lat - h.lat) < 2 &&
        Math.abs(l.lon - h.lon) < 2
    );
    if (hit) {
      matched.add(hit.id);
      return hit;
    }
    return h;
  });
  for (const l of live) {
    if (!matched.has(l.id)) merged.push(l);
  }
  return merged;
}
