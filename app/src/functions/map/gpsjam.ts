// GPS jamming/spoofing zones from GPSJam.org's daily H3 grid (ADS-B derived),
// via gpsJamProxyPlugin. A one-person hobby project with no continuity
// guarantee — the layer shows the data's date, and refuses to draw data that
// is older than STALE_AFTER_DAYS rather than present it as current.
// https://gpsjam.org/
import { fetchProxyJson } from "./proxyFetch";

export const STALE_AFTER_DAYS = 3;

export interface JamCell { h: string; level: "medium" | "high"; pct: number; n: number }
export interface GpsJamResult {
  cells: JamCell[];
  date: string;
  ageDays: number;
  suspect: boolean;
  stale: boolean;
}

export const JAM_COLOR = { medium: "#eeb022", high: "#ff3b3b" } as const;

export async function fetchGpsJam(): Promise<GpsJamResult> {
  const json = await fetchProxyJson<{ results: JamCell[]; meta: { date: string; ageDays: number; suspect: boolean } }>("/gpsjam-proxy/cells", "GPSJam feed");
  return { cells: json.results, date: json.meta.date, ageDays: json.meta.ageDays, suspect: json.meta.suspect, stale: json.meta.ageDays > STALE_AFTER_DAYS };
}
