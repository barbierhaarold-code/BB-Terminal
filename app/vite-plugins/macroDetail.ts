import type { AdapterSeries, Observation, SeriesDef } from "../src/lib/macro/types";
import {
  firstReleases, measureReactions, recessionRanges, revisionsFor,
  type AssetSeries, type MacroDetail, type VintageRow,
} from "../src/lib/macro/detail";
import { canonicalPeriod } from "../src/lib/macro/math";
import type { MacroAdapter } from "./macroAdapters";
import { RateLimitedError, USER_AGENT } from "./macroAdapters";
import { fiscaldataAdapter, fredGet, fredPaused, keyMissingMessage, scrub } from "./macroDirect";
import type { MacroDiskCache } from "./macroCache";
import { errMessage, fetchWithTimeout } from "./shared";

// ────────────────────────────────────────────────────────────
// Detail view data for ONE indicator (/macro-proxy/series?id=…). Budget per first click on a FRED series: history
// (with its release date) + series metadata + release id + ALFRED vintages = 4 FRED requests, plus the release
// calendar once per release (12 h). Shared, once a day: NBER recession months and the three market series used for
// release-day reactions. Everything is cached (6 h per indicator) and single-flighted, so repeated clicks, overlays
// and the Copilot reuse the same answer. Non-FRED series reuse their own adapter (one request) and say plainly that
// revisions are not tracked. With a disk cache, finished answers, release ids/dates and the shared series survive a
// restart (same TTLs). No FRED request is ever made without a key, and none in the background while the breaker is open.
// ────────────────────────────────────────────────────────────

