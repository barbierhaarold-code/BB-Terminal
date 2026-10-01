// GPS jamming/spoofing zones (MAP > GPS Jamming layer) — GPSJam.org's daily
// H3 (resolution 4) grid derived from ADS-B aircraft navigation-accuracy
// reports. Free, but a one-person hobby project with no continuity
// guarantee, so this proxy reports the data's date and age rather than
// pretending it's live: the client refuses to draw data older than
// STALE_AFTER_DAYS and says so.
// https://gpsjam.org/data/manifest.csv · https://gpsjam.org/data/YYYY-MM-DD-h3_4.csv
import type { Plugin } from "vite";
import { errMessage, fetchWithTimeout, middlewarePlugin, sendJson } from "./shared";

const BASE = "https://gpsjam.org/data";
const TTL_MS = 60 * 60_000; // upstream is daily with a 1h cache header
/** GPSJam's own colour thresholds: <2% bad aircraft = normal, 2–10% = medium, >10% = high. */
const MEDIUM = 0.02;
const HIGH = 0.1;
/** Cells with a tiny sample are noisy (1 aircraft reporting bad = 100%). */
const MIN_AIRCRAFT = 5;

let cache: { body: unknown; expires: number } | null = null;
let inflight: Promise<unknown> | null = null;

async function build() {
  const m = await fetchWithTimeout(`${BASE}/manifest.csv`);
  if (!m.ok) throw new Error(`GPSJam manifest returned HTTP ${m.status}`);
  const rows = (await m.text()).trim().split("\n").slice(1).map((l) => l.split(","));
  const last = rows[rows.length - 1];
  if (!last || !/^\d{4}-\d{2}-\d{2}$/.test(last[0])) throw new Error("GPSJam manifest had no usable dates");
  const date = last[0];
  const suspect = last[1] === "true";

  const d = await fetchWithTimeout(`${BASE}/${date}-h3_4.csv`, {}, 40_000);
  if (!d.ok) throw new Error(`GPSJam data for ${date} returned HTTP ${d.status}`);
  const lines = (await d.text()).trim().split("\n");
  if (!lines[0].startsWith("hex")) throw new Error("GPSJam data file had an unexpected format");

  const cells: { h: string; level: "medium" | "high"; pct: number; n: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const [hex, good, bad] = lines[i].split(",");
    const g = Number(good), b = Number(bad), n = g + b;
    if (!hex || !Number.isFinite(n) || n < MIN_AIRCRAFT) continue;
    const ratio = b / n;
    if (ratio >= MEDIUM) cells.push({ h: hex, level: ratio > HIGH ? "high" : "medium", pct: Math.round(ratio * 1000) / 10, n });
  }
  const ageDays = Math.floor((Date.now() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  return { results: cells, meta: { date, suspect, ageDays, totalCells: lines.length - 1 } };
}

export function gpsJamProxyPlugin(): Plugin {
  return middlewarePlugin("bbterminal-gpsjam-proxy", async (req, res, next) => {
    if (req.url !== "/gpsjam-proxy/cells" || req.method !== "GET") { next(); return; }
    try {
      if (!cache || cache.expires < Date.now()) {
        inflight ??= build().finally(() => { inflight = null; });
        cache = { body: await inflight, expires: Date.now() + TTL_MS };
      }
      sendJson(res, cache.body);
    } catch (err) {
      sendJson(res, { results: [], warnings: [{ message: `GPSJam source unavailable — ${errMessage(err)}` }] }, 502);
    }
  });
}
