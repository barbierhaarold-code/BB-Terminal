import { canonicalPeriod, periodStart } from "../src/lib/macro/math";
import type { AdapterSeries, ErrorKind, Observation, SeriesDef } from "../src/lib/macro/types";
import { fetchWithTimeout } from "./shared";

// ────────────────────────────────────────────────────────────
// Macro adapters. An adapter turns a list of series definitions into NORMALIZED
// observations (canonical period, finite value, provider, source URL, refreshed-at,
// retrieved-at) and nothing else: no maths, no judgement. DBnomics lives here; the
// direct primary-source adapters live in macroDirect.ts. Adding one means implementing
// `MacroAdapter` and pointing a SeriesDef at it. The UI and the maths never see which
// adapter produced a series.
// ────────────────────────────────────────────────────────────

export interface MacroAdapter {
  id: string;
  /** How long the plugin may reuse this adapter's last answer; sized to how often the provider updates. Default 6 h. */
  cacheMs?: number;
  /** Fetch all `defs` for this adapter in as few upstream requests as possible. Throws with the real cause if the whole request fails. */
  fetchSeries(defs: SeriesDef[], nowMs: number): Promise<AdapterSeries[]>;
}

/** Thrown for an upstream rate-limit so the plugin can honour Retry-After. */
export class RateLimitedError extends Error {
  constructor(message: string, public retryAfterMs: number) { super(message); }
}

/** Thrown for a failure whose cause is more specific than "error" (missing/rejected key, bot challenge), so the page can say so. */
export class AdapterError extends Error {
  constructor(message: string, public kind: ErrorKind = "error") { super(message); }
}

/** Honest, generic User-Agent for every upstream request: names the tool and what it does, carries no personal data. */
export const USER_AGENT = "AbdelKhaderTerminal/1.0 (personal market-data terminal; reads public macro statistics; node)";
const API = "https://api.db.nomics.world/v22/series";
const UPSTREAM_TIMEOUT_MS = 30_000;
/** Enough history for the chart and for year-on-year (monthly/quarterly), without shipping 17k daily points per series. */
const KEEP: Record<SeriesDef["frequency"], number> = { daily: 1300, monthly: 360, quarterly: 160 };

interface DbnDoc {
  provider_code: string; dataset_code: string; series_code: string;
  indexed_at?: string; period?: string[]; value?: Array<number | string | null>;
}

export const dbnomicsAdapter: MacroAdapter = {
  id: "dbnomics",
  async fetchSeries(defs, nowMs) {
    const url = `${API}?series_ids=${encodeURIComponent(defs.map((d) => d.code).join(","))}&observations=1&metadata=0&limit=1000`;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } }, UPSTREAM_TIMEOUT_MS);
    } catch (err) {
      const e = err as Error;
      throw new Error(`DBnomics unreachable (${e.name === "TimeoutError" ? `no answer within ${UPSTREAM_TIMEOUT_MS / 1000}s` : e.message}).`);
    }
    const text = await res.text();
    let body: { message?: string; errors?: unknown; series?: { docs?: DbnDoc[] } } | null = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) {
      const cause = body?.message ?? text.slice(0, 160).replace(/\s+/g, " ");
      if (res.status === 429) {
        const ra = Number(res.headers.get("retry-after"));
        throw new RateLimitedError(`DBnomics answered HTTP 429 Too Many Requests${cause ? `: ${cause}` : ""}.`, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60_000);
      }
      throw new Error(`DBnomics answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}${cause ? `: ${cause}` : ""}.`);
    }
    if (!body?.series?.docs) throw new Error(`DBnomics answered HTTP ${res.status} but the body had no series (${(body?.message ?? text.slice(0, 120)) || "empty"}).`);
    const retrievedAt = new Date(nowMs).toISOString();
    const byCode = new Map(body.series.docs.map((d) => [`${d.provider_code}/${d.dataset_code}/${d.series_code}`, d]));
    return defs.map((def): AdapterSeries => {
      const doc = byCode.get(def.code);
      const common = { id: def.id, provider: def.provider, sourceUrl: `https://db.nomics.world/${def.code}`, retrievedAt };
      if (!doc) return { ...common, ok: false, error: `DBnomics did not return ${def.code} (series removed or renamed?).`, observations: [], refreshedAt: null };
      const obs: Observation[] = [];
      const seen = new Set<string>();
      const periods = doc.period ?? [], values = doc.value ?? [];
      for (let i = 0; i < periods.length; i++) {
        const v = values[i];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;          // "NA" placeholders and nulls are dropped, never filled
        const p = canonicalPeriod(periods[i], def.frequency);
        if (!p || seen.has(p)) continue;
        if (Date.parse(`${periodStart(p)}T00:00:00Z`) > nowMs) continue;       // a period that has not begun yet is not an observation
        seen.add(p);
        obs.push({ period: p, value: v });
      }
      obs.sort((a, b) => a.period.localeCompare(b.period));
      return { ...common, ok: obs.length > 0, error: obs.length ? undefined : "DBnomics returned the series but it has no values.", observations: obs.slice(-KEEP[def.frequency]), refreshedAt: doc.indexed_at ?? null };
    });
  },
};