const DETAIL_TTL_MS = 6 * 60 * 60_000;
const SHARED_TTL_MS = 24 * 60 * 60_000;
const RELEASE_TTL_MS = 12 * 60 * 60_000;
const FAILURE_COOLDOWN_MS = 30_000;
/** A detail answer never waits longer than this for the shared market data (the gold history alone can take ~20 s cold). */
const SHARED_WAIT_MS = 4_000;
/** An answer built before the shared data were ready is kept only this long, so a reopen gets the measurement. */
const PARTIAL_TTL_MS = 20_000;
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
  /** an already-fetched copy of a non-FRED series (the overview snapshot), used instead of a new upstream request */
  fromSnapshot?: (id: string) => AdapterSeries | undefined;
  /** test seam: replaces the gold fetch (OpenBB) */
  goldFetcher?: (fromIso: string) => Promise<Observation[]>;
  /** disk cache shared with the snapshot loaders (macroCache.ts); null/undefined keeps everything in memory */
  store?: MacroDiskCache | null;
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
  const store = o.store ?? null;
  /** A value from disk if it is younger than ttl (as a memory entry with its real expiry), else null. */
  function fromDisk<T>(diskKey: string, ttl: number, t: number): Cached<T> | null {
    const e = store?.get<T>(diskKey);
    if (!e) return null;
    const expires = Date.parse(e.fetchedAt) + ttl;
    return expires > t ? { value: e.value, expires } : null;
  }
  const toDisk = <T>(diskKey: string, source: string, seriesId: string, t: number, value: T) =>
    store?.set(diskKey, { source, seriesId, fetchedAt: new Date(t).toISOString(), value });

  async function fredObs(code: string, q: string): Promise<Array<{ date: string; value: string; realtime_start: string; realtime_end: string }>> {
    const j = await fredGet<{ observations?: Array<{ date: string; value: string; realtime_start: string; realtime_end: string }> }>(`series/observations?series_id=${encodeURIComponent(code)}&${q}`, key);
    return j.observations ?? [];
  }
  const num = (v: string) => (v === "." || v.trim() === "" ? NaN : Number(v));

  /** One market series for the reaction measurement, cached on its own so a failing leg (e.g. gold when OpenBB is down) never refetches the others. */
  const assetCache = new Map<string, Cached<{ points: Array<[string, number]> } | { error: string }>>();
  const ASSETS: Array<{ id: string; fred: boolean; label: string; unit: "bp" | "%"; proxyNote?: string; source: string; missing: string }> = [
    { id: "DGS2", fred: true, label: "2-year Treasury yield", unit: "bp", source: "FRED DGS2 (Board of Governors, H.15; end-of-day constant maturity)", missing: "2-year Treasury yield (FRED DGS2)" },
    { id: "DTWEXBGS", fred: true, label: "US dollar (Fed broad index)", unit: "%", proxyNote: "proxy for DXY: the Federal Reserve Board's Nominal Broad U.S. Dollar Index (H.10, based on noon New York rates). DXY itself is an ICE index that is not free", source: "FRED DTWEXBGS (Board of Governors, H.10)", missing: "US dollar index (FRED DTWEXBGS)" },
    { id: "GOLD", fred: false, label: "Gold", unit: "%", proxyNote: "proxy for spot gold: COMEX front-month gold futures (GC=F) daily close, from Yahoo Finance through this terminal's OpenBB backend", source: "Yahoo Finance GC=F via OpenBB", missing: "Gold (GC=F via OpenBB)" },
  ];
  const assetFrom = `${+REACTION_FROM.slice(0, 4) - 1}-12-01`;
  async function loadAsset(a: (typeof ASSETS)[number], t: number) {
    const c = assetCache.get(a.id);
    if (c && c.expires > t) return;
    const d = fromDisk<Array<[string, number]>>(`shared/${a.fred ? "fred" : "openbb"}/${a.id}`, SHARED_TTL_MS, t);
    if (d) { assetCache.set(a.id, { value: { points: d.value }, expires: d.expires }); return; }
    try {
      let points: Array<[string, number]>;
      if (a.fred) {
        points = [];
        for (const r of await fredObs(a.id, `observation_start=${assetFrom}`)) { const v = num(r.value); if (Number.isFinite(v)) points.push([r.date, v]); }
      } else {
        const g = o.goldFetcher ? await o.goldFetcher(assetFrom) : await openbbGold(assetFrom);
        points = g.map((x) => [x.period, x.value]);
      }
      assetCache.set(a.id, { value: { points }, expires: t + SHARED_TTL_MS });
      toDisk(`shared/${a.fred ? "fred" : "openbb"}/${a.id}`, a.fred ? "FRED" : "OpenBB (Yahoo Finance)", a.id, t, points);
    } catch (e) {
      assetCache.set(a.id, { value: { error: clean(e) }, expires: t + FAILURE_COOLDOWN_MS * 10 });
    }
  }

  async function sharedData(t: number) {
    if (usrec && usrec.expires > t && assets && assets.expires > t) return;
    if (sharedInflight) { await sharedInflight; return; }
    sharedInflight = (async () => {
      if (!usrec || usrec.expires <= t) usrec = fromDisk<Array<[string, string]>>("shared/fred/USREC", SHARED_TTL_MS, t);
      if (!usrec || usrec.expires <= t) {
        try {
          const rows = await fredObs("USREC", "observation_start=1900-01-01");
          const obs = rows.map((r) => ({ period: canonicalPeriod(r.date, "monthly") ?? "", value: num(r.value) })).filter((x) => x.period && Number.isFinite(x.value));
          usrec = { value: recessionRanges(obs), expires: t + SHARED_TTL_MS };
          toDisk("shared/fred/USREC", "FRED", "USREC", t, usrec.value);
        } catch { usrec = { value: [], expires: t + FAILURE_COOLDOWN_MS }; }
      }
      if (!assets || assets.expires <= t) {
        for (const a of ASSETS) await loadAsset(a, t);
        const list: AssetSeries[] = [], missing: string[] = [];
        for (const a of ASSETS) {
          const v = assetCache.get(a.id)!.value;
          if ("points" in v) list.push({ id: a.id, label: a.label, unit: a.unit, ...(a.proxyNote ? { proxyNote: a.proxyNote } : {}), source: a.source, points: new Map(v.points) });
          else missing.push(`${a.missing}: ${v.error}`);
        }
        assets = { value: { list, missing }, expires: Math.min(...ASSETS.map((a) => assetCache.get(a.id)!.expires)) };
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
    const c = releaseIds.get(code) ?? fromDisk<{ id: number; name: string; link: string | null } | null>(`release-of/${code}`, 7 * SHARED_TTL_MS, t);
    if (c && c.expires > t) { releaseIds.set(code, c); return c.value; }
    const j = await fredGet<{ releases?: Array<{ id: number; name: string; link?: string }> }>(`series/release?series_id=${encodeURIComponent(code)}`, key);
    const r = j.releases?.[0];
    const v = r ? { id: r.id, name: r.name, link: r.link ?? null } : null;
    releaseIds.set(code, { value: v, expires: t + 7 * SHARED_TTL_MS });
    toDisk(`release-of/${code}`, "FRED", code, t, v);
    return v;
  }
  /**
   * Upcoming dates of every FRED release from ONE request (cached 12 h), replacing one request per release. Rows come sorted
   * by date, so a release present on this single page has its true NEXT date even when the page is full. FRED's offset
   * paging for this endpoint did not answer when tested (2026-10-13), so it is not used: a release absent from the page
   * falls back to its own request (datesOf).
   */
  let allDates: Cached<Map<number, string[]>> | null = null;
  let allDatesInflight: Promise<Map<number, string[]>> | null = null;
  async function upcoming(t: number): Promise<Map<number, string[]>> {
    if (allDates && allDates.expires > t) return allDates.value;
    if (allDatesInflight) return allDatesInflight;
    const d = fromDisk<Array<[number, string[]]>>("release-dates/all", RELEASE_TTL_MS, t);
    if (d) { allDates = { value: new Map(d.value), expires: d.expires }; return allDates.value; }
    allDatesInflight = (async () => {
      const today = new Date(t).toISOString().slice(0, 10), until = new Date(t + 60 * 86_400_000).toISOString().slice(0, 10);
      const j = await fredGet<{ release_dates?: Array<{ release_id: number; date: string }> }>(`releases/dates?realtime_start=${today}&realtime_end=${until}&include_release_dates_with_no_data=true&limit=1000&order_by=release_date&sort_order=asc`, key);
      const m = new Map<number, string[]>();
      for (const r of j.release_dates ?? []) if (r.date >= today) m.set(r.release_id, [...(m.get(r.release_id) ?? []), r.date]);
      allDates = { value: m, expires: t + RELEASE_TTL_MS };
      toDisk("release-dates/all", "FRED", "releases/dates", t, [...m]);
      return m;
    })().finally(() => { allDatesInflight = null; });
    return allDatesInflight;
  }

  async function datesOf(id: number, t: number): Promise<string[]> {
    const c = releaseDates.get(id) ?? fromDisk<string[]>(`release-dates/${id}`, RELEASE_TTL_MS, t);
    if (c && c.expires > t) { releaseDates.set(id, c); return c.value; }
    try { const fromAll = (await upcoming(t)).get(id); if (fromAll?.length) return fromAll; } catch { /* fall back to the per-release request below */ }
    const today = new Date(t).toISOString().slice(0, 10);
    const j = await fredGet<{ release_dates?: Array<{ date: string }> }>(`release/dates?release_id=${id}&realtime_start=${today}&include_release_dates_with_no_data=true&sort_order=asc&limit=6`, key);
    const v = (j.release_dates ?? []).map((d) => d.date).filter((d) => d >= today);
    releaseDates.set(id, { value: v, expires: t + RELEASE_TTL_MS });
    toDisk(`release-dates/${id}`, "FRED", `release ${id}`, t, v);
    return v;
  }

  async function build(def: SeriesDef, t: number): Promise<MacroDetail & { partial?: boolean }> {
    const warnings: string[] = [];
    let partial = false;
    const base: MacroDetail = {
      id: def.id, fetchedAt: new Date(t).toISOString(), history: [], provider: def.provider, sourceUrl: "", refreshedAt: null, fredMeta: null, release: null,
      revisions: { available: false, reason: "" }, reaction: { available: false, reason: "" }, recessions: null, warnings,
    };
    const isFred = def.adapter === "fred";
    if (isFred && !key) throw new Error(keyMissingMessage("FRED_API_KEY", "FRED"));

    // Independent requests start together (each still goes through the shared FRED budget).
    const wantsVintages = isFred && def.vintages !== false && def.frequency !== "daily";
    const vintageRows = wantsVintages ? fredObs(def.code, `realtime_start=1776-07-04&realtime_end=9999-12-31&observation_start=${VINTAGE_FROM}`) : null;
    vintageRows?.catch(() => undefined); // awaited below; avoids an unhandled rejection while history loads
    const metaP = isFred ? fredGet<{ seriess?: Array<{ title: string; units: string; seasonal_adjustment: string; last_updated: string; observation_start: string; observation_end: string }> }>(`series?series_id=${encodeURIComponent(def.code)}`, key) : null;
    metaP?.catch(() => undefined);
    const releaseP = isFred && def.economy === "US" ? releaseOf(def.code, t) : null;
    releaseP?.catch(() => undefined);
    // Shared data come from FRED: without a key (e.g. TGA, which is FiscalData) there is nothing to ask for.
    const sharedP = def.economy === "US" && key ? sharedData(t).catch(() => undefined) : null;
    let readyP: Promise<boolean> | null = null; // one bounded wait per build, however many sections need the shared data
    const sharedReady = () => (readyP ??= sharedP
      ? Promise.race([sharedP.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), SHARED_WAIT_MS))])
      : Promise.resolve(true));

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
      const cached = def.indicator ? o.fromSnapshot?.(def.id) : undefined;
      const adapter = def.adapter === "fiscaldata" ? fiscaldataAdapter({ years: 40, full: true }) : o.adapters.get(def.adapter);
      if (!cached && !adapter) throw new Error(`No adapter "${def.adapter}" is mounted for ${def.id}.`);
      const [a]: AdapterSeries[] = cached ? [cached] : await adapter!.fetchSeries([def], t);
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
    } else if (!(await sharedReady())) {
      partial = true;
      base.reaction = { available: false, reason: "The market series used for this measurement are still loading on the server (first use after a restart; the gold history alone takes about 15–20 seconds). Reload this panel in a moment." };
    } else {
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
    if (sharedP) { if (!(await sharedReady())) partial = true; base.recessions = usrec?.value ?? null; }
    return partial ? { ...base, partial } : base;
  }

  return {
    prewarm() { if (key && !fredPaused(now)) sharedData(now()).catch(() => undefined); },
    async calendar() {
      if (!key) throw new Error(keyMissingMessage("FRED_API_KEY", "FRED"));
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
      const c = cache.get(id) ?? fromDisk<MacroDetail>(`detail/${id}`, DETAIL_TTL_MS, t);
      if (c && c.expires > t) { cache.set(id, c); return { detail: c.value, cacheState: "HIT" }; }
      const f = failures.get(id);
      if (f && f.until > t) throw new Error(f.message);
      let p = inflight.get(id);
      if (!p) {
        p = build(def, t).then(({ partial, ...d }) => {
          cache.set(id, { value: d, expires: t + (partial ? PARTIAL_TTL_MS : DETAIL_TTL_MS) });
          if (!partial) toDisk(`detail/${id}`, d.provider, id, t, d);
          failures.delete(id); return d;
        })
          .catch((e) => { failures.set(id, { message: clean(e), until: t + FAILURE_COOLDOWN_MS }); throw new Error(clean(e)); })
          .finally(() => inflight.delete(id));
        inflight.set(id, p);
      }
      return { detail: await p, cacheState: "MISS" };
    },
  };
}
