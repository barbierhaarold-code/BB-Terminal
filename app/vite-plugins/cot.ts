import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { middlewarePlugin, sendJson, errMessage, fetchWithTimeout, mapLimit } from "./shared";
import {
  COT_CATEGORIES, COT_CONTRACTS, COT_CONTRACT_BY_KEY, COT_DATASETS, COT_LOOKBACKS, COT_PRIMARY_CATEGORY, COT_SOCRATA_HOST,
  type CotContractDef, type CotReportType,
} from "../src/lib/cotContracts";
import { computeFreshness, percentileRank, scheduledReleaseMs } from "../src/lib/cotMath";
import type {
  CotCategoryRow, CotContract, CotDiagnostics, CotHistory, CotHistoryPoint, CotSnapshot,
} from "../src/lib/cotTypes";

// ────────────────────────────────────────────────────────────
// COT (Commitments of Traders) proxy — PRIMARY source: the CFTC's official
// public-reporting Socrata API (publicreporting.cftc.gov). Two datasets:
//   • TFF (Traders in Financial Futures) — FX, indices, Bitcoin
//   • Disaggregated                       — gold, silver, WTI
// both FUTURES-ONLY (what the previous Tradingster feed showed).
//
// The data is weekly (positions as of Tuesday, published Friday 3:30 pm ET), so
// one snapshot of all 14 contracts is cached for hours and single-flighted:
// concurrent requests share one upstream round-trip (2 requests total). The
// cache is cut short at the next scheduled release, and shortened while a
// report is late, so a Friday release is picked up promptly.
//
// FALLBACK: Tradingster's HTML mirror of the CFTC legacy report, used ONLY when
// the official source fails. It covers 4 contracts, has no history/percentiles,
// and the snapshot is marked source:"tradingster-fallback" so the UI labels it.
// Every use is logged and counted (diagnostics.fallbackHits). No other scraping.
//
// Optional env: CFTC_SOCRATA_APP_TOKEN (raises Socrata's throttling limits;
// never required). Optional dev switch: COT_ALLOW_SIMULATE=1 enables
// POST /cot-proxy/_simulate for outage tests (see below).
// ────────────────────────────────────────────────────────────

const USER_AGENT = "AbdelKhaderTerminal/1.0 (personal market-data terminal; reads CFTC public COT data; node)";
const CACHE_MAX_TTL_MS = 6 * 60 * 60_000;
const LATE_TTL_MS = 15 * 60_000;
const MIN_TTL_MS = 60_000;
/** Fallback answers are kept only briefly: enough to absorb a burst of requests, short enough that Retry re-tests the official source. */
const FALLBACK_TTL_MS = 20_000;
const STALE_MAX_AGE_MS = 21 * 24 * 60 * 60_000;
const HISTORY_YEARS_FETCHED = 5;
const UPSTREAM_TIMEOUT_MS = 25_000;

// ───────────── Socrata fetch + normalize ─────────────

interface SocrataRow { [field: string]: string | undefined }
interface DatasetResult { rows: SocrataRow[]; lastModifiedMs: number | null }

function selectFields(report: CotReportType): string[] {
  const f = new Set<string>([
    "report_date_as_yyyy_mm_dd", "cftc_contract_market_code", "market_and_exchange_names",
    "open_interest_all", "change_in_open_interest_all",
  ]);
  for (const c of COT_CATEGORIES[report]) {
    f.add(c.longField); f.add(c.shortField); f.add(c.changeLongField); f.add(c.changeShortField);
  }
  return [...f];
}

