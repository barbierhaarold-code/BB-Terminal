// GDELT 2.0 raw event dumps (MAP > Conflict & Events layer). GDELT publishes a
// new tab-delimited events file every 15 minutes at a predictable URL, free
// and with no key — we read those dumps directly instead of the rate-limited
// DOC/GEO APIs. Each 15-minute file is immutable once published, so parsed
// results are cached per file and a refresh only ever downloads the files
// that appeared since the last one.
// http://data.gdeltproject.org/gdeltv2/lastupdate.txt
import type { Plugin } from "vite";
import { errMessage, fetchWithTimeout, mapLimit, middlewarePlugin, readZip, sendJson } from "./shared";

const BASE = "https://data.gdeltproject.org/gdeltv2";
const WINDOW_FILES = 16; // 16 × 15 min = trailing 4 hours
const CONCURRENCY = 4;

// CAMEO event root codes we plot: 14 protest, 15 exhibit force posture,
// 17 coerce, 18 assault, 19 fight, 20 unconventional mass violence.
// (16 "reduce relations" is diplomatic noise, not physical conflict.)
const ROOT_CATEGORY: Record<string, string> = {
  "14": "Protest",
  "15": "Show of force",
  "17": "Coercion",
  "18": "Assault",
  "19": "Armed fighting",
  "20": "Mass violence",
};

export interface GdeltEvent {
  lat: number;
  lon: number;
  location: string;
  /** CAMEO root code, e.g. "19". */
  root: string;
  category: string;
  /** Number of distinct GDELT events merged at this place+category. */
  events: number;
  mentions: number;
  /** Epoch ms of the most recent contributing 15-minute batch. */
  latest: number;
}

interface RawEvent { lat: number; lon: number; location: string; root: string; mentions: number; batch: number }

const fileCache = new Map<string, RawEvent[]>();
let lastSnapshot: { events: GdeltEvent[]; files: number; asOf: number; expires: number } | null = null;
let inflight: Promise<NonNullable<typeof lastSnapshot>> | null = null;

function batchToEpoch(stamp: string): number {
  return Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12), +stamp.slice(12, 14));
}

function epochToBatch(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
}

function parseExport(csv: string, batch: number): RawEvent[] {
  const out: RawEvent[] = [];
  for (const line of csv.split("\n")) {
    const c = line.split("\t");
    if (c.length < 58) continue;
    const root = c[28];
    if (!(root in ROOT_CATEGORY)) continue;
    const lat = Number(c[56]);
    const lon = Number(c[57]);
    if (c[56] === "" || c[57] === "" || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // ActionGeo_Type 1 = country centroid only: no real location, would stack hundreds of "events" on one dot.
    if (c[51] === "1") continue;
    out.push({ lat, lon, location: c[52], root, mentions: Number(c[31]) || 1, batch });
  }
  return out;
}

async function loadFile(stamp: string): Promise<RawEvent[]> {
  const cached = fileCache.get(stamp);
  if (cached) return cached;
  const r = await fetchWithTimeout(`${BASE}/${stamp}.export.CSV.zip`, {}, 25_000);
  // Occasionally a 15-minute slot is skipped upstream (404) — not an error for the layer as a whole.
  if (r.status === 404) { fileCache.set(stamp, []); return []; }
  if (!r.ok) throw new Error(`GDELT file ${stamp} returned HTTP ${r.status}`);
  const files = readZip(Buffer.from(await r.arrayBuffer()));
  const entry = [...files.values()][0];
  if (!entry) throw new Error(`GDELT file ${stamp} was empty`);
  const events = parseExport(entry.toString("utf8"), batchToEpoch(stamp));
  fileCache.set(stamp, events);
  return events;
}

async function build() {
  const last = await fetchWithTimeout(`${BASE}/lastupdate.txt`);
  if (!last.ok) throw new Error(`GDELT lastupdate.txt returned HTTP ${last.status}`);
  const m = (await last.text()).match(/(\d{14})\.export\.CSV\.zip/);
  if (!m) throw new Error("GDELT lastupdate.txt had no events file listed");
  const newest = batchToEpoch(m[1]);
  const stamps = Array.from({ length: WINDOW_FILES }, (_, i) => epochToBatch(newest - i * 15 * 60_000));
  for (const key of fileCache.keys()) if (!stamps.includes(key)) fileCache.delete(key);

  const settled = await mapLimit(stamps, CONCURRENCY, loadFile);
  const loaded = settled.filter((s): s is PromiseFulfilledResult<RawEvent[]> => s.status === "fulfilled");
  if (loaded.length === 0) {
    const firstErr = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
    throw new Error(errMessage(firstErr?.reason ?? "no GDELT files could be fetched"));
  }

  // Merge to one marker per place+category so a city with 200 reports is one dot, not 200.
  const groups = new Map<string, GdeltEvent>();
  for (const s of loaded) {
    for (const e of s.value) {
      const key = `${e.lat.toFixed(2)},${e.lon.toFixed(2)},${e.root}`;
      const g = groups.get(key);
      if (g) { g.events++; g.mentions += e.mentions; g.latest = Math.max(g.latest, e.batch); }
      else groups.set(key, { lat: e.lat, lon: e.lon, location: e.location, root: e.root, category: ROOT_CATEGORY[e.root], events: 1, mentions: e.mentions, latest: e.batch });
    }
  }
  return { events: [...groups.values()], files: loaded.length, asOf: newest, expires: Date.now() + 5 * 60_000 };
}

export function gdeltProxyPlugin(): Plugin {
  return middlewarePlugin("bbterminal-gdelt-proxy", async (req, res, next) => {
    if (req.url !== "/gdelt-proxy/events" || req.method !== "GET") { next(); return; }
    try {
      if (!lastSnapshot || lastSnapshot.expires < Date.now()) {
        inflight ??= build().finally(() => { inflight = null; });
        lastSnapshot = await inflight;
      }
      const { events, files, asOf } = lastSnapshot;
      sendJson(res, { results: events, meta: { files, windowFiles: WINDOW_FILES, asOf } });
    } catch (err) {
      sendJson(res, { results: [], warnings: [{ message: `GDELT feed unavailable — ${errMessage(err)}` }] }, 502);
    }
  });
}
