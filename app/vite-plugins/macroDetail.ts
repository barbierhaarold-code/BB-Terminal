import type { AdapterSeries, Observation, SeriesDef } from "../src/lib/macro/types";
import {
  firstReleases, measureReactions, recessionRanges, revisionsFor,
  type AssetSeries, type MacroDetail, type VintageRow,
} from "../src/lib/macro/detail";
import { canonicalPeriod } from "../src/lib/macro/math";
import type { MacroAdapter } from "./macroAdapters";
import { RateLimitedError, USER_AGENT } from "./macroAdapters";
import { fiscaldataAdapter, fredGet, scrub } from "./macroDirect";
import { errMessage, fetchWithTimeout } from "./shared";

// ────────────────────────────────────────────────────────────
// Detail view data for ONE indicator (/macro-proxy/series?id=…). Budget per first click on a FRED series: history
// (with its release date) + series metadata + release id + ALFRED vintages = 4 FRED requests, plus the release
// calendar once per release (12 h). Shared, once a day: NBER recession months and the three market series used for
// release-day reactions. Everything is cached (6 h per indicator) and single-flighted, so repeated clicks, overlays
// and the Copilot reuse the same answer. Non-FRED series reuse their own adapter (one request) and say plainly that
// revisions are not tracked.
// ────────────────────────────────────────────────────────────

const DETAIL_TTL_MS = 6 * 60 * 60_000;
const SHARED_TTL_MS = 24 * 60 * 60_000;
const RELEASE_TTL_MS = 12 * 60 * 60_000;
const FAILURE_COOLDOWN_MS = 30_000;
const REACTION_FROM = "2010-01-01";
const VINTAGE_FROM = "2008-01-01";
const OPENBB = (process.env.OPENBB_URL?.replace(/\/+$/, "") || "http://127.0.0.1:6900");

/** Headline US releases whose next dates come from FRED's release calendar (ids verified 2026-10-13). */
export const US_RELEASES: Array<{ id: number; name: string; series: string[] }> = [
  { id: 50, name: "Employment Situation (payrolls, unemployment, earnings)", series: ["us.payrolls", "us.unemp", "us.ahe"] },
  { id: 10, name: "Consumer Price Index", series: ["us.cpi", "us.core"] },
  { id: 46, name: "Producer Price Index", series: ["us.ppi"] },
  { id: 53, name: "Gross Domestic Product", series: ["us.gdp"] },
  { id: 54, name: "Personal Income and Outlays (PCE prices)", series: ["us.pce", "us.pcecore"] },
  { id: 9, name: "Advance Retail Sales", series: ["us.retail"] },
  { id: 180, name: "Unemployment Insurance Weekly Claims", series: ["us.claims"] },
  { id: 192, name: "Job Openings and Labor Turnover Survey", series: ["us.jolts"] },
  { id: 11, name: "Employment Cost Index", series: ["us.eci"] },
  { id: 188, name: "Import and Export Price Indexes", series: ["us.importpx"] },
  { id: 13, name: "G.17 Industrial Production and Capacity Utilization", series: ["us.indpro"] },
  { id: 95, name: "Manufacturers' Shipments, Inventories, and Orders", series: ["us.durables"] },
  { id: 27, name: "New Residential Construction", series: ["us.starts"] },
  { id: 97, name: "New Residential Sales", series: ["us.newhomes"] },
  { id: 51, name: "U.S. International Trade in Goods and Services", series: ["us.trade"] },
  { id: 20, name: "H.4.1 Factors Affecting Reserve Balances", series: ["us.fedassets"] },
  { id: 21, name: "H.6 Money Stock Measures", series: ["us.m2"] },
  { id: 14, name: "G.19 Consumer Credit", series: ["us.conscredit"] },
  { id: 363, name: "Monthly Treasury Statement", series: ["us.deficit"] },
  { id: 321, name: "Empire State Manufacturing Survey", series: ["us.empire"] },
  { id: 351, name: "Philadelphia Fed Manufacturing Business Outlook Survey", series: ["us.philly"] },
];

export interface UsCalendarRow { releaseId: number; name: string; series: string[]; next: string | null; error?: string }

