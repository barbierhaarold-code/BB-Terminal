// GDELT 2.0 conflict & protest events, read from GDELT's raw 15-minute CSV
// dumps (free, no key, commercially usable) via gdeltProxyPlugin. Event types
// are CAMEO root codes, collapsed to six plain-language categories.
// https://www.gdeltproject.org/data.html
import { fetchProxyJson } from "./proxyFetch";

export interface GdeltEvent {
  lat: number;
  lon: number;
  location: string;
  root: string;
  category: string;
  events: number;
  mentions: number;
  latest: number;
}

export interface GdeltResult {
  events: GdeltEvent[];
  files: number;
  windowFiles: number;
  asOf: number;
}

export const GDELT_CATEGORY_COLOR: Record<string, string> = {
  Protest: "#22ccee",
  "Show of force": "#eeb022",
  Coercion: "#ff8c22",
  Assault: "#ff5c1f",
  "Armed fighting": "#ff3b3b",
  "Mass violence": "#ff3b3b",
};

export async function fetchGdelt(): Promise<GdeltResult> {
  const json = await fetchProxyJson<{ results: GdeltEvent[]; meta: { files: number; windowFiles: number; asOf: number } }>("/gdelt-proxy/events", "GDELT feed");
  return { events: json.results, ...json.meta };
}

export function gdeltRadius(e: GdeltEvent): number {
  return Math.max(3, Math.min(14, 2.5 + Math.log2(1 + e.mentions) * 1.3));
}