function describeFetchError(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s`;
  const cause = e?.cause?.code ?? e?.cause?.message;
  return cause ? `${e?.message ?? "fetch failed"} (${cause})` : errMessage(err);
}

async function fetchDataset(report: CotReportType, appToken: string | undefined, nowMs: number): Promise<DatasetResult> {
  const ds = COT_DATASETS[report];
  const codes = COT_CONTRACTS.filter((c) => c.report === report).map((c) => `'${c.code}'`).join(",");
  // 5 years of weekly reports plus a margin, so the 260-report window is always full.
  const start = new Date(nowMs - (HISTORY_YEARS_FETCHED * 365 + 60) * 86_400_000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    $select: selectFields(report).join(","),
    $where: `cftc_contract_market_code in (${codes}) AND report_date_as_yyyy_mm_dd >= '${start}T00:00:00.000'`,
    $order: "report_date_as_yyyy_mm_dd ASC",
    $limit: "20000",
  });
  const url = `${COT_SOCRATA_HOST}/resource/${ds.id}.json?${params}`;
  const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "application/json" };
  if (appToken) headers["x-app-token"] = appToken;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers }, UPSTREAM_TIMEOUT_MS);
  } catch (err) {
    throw new Error(`CFTC Socrata ${ds.id} (${report.toUpperCase()}): network error — ${describeFetchError(err)}`);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`CFTC Socrata ${ds.id} (${report.toUpperCase()}) answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}${body ? `: ${body}` : ""}`);
  }
  let rows: unknown;
  try { rows = await res.json(); }
  catch (err) { throw new Error(`CFTC Socrata ${ds.id} (${report.toUpperCase()}): response was not valid JSON — ${errMessage(err)}`); }
  if (!Array.isArray(rows)) throw new Error(`CFTC Socrata ${ds.id} (${report.toUpperCase()}): unexpected response shape (not an array)`);
  const lm = Date.parse(res.headers.get("x-soda2-truth-last-modified") ?? res.headers.get("last-modified") ?? "");
  return { rows: rows as SocrataRow[], lastModifiedMs: Number.isFinite(lm) ? lm : null };
}

const num = (v: string | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ymd = (iso: string | undefined) => (iso ?? "").slice(0, 10);

interface Series { def: CotContractDef; market: string; rows: SocrataRow[] }

/** Builds the contract summary (latest week + percentiles) and its history from that contract's rows (chronological). */
function buildContract(s: Series): { contract: CotContract; history: CotHistoryPoint[] } {
  const { def, rows } = s;
  const base = { key: def.key, name: def.name, short: def.short, group: def.group, code: def.code, report: def.report };
  if (rows.length === 0) {
    return { contract: { available: false, ...base, reason: `No rows for CFTC code ${def.code} in the ${COT_DATASETS[def.report].name} dataset.` }, history: [] };
  }
  const cats = COT_CATEGORIES[def.report];
  const history: CotHistoryPoint[] = [];
  const netSeries: Record<string, number[]> = Object.fromEntries(cats.map((c) => [c.id, [] as number[]]));
  for (const r of rows) {
    const nets: Record<string, number> = {};
    let ok = true;
    for (const c of cats) {
      const l = num(r[c.longField]), sh = num(r[c.shortField]);
      if (l == null || sh == null) { ok = false; break; }
      nets[c.id] = l - sh;
    }
    const oi = num(r.open_interest_all);
    if (!ok || oi == null) continue; // a malformed week is skipped, never zero-filled
    history.push({ date: ymd(r.report_date_as_yyyy_mm_dd), openInterest: oi, nets });
    for (const c of cats) netSeries[c.id].push(nets[c.id]);
  }
  const last = rows[rows.length - 1];
  const latest = history[history.length - 1];
  if (!latest || latest.date !== ymd(last.report_date_as_yyyy_mm_dd)) {
    return { contract: { available: false, ...base, reason: `Latest ${def.code} row (${ymd(last.report_date_as_yyyy_mm_dd)}) has missing position fields.` }, history };
  }

  const categories: CotCategoryRow[] = cats.map((c) => {
    const long = num(last[c.longField]) as number, short = num(last[c.shortField]) as number;
    const cl = num(last[c.changeLongField]), cs = num(last[c.changeShortField]);
    return {
      id: c.id, label: c.label, long, short, net: long - short,
      changeLong: cl, changeShort: cs, changeNet: cl != null && cs != null ? cl - cs : null,
      pct3y: percentileRank(netSeries[c.id], COT_LOOKBACKS.y3),
      pct5y: percentileRank(netSeries[c.id], COT_LOOKBACKS.y5),
    };
  });

  return {
    contract: {
      available: true, ...base, market: s.market, asOf: latest.date,
      openInterest: latest.openInterest, openInterestChange: num(last.change_in_open_interest_all),
      primary: COT_PRIMARY_CATEGORY[def.report], categories, weeks: history.length,
    },
    history,
  };
}

// ───────────── Tradingster fallback (legacy non-commercial, 4 contracts) ─────────────
// Parser kept from the original proxy. Column order, verified against the live
// table: [NonComm Long, Short, Spreads, Comm Long, Short, Total Long, Short,
// NonReportable Long, Short] for the positions row, then again for "Changes".
const FALLBACK_CODES: Record<string, string> = { gold: "088691", wti: "067651", eur: "099741", es: "13874A" };

interface FallbackParsed { asOf: string; openInterest: number; long: number; short: number; changeLong: number; changeShort: number }

function parseTradingster(html: string): FallbackParsed | null {
  const dateMatch = html.match(/Positions as of (\d{4}-\d{2}-\d{2})/);
  const oiMatch = html.match(/Open Interest:\s*(?:<[^>]+>)*\s*([\d,]+)/);
  if (!dateMatch || !oiMatch) return null;
  const cells = [...html.matchAll(/<td class="number">([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
  if (cells.length < 18) return null;
  const n = (s: string) => Number(s.replace(/,/g, ""));
  const out = {
    asOf: dateMatch[1], openInterest: n(oiMatch[1]),
    long: n(cells[0]), short: n(cells[1]), changeLong: n(cells[9]), changeShort: n(cells[10]),
  };
  return Object.values(out).some((v) => typeof v === "number" && !Number.isFinite(v)) ? null : out;
}

async function fetchFallback(nowMs: number, officialError: string): Promise<CotSnapshot> {
  const keys = Object.keys(FALLBACK_CODES);
  const settled = await mapLimit(keys, 2, async (key) => {
    const res = await fetchWithTimeout(`https://www.tradingster.com/cot/legacy-futures/${FALLBACK_CODES[key]}`,
      { headers: { "user-agent": USER_AGENT } }, 15_000);
    const html = await res.text();
    const parsed = res.ok ? parseTradingster(html) : null;
    if (!parsed) throw new Error(`Tradingster ${FALLBACK_CODES[key]}: HTTP ${res.status}, could not parse`);
    return parsed;
  });
  const errors: string[] = [];
  const contracts: CotContract[] = COT_CONTRACTS.map((def) => {
    const base = { key: def.key, name: def.name, short: def.short, group: def.group, code: def.code, report: def.report };
    const i = keys.indexOf(def.key);
    if (i < 0) return { available: false, ...base, reason: "Not covered by the fallback source (Tradingster legacy mirror carries only Gold, WTI, EUR FX, E-mini S&P 500)." };
    const r = settled[i];
    if (r.status === "rejected") { errors.push(errMessage(r.reason)); return { available: false, ...base, reason: `Fallback source failed: ${errMessage(r.reason)}` }; }
    const p = r.value;
    return {
      available: true, ...base, market: "Legacy report · Non-commercial (Tradingster mirror of CFTC)", asOf: p.asOf,
      openInterest: p.openInterest, openInterestChange: null, primary: "noncomm", weeks: 0,
      categories: [{
        id: "noncomm", label: "Non-commercial (legacy)", long: p.long, short: p.short, net: p.long - p.short,
        changeLong: p.changeLong, changeShort: p.changeShort, changeNet: p.changeLong - p.changeShort, pct3y: null, pct5y: null,
      }],
    };
  });
  const okAsOf = contracts.filter((c) => c.available).map((c) => (c as { asOf: string }).asOf).sort();
  if (okAsOf.length === 0) throw new Error(`fallback also failed — ${errors.join("; ")}`);
  const asOf = okAsOf[okAsOf.length - 1];
  return {
    source: "tradingster-fallback",
    sourceLabel: "FALLBACK · Tradingster mirror of the CFTC legacy report (non-commercial) — official CFTC feed unavailable",
    basis: "futures-only", fetchedAt: new Date(nowMs).toISOString(), asOf,
    freshness: computeFreshness(asOf, nowMs, null),
    contracts,
    warnings: [`Official CFTC source failed (${officialError}). Showing the Tradingster fallback: 4 contracts, legacy "non-commercial" category, no history or percentiles. Other contracts: n/a.`],
    stale: false,
    diagnostics: { officialFetches: 0, fallbackHits: 0, lastFallbackAt: null, officialFailures: 0, lastOfficialError: null }, // overwritten by the caller
  };
}