export interface DetailService {
  get(id: string): Promise<{ detail: MacroDetail; cacheState: "HIT" | "MISS" }>;
  /** loads the shared once-a-day data (recession dates, reaction market series) in the background */
  prewarm(): void;
  /** next scheduled date of each headline US release (FRED release calendar; cached 12 h per release) */
  calendar(): Promise<UsCalendarRow[]>;
}

interface Cached<T> { value: T; expires: number }

export function createDetailService(o: {
  defs: Record<string, SeriesDef>;
  adapters: Map<string, MacroAdapter>;
  fredKey?: string;
  now?: () => number;
  /** test seam: replaces the gold fetch (OpenBB) */
  goldFetcher?: (fromIso: string) => Promise<Observation[]>;
}): DetailService {
  const now = o.now ?? Date.now;
  const key = o.fredKey?.trim() || undefined;
  const cache = new Map<string, Cached<MacroDetail>>();
  const inflight = new Map<string, Promise<MacroDetail>>();
  const failures = new Map<string, { message: string; until: number }>();
  const releaseIds = new Map<string, Cached<{ id: number; name: string; link: string | null } | null>>();
  const releaseDates = new Map<number, Cached<string[]>>();
  let usrec: Cached<Array<[string, string]>> | null = null;
  let assets: Cached<{ list: AssetSeries[]; missing: string[] }> | null = null;
  let sharedInflight: Promise<unknown> | null = null;

  const secrets = [key];
  const clean = (e: unknown) => scrub(errMessage(e), secrets);

  async function fredObs(code: string, q: string): Promise<Array<{ date: string; value: string; realtime_start: string; realtime_end: string }>> {
    const j = await fredGet<{ observations?: Array<{ date: string; value: string; realtime_start: string; realtime_end: string }> }>(`series/observations?series_id=${encodeURIComponent(code)}&${q}`, key!);
    return j.observations ?? [];
  }
  const num = (v: string) => (v === "." || v.trim() === "" ? NaN : Number(v));

  async function sharedData(t: number) {
    if (usrec && usrec.expires > t && assets && assets.expires > t) return;
    if (sharedInflight) { await sharedInflight; return; }
    sharedInflight = (async () => {
      if (!usrec || usrec.expires <= t) {
        try {
          const rows = await fredObs("USREC", "observation_start=1900-01-01");
          const obs = rows.map((r) => ({ period: canonicalPeriod(r.date, "monthly") ?? "", value: num(r.value) })).filter((x) => x.period && Number.isFinite(x.value));
          usrec = { value: recessionRanges(obs), expires: t + SHARED_TTL_MS };
        } catch { usrec = { value: [], expires: t + FAILURE_COOLDOWN_MS }; }
      }
      if (!assets || assets.expires <= t) {
        const list: AssetSeries[] = [], missing: string[] = [];
        const daily = async (code: string) => {
          const m = new Map<string, number>();
          for (const r of await fredObs(code, `observation_start=${+REACTION_FROM.slice(0, 4) - 1}-12-01`)) { const v = num(r.value); if (Number.isFinite(v)) m.set(r.date, v); }
          return m;
        };
        try { list.push({ id: "DGS2", label: "2-year Treasury yield", unit: "bp", source: "FRED DGS2 (Board of Governors, H.15; end-of-day constant maturity)", points: await daily("DGS2") }); }
        catch (e) { missing.push(`2-year Treasury yield (FRED DGS2): ${clean(e)}`); }
        try { list.push({ id: "DTWEXBGS", label: "US dollar (Fed broad index)", unit: "%", proxyNote: "proxy for DXY: the Federal Reserve Board's Nominal Broad U.S. Dollar Index (H.10, based on noon New York rates). DXY itself is an ICE index that is not free", source: "FRED DTWEXBGS (Board of Governors, H.10)", points: await daily("DTWEXBGS") }); }
        catch (e) { missing.push(`US dollar index (FRED DTWEXBGS): ${clean(e)}`); }
        try {
          const g = o.goldFetcher ? await o.goldFetcher(`${+REACTION_FROM.slice(0, 4) - 1}-12-01`) : await openbbGold(`${+REACTION_FROM.slice(0, 4) - 1}-12-01`);
          list.push({ id: "GOLD", label: "Gold", unit: "%", proxyNote: "proxy for spot gold: COMEX front-month gold futures (GC=F) daily close, from Yahoo Finance through this terminal's OpenBB backend", source: "Yahoo Finance GC=F via OpenBB", points: new Map(g.map((x) => [x.period, x.value])) });
        } catch (e) { missing.push(`Gold (GC=F via OpenBB): ${clean(e)}`); }
        assets = { value: { list, missing }, expires: t + (list.length === 3 ? SHARED_TTL_MS : FAILURE_COOLDOWN_MS * 10) };
      }
    })().finally(() => { sharedInflight = null; });
    await sharedInflight;
  }

  async function openbbGold(from: string): Promise<Observation[]> {
    const res = await fetchWithTimeout(`${OPENBB}/api/v1/equity/price/historical?symbol=${encodeURIComponent("GC=F")}&provider=yfinance&start_date=${from}`, { headers: { "user-agent": USER_AGENT } }, 30_000);
    if (!res.ok) throw new Error(`OpenBB answered HTTP ${res.status}.`);
    const j = await res.json() as { results?: Array<{ date: string; close: number }> };
    const out = (j.results ?? []).filter((r) => Number.isFinite(r.close)).map((r) => ({ period: String(r.date).slice(0, 10), value: r.close }));
    if (!out.length) throw new Error("OpenBB returned no gold closes.");
    return out;
  }

  async function releaseOf(code: string, t: number) {
    const c = releaseIds.get(code);
    if (c && c.expires > t) return c.value;
    const j = await fredGet<{ releases?: Array<{ id: number; name: string; link?: string }> }>(`series/release?series_id=${encodeURIComponent(code)}`, key!);
    const r = j.releases?.[0];
    const v = r ? { id: r.id, name: r.name, link: r.link ?? null } : null;
    releaseIds.set(code, { value: v, expires: t + 7 * SHARED_TTL_MS });
    return v;
  }
  async function datesOf(id: number, t: number): Promise<string[]> {
    const c = releaseDates.get(id);
    if (c && c.expires > t) return c.value;
    const today = new Date(t).toISOString().slice(0, 10);
    const j = await fredGet<{ release_dates?: Array<{ date: string }> }>(`release/dates?release_id=${id}&realtime_start=${today}&include_release_dates_with_no_data=true&sort_order=asc&limit=6`, key!);
    const v = (j.release_dates ?? []).map((d) => d.date).filter((d) => d >= today);
    releaseDates.set(id, { value: v, expires: t + RELEASE_TTL_MS });
    return v;
  }

  async function build(def: SeriesDef, t: number): Promise<MacroDetail> {
    const warnings: string[] = [];
    const base: MacroDetail = {
      id: def.id, fetchedAt: new Date(t).toISOString(), history: [], provider: def.provider, sourceUrl: "", refreshedAt: null, fredMeta: null, release: null,
      revisions: { available: false, reason: "" }, reaction: { available: false, reason: "" }, recessions: null, warnings,
    };
    const isFred = def.adapter === "fred";
    if (isFred && !key) throw new Error("API key missing: FRED_API_KEY is not set. Add it to app/.env and restart the dev server.");

    // Independent requests start together (each still goes through the shared FRED budget).
    const wantsVintages = isFred && def.vintages !== false && def.frequency !== "daily";
    const vintageRows = wantsVintages ? fredObs(def.code, `realtime_start=1776-07-04&realtime_end=9999-12-31&observation_start=${VINTAGE_FROM}`) : null;
    vintageRows?.catch(() => undefined); // awaited below; avoids an unhandled rejection while history loads
    const metaP = isFred ? fredGet<{ seriess?: Array<{ title: string; units: string; seasonal_adjustment: string; last_updated: string; observation_start: string; observation_end: string }> }>(`series?series_id=${encodeURIComponent(def.code)}`, key!) : null;
    metaP?.catch(() => undefined);
    const releaseP = isFred && def.economy === "US" ? releaseOf(def.code, t) : null;
    releaseP?.catch(() => undefined);
    const sharedP = def.economy === "US" ? sharedData(t) : null;

    // ── history ──
    if (isFred) {
      const rtStart = new Date(t - 400 * 86_400_000).toISOString().slice(0, 10);
      const rows = (await fredObs(def.code, `realtime_start=${rtStart}&realtime_end=9999-12-31`)).filter((r) => r.realtime_end === "9999-12-31");
      const hist: Observation[] = [];
      const seen = new Set<string>();
      for (const r of rows) { const v = num(r.value); const p = canonicalPeriod(r.date, def.frequency); if (p && Number.isFinite(v) && !seen.has(p)) { seen.add(p); hist.push({ period: p, value: v }); } }
      base.history = hist.sort((a, b) => a.period.localeCompare(b.period));
      const lastValid = [...rows].reverse().find((r) => Number.isFinite(num(r.value)));
      base.refreshedAt = lastValid && lastValid.realtime_start !== rtStart ? `${lastValid.realtime_start}T00:00:00.000Z` : null;
      base.sourceUrl = `https://fred.stlouisfed.org/series/${def.code}`;
      try {
        const m = await metaP!;
        const s = m.seriess?.[0];
        if (s) base.fredMeta = { title: s.title, units: s.units, seasonalAdjustment: s.seasonal_adjustment, lastUpdated: s.last_updated, observationStart: s.observation_start, observationEnd: s.observation_end };
      } catch (e) { warnings.push(`FRED series metadata unavailable: ${clean(e)}`); }
    } else {
      const adapter = def.adapter === "fiscaldata" ? fiscaldataAdapter({ years: 40, full: true }) : o.adapters.get(def.adapter);
      if (!adapter) throw new Error(`No adapter "${def.adapter}" is mounted for ${def.id}.`);
      const [a]: AdapterSeries[] = await adapter.fetchSeries([def], t);
      if (!a?.ok) throw new Error(a?.error ?? "The source returned nothing.");
      base.history = a.observations; base.sourceUrl = a.sourceUrl; base.refreshedAt = a.refreshedAt; base.provider = a.provider;
      if (def.adapter === "fiscaldata" && def.code === "tga") warnings.push("The Daily Treasury Statement renamed its TGA line in April 2022; earlier days are not mapped, so this history starts then.");
    }

    // ── release (US agency data on FRED only: FRED's release calendar comes from the agencies' published schedules) ──
    if (isFred && def.economy === "US") {
      try {
        const r = await releaseP!;
        if (r) {
          let next: string | null = null, nextNote: string;
          if (def.frequency === "daily") nextNote = "Published every business day; no single next-release date applies.";
          else if (r.id === 101) nextNote = "Changes only at FOMC decisions; FRED does not publish the meeting schedule in machine-readable form. See the FOMC calendar link.";
          else {
            const ds = await datesOf(r.id, t);
            next = ds[0] ?? null;
            nextNote = next ? `Next scheduled release of "${r.name}" per FRED's release calendar (dates come from the agency's published schedule).` : `FRED lists no future date for "${r.name}"; see the agency's official calendar.`;
          }
          base.release = { name: r.name, link: r.link, fredReleaseId: r.id, next, nextNote };
        }
      } catch (e) { warnings.push(`Release calendar unavailable: ${clean(e)}`); }
    }

    // ── vintages → revisions and first releases ──
    let vintages: VintageRow[] | null = null;
    if (!isFred) base.revisions = { available: false, reason: `${def.provider} does not expose earlier vintages through the API used here, so revisions are not tracked for this series.` };
    else if (def.vintages === false || def.frequency === "daily") base.revisions = { available: false, reason: "Market rates and spreads computed from them are not revised; revisions are not tracked for this series." };
    else {
      try {
        const rows = await vintageRows!;
        vintages = [];
        for (const r of rows) { const v = num(r.value); const p = canonicalPeriod(r.date, def.frequency); if (p && Number.isFinite(v)) vintages.push({ period: p, start: r.realtime_start, end: r.realtime_end, value: v }); }
        const cur = base.history.length ? base.history : [];
        const headlinePeriods = [...new Set(vintages.filter((v) => v.end === "9999-12-31").map((v) => v.period))].sort();
        const latestP = headlinePeriods.at(-1) ?? cur.at(-1)?.period, prevP = headlinePeriods.at(-2);
        base.revisions = {
          available: true, source: `ALFRED (archival FRED) vintages of ${def.code}${def.economy !== "US" ? "; dates are FRED's republication dates, not the originating agency's" : ""}`,
          vintageCount: new Set(vintages.map((v) => v.start)).size,
          latest: latestP ? revisionsFor(vintages, latestP, def.transform, def.frequency, def.decimals) : null,
          previous: prevP ? revisionsFor(vintages, prevP, def.transform, def.frequency, def.decimals) : null,
        };
      } catch (e) {
        if (e instanceof RateLimitedError) throw e;
        base.revisions = { available: false, reason: `ALFRED vintages could not be loaded (${clean(e)}).` };
      }
    }

    // ── release-day reaction (honesty rules: n, 95% CI, "not significant" when the CI contains zero) ──
    if (!def.reaction) {
      base.reaction = { available: false, reason: def.economy !== "US"
        ? "Release-day reactions are measured only for US releases, where release dates come from ALFRED vintages and the market series (2-year Treasury, Fed broad dollar index, gold) match the currency. Omitted for this series."
        : def.frequency === "daily" ? "Daily series (a market rate or price, or a daily Treasury statement): there is no scheduled headline release to measure a reaction against."
        : "No release-day reaction is measured for this series (it is not a scheduled headline release with first-print vintages in ALFRED)." };
    } else if (!vintages) {
      base.reaction = { available: false, reason: "Omitted: first-release dates need ALFRED vintages, which are not available for this series right now." };
    } else {
      await sharedP;
      const list = assets?.value.list ?? [];
      const rel = firstReleases(vintages, def.transform, def.frequency, 2 * def.lag.days);
      if (!list.length) base.reaction = { available: false, reason: `Omitted: no market series could be loaded (${assets?.value.missing.join("; ") || "unknown cause"}).` };
      else {
        const m = measureReactions(rel, def.decimals, list, REACTION_FROM);
        base.reaction = {
          ...m,
          basis: "Consensus forecasts are not available from a free source, so this is NOT a surprise measure. Each release is classified by the direction of its change: the first-print headline versus the previous period's headline as known on release day (both from ALFRED vintages, rounded to the displayed decimals). Releases with no change are excluded.",
          window: "Close-to-close move from the previous trading day to the release day. Up-group mean minus down-group mean, Welch 95% confidence interval.",
          caveats: [
            "A one-day window also contains every other piece of news that day, including other releases scheduled at the same time.",
            "The dollar index is based on noon New York rates (H.10): releases at 8:30 or 10:00 ET fall inside the window, later announcements fall into the next day's.",
            "Descriptive history only: a past average does not say how the next release will be received.",
            ...(assets?.value.missing.length ? [`Not measured: ${assets.value.missing.join("; ")}.`] : []),
          ],
        };
      }
    }
    if (sharedP) { await sharedP; base.recessions = usrec?.value ?? null; }
    return base;
  }

  return {
    prewarm() { if (key) sharedData(now()).catch(() => undefined); },
    async calendar() {
      if (!key) throw new Error("API key missing: FRED_API_KEY is not set. Add it to app/.env and restart the dev server.");
      const t = now();
      const rows = await Promise.all(US_RELEASES.map(async (r): Promise<UsCalendarRow> => {
        try { return { releaseId: r.id, name: r.name, series: r.series, next: (await datesOf(r.id, t))[0] ?? null }; }
        catch (e) { return { releaseId: r.id, name: r.name, series: r.series, next: null, error: clean(e) }; }
      }));
      return rows.sort((a, b) => (a.next ?? "9999").localeCompare(b.next ?? "9999"));
    },
    async get(id) {
      const def = o.defs[id];
      if (!def) throw Object.assign(new Error(`Unknown indicator "${id}".`), { status: 404 });
      const t = now();
      const c = cache.get(id);
      if (c && c.expires > t) return { detail: c.value, cacheState: "HIT" };
      const f = failures.get(id);
      if (f && f.until > t) throw new Error(f.message);
      let p = inflight.get(id);
      if (!p) {
        p = build(def, t).then((d) => { cache.set(id, { value: d, expires: t + DETAIL_TTL_MS }); failures.delete(id); return d; })
          .catch((e) => { failures.set(id, { message: clean(e), until: t + FAILURE_COOLDOWN_MS }); throw new Error(clean(e)); })
          .finally(() => inflight.delete(id));
        inflight.set(id, p);
      }
      return { detail: await p, cacheState: "MISS" };
    },
  };
}
