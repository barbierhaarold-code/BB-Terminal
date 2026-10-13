import { SERIES } from "./config";
import { US_SERIES } from "./usCatalog";
import type { SeriesDef } from "./types";

// Every indicator the Macro Hub knows: the G8 overview matrix plus the US deep coverage. The detail view, the
// Copilot tool and the /macro-proxy/series route resolve ids here.
export const ALL_SERIES: SeriesDef[] = [...SERIES, ...US_SERIES];
export const ALL_BY_ID: Record<string, SeriesDef> = Object.fromEntries(ALL_SERIES.map((s) => [s.id, s]));

/** Display name of any series: its own name, or the overview indicator name. */
export function seriesName(d: SeriesDef, indicatorName: Record<string, string>): string {
  return d.name ?? (d.indicator ? indicatorName[d.indicator] : d.label);
}