// ───────────── plugin ─────────────

interface CacheEntry { snapshot: CotSnapshot; history: Map<string, CotHistoryPoint[]>; expires: number; storedAt: number; updatedMs: number | null }

export function cotProxyPlugin(appToken?: string, simulateRequested = false): Plugin {
  const token = appToken?.trim() || undefined;
  // The outage-simulation endpoint is DEV-ONLY. It is live only when ALL hold:
  //   1. COT_ALLOW_SIMULATE=1 was set (simulateRequested),
  //   2. this plugin was mounted through Vite's `configureServer` hook, i.e. the dev server
  //      (the production gateway in server/index.ts and `vite preview` only ever call
  //      `configurePreviewServer`, which never sets `isDevServer`),
  //   3. NODE_ENV is not "production".
  let isDevServer = false;
  const allowSimulate = () => simulateRequested && isDevServer && process.env.NODE_ENV !== "production";
  let cache: CacheEntry | null = null;
  let fallbackCache: CacheEntry | null = null;
  let inflight: Promise<{ entry: CacheEntry; cacheState: string }> | null = null;
  const diag: CotDiagnostics = { officialFetches: 0, fallbackHits: 0, lastFallbackAt: null, officialFailures: 0, lastOfficialError: null };
  /** dev-only outage switch: "official" = the CFTC call fails; "all" = the fallback fails too */
  let simulate: "off" | "official" | "all" = "off";

  async function buildOfficial(nowMs: number): Promise<CacheEntry> {
    diag.officialFetches++;
    if (simulate !== "off") throw new Error("Simulated outage: CFTC Socrata unreachable (COT_ALLOW_SIMULATE test switch)");
    const [tff, dis] = await Promise.all([fetchDataset("tff", token, nowMs), fetchDataset("disagg", token, nowMs)]);
    const byDef = new Map<string, Series>();
    for (const def of COT_CONTRACTS) byDef.set(def.key, { def, market: "", rows: [] });
    for (const [report, ds] of [["tff", tff], ["disagg", dis]] as const) {
      for (const r of ds.rows) {
        const def = COT_CONTRACTS.find((d) => d.report === report && d.code === r.cftc_contract_market_code);
        if (!def) continue;
        const s = byDef.get(def.key)!;
        s.rows.push(r);
        s.market = r.market_and_exchange_names ?? s.market;
      }
    }
    const history = new Map<string, CotHistoryPoint[]>();
    const warnings: string[] = [];
    const contracts: CotContract[] = [];
    for (const def of COT_CONTRACTS) {
      const s = byDef.get(def.key)!;
      s.rows.sort((a, b) => (a.report_date_as_yyyy_mm_dd ?? "").localeCompare(b.report_date_as_yyyy_mm_dd ?? ""));
      if (s.market && !def.nameMatch.test(s.market)) {
        // The code now maps to a different contract than the one we verified — refuse rather than show the wrong market.
        contracts.push({ available: false, key: def.key, name: def.name, short: def.short, group: def.group, code: def.code, report: def.report,
          reason: `CFTC code ${def.code} now returns "${s.market}", not the expected ${def.name}. Refusing to show it.` });
        history.set(def.key, []);
        continue;
      }
      const { contract, history: h } = buildContract(s);
      contracts.push(contract);
      history.set(def.key, h);
    }
    const okAsOf = contracts.filter((c) => c.available).map((c) => (c as { asOf: string }).asOf).sort();
    if (okAsOf.length === 0) throw new Error("CFTC Socrata answered but returned no usable rows for any tracked contract.");
    const asOf = okAsOf[okAsOf.length - 1];
    for (const c of contracts) {
      if (c.available && c.asOf !== asOf) warnings.push(`${c.name} is still at ${c.asOf} (others at ${asOf}).`);
    }
    const updated = Math.max(...[tff.lastModifiedMs, dis.lastModifiedMs].filter((v): v is number => v != null), -Infinity);
    const freshness = computeFreshness(asOf, nowMs, Number.isFinite(updated) ? updated : null);
    if (freshness.late) warnings.push(`Report is late: positions as of ${freshness.expectedAsOf} should be published by now.`);

    // Cache until the next scheduled release, never longer than CACHE_MAX_TTL_MS; refresh quickly while late.
    const toRelease = scheduledReleaseMs(freshness.nextAsOf) - nowMs;
    const ttl = freshness.late ? LATE_TTL_MS : Math.max(MIN_TTL_MS, Math.min(CACHE_MAX_TTL_MS, toRelease + 2 * 60_000));
    return {
      snapshot: {
        source: "cftc",
        sourceLabel: "CFTC official public reporting · futures only",
        basis: "futures-only", fetchedAt: new Date(nowMs).toISOString(), asOf, freshness, contracts, warnings, stale: false, diagnostics: diag,
      },
      history, expires: nowMs + ttl, storedAt: nowMs, updatedMs: Number.isFinite(updated) ? updated : null,
    };
  }

  async function load(): Promise<{ entry: CacheEntry; cacheState: string }> {
    const now = Date.now();
    if (simulate === "off" && cache && cache.expires > now) return { entry: cache, cacheState: "HIT" };
    if (fallbackCache && fallbackCache.expires > now) return { entry: fallbackCache, cacheState: "FALLBACK" };
    if (inflight) return inflight; // single-flight: concurrent callers share one upstream round-trip
    inflight = (async () => {
      try {
        const entry = await buildOfficial(now);
        cache = entry;
        fallbackCache = null;
        return { entry, cacheState: "MISS" };
      } catch (officialErr) {
        const cause = errMessage(officialErr);
        diag.officialFailures++; diag.lastOfficialError = cause;
        console.warn(`[cot-proxy] official CFTC fetch failed: ${cause}`);
        // 1) Stale official data beats a different-source fallback — served with a visible warning.
        if (cache && now - cache.storedAt < STALE_MAX_AGE_MS) {
          const snap: CotSnapshot = {
            ...cache.snapshot, stale: true,
            warnings: [`CFTC is unreachable (${cause}). Showing official data cached at ${cache.snapshot.fetchedAt}.`, ...cache.snapshot.warnings],
            diagnostics: diag,
          };
          return { entry: { ...cache, snapshot: snap }, cacheState: "STALE" };
        }
        // 2) Labeled Tradingster fallback.
        try {
          if (simulate === "all") throw new Error("Simulated outage: Tradingster unreachable (COT_ALLOW_SIMULATE test switch)");
          const snap = await fetchFallback(now, cause);
          diag.fallbackHits++; diag.lastFallbackAt = new Date(now).toISOString();
          console.warn(`[cot-proxy] FALLBACK ACTIVE: serving Tradingster (hit #${diag.fallbackHits})`);
          snap.diagnostics = diag;
          const entry: CacheEntry = { snapshot: snap, history: new Map(), expires: now + FALLBACK_TTL_MS, storedAt: now, updatedMs: null };
          // Kept apart from `cache`: a fallback must never be mistaken for good official data later.
          fallbackCache = entry;
          return { entry, cacheState: "FALLBACK" };
        } catch (fbErr) {
          throw new Error(`${cause}. Fallback source also failed: ${errMessage(fbErr)}`);
        }
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    const url = new URL(req.url ?? "", "http://x");
    if (!url.pathname.startsWith("/cot-proxy/")) { next(); return; }
    const route = url.pathname.slice("/cot-proxy/".length);

    if (route === "_simulate" && req.method === "POST") {
      if (!allowSimulate()) { sendJson(res, { results: null, warnings: [{ message: "Not found." }] }, 404); return; }
      const mode = url.searchParams.get("mode");
      if (mode !== "off" && mode !== "official" && mode !== "all") { sendJson(res, { results: null, warnings: [{ message: "mode must be off|official|all" }] }, 400); return; }
      simulate = mode;
      if (url.searchParams.get("clear") === "1") { cache = null; fallbackCache = null; }
      sendJson(res, { results: { simulate, cacheCleared: url.searchParams.get("clear") === "1", diagnostics: diag } });
      return;
    }
    if (req.method !== "GET") { next(); return; }

    const snapshotRoute = route === "snapshot";
    const histMatch = route.match(/^history\/([a-z0-9]+)$/);
    if (!snapshotRoute && !histMatch) {
      sendJson(res, { results: null, warnings: [{ message: `Unknown COT route "${route}". Use /cot-proxy/snapshot or /cot-proxy/history/<contract>.` }] }, 404);
      return;
    }
    if (histMatch && !COT_CONTRACT_BY_KEY[histMatch[1]]) {
      sendJson(res, { results: null, warnings: [{ message: `Unknown COT contract "${histMatch[1]}".` }] }, 404);
      return;
    }

    try {
      const { entry, cacheState } = await load();
      res.setHeader("x-bbterminal-cache", cacheState);
      res.setHeader("cache-control", "no-store");
      if (snapshotRoute) {
        // Freshness depends on "now": recompute per response so a long-cached snapshot still flags lateness.
        const snap = entry.snapshot;
        const freshness = snap.asOf ? computeFreshness(snap.asOf, Date.now(), entry.updatedMs) : snap.freshness;
        sendJson(res, { results: { ...snap, freshness, diagnostics: diag } });
        return;
      }
      const key = histMatch![1];
      const history = entry.history.get(key);
      if (!history || history.length === 0) {
        const c = entry.snapshot.contracts.find((x) => x.key === key);
        const why = c && !c.available ? c.reason : entry.snapshot.source === "tradingster-fallback" ? "History is not available from the fallback source." : "No history for this contract.";
        sendJson(res, { results: null, warnings: [{ message: why }] }, 404);
        return;
      }
      const out: CotHistory = { key, history };
      sendJson(res, { results: out });
    } catch (err) {
      sendJson(res, { results: null, warnings: [{ message: errMessage(err) }] }, 502);
    }
  }

  const plugin = middlewarePlugin("bbterminal-cot-proxy", handle);
  const mountPreview = plugin.configurePreviewServer;
  return {
    ...plugin,
    configureServer(server) {
      isDevServer = true;
      if (simulateRequested && process.env.NODE_ENV !== "production") console.warn("[cot-proxy] COT_ALLOW_SIMULATE active: /cot-proxy/_simulate enabled (dev server only).");
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      if (simulateRequested) console.warn("[cot-proxy] COT_ALLOW_SIMULATE ignored: not the dev server.");
      return typeof mountPreview === "function" ? mountPreview.call(this, server) : undefined;
    },
  };
}
