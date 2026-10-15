import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { middlewarePlugin, sendJson, errMessage } from "./shared";
import { SERIES } from "../src/lib/macro/config";
import { US_SERIES } from "../src/lib/macro/usCatalog";
import { ALL_BY_ID } from "../src/lib/macro/catalog";
import type { AdapterSeries, ErrorKind, MacroSnapshot, SeriesDef, ServedStats } from "../src/lib/macro/types";
import { AdapterError, dbnomicsAdapter, RateLimitedError, type MacroAdapter } from "./macroAdapters";
import { directAdapters, fredAdapter, fredPaused, scrub } from "./macroDirect";
import { createDetailService } from "./macroDetail";
import { createDiskCache, FREQ_TTL_MS, resolveCacheDir, type MacroDiskCache } from "./macroCache";

// ────────────────────────────────────────────────────────────
// /macro-proxy — Macro Hub data. Series come from several adapters (DBnomics plus the
// direct primary-source adapters in macroDirect.ts). Routes:
//   /snapshot        the G8 overview matrix (one request for the whole page)
//   /us              the US deep coverage (one request, loaded only when the US section is opened)
//   /series?id=…     one indicator's detail view (full history, revisions, release calendar, reactions;
//                    see macroDetail.ts)
// Each catalogue is assembled by the same cached, single-flight loader below. Nothing is prewarmed when the overview
// opens: the US catalogue (58 FRED series) is fetched only when the US section is opened, and the shared reaction
// data (3 FRED series) only then or on a US detail view; that prewarm is skipped while the FRED breaker is open.
//
// Caching is per series: an adapter's own cacheMs if it sets one (sized to how often that provider updates),
// otherwise the series' frequency TTL (macroCache.ts; FRED uses these). Successful series are also written to the
// disk cache, so a restart reuses them instead of refetching; only expired or missing series are asked for again.
// No answer waits for the slowest source: each adapter gets a deadline (DEFAULT_ADAPTER_DEADLINE_MS, 8 s). A cached
// copy, even an expired one (up to 7 days), is served at once marked STALE CACHE while ONE background refresh runs;
// a series with no copy is waited for until the deadline, then reported as "still loading" (errorKind "pending")
// while its request keeps running and fills the cache. `served` counts where every series came from (the page badge).
// The assembled snapshot is held for a few minutes, or only until a background refresh it is missing lands. Concurrent callers
// share one rebuild (single-flight). A failing adapter never takes the others down: its
// series become honest per-series errors (with the real cause, or "API key missing"), or,
// if it answered before, its older data is served marked STALE with the cause. An upstream
// 429 is honoured (Retry-After) and a failure is remembered for a few seconds so a burst of
// Retry clicks cannot hammer a provider. The snapshot as a whole fails (HTTP 502 with the
// real cause) only if EVERY adapter failed and nothing older exists.
//
// Dev-only switch: MACRO_ALLOW_SIMULATE=1 enables POST /macro-proxy/_simulate for
// outage tests; same three-part gate as the COT plugin (see below).
// ────────────────────────────────────────────────────────────

/** The assembled snapshot is rebuilt at most this often; each adapter keeps its own (longer) cache underneath. */
const SNAPSHOT_TTL_MS = 10 * 60_000;
/** An adapter that answered but produced no usable series (e.g. a rejected key) is asked again after this long, not after hours. */
const ALL_FAILED_RETRY_MS = 15 * 60_000;
const STALE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const FAILURE_COOLDOWN_MS = 5_000;
/** Observations sent per series to the page (overview and US tables): latest, previous, y/y base and a 48-point sparkline. Detail views fetch the full history. */
const US_TRIM: Record<SeriesDef["frequency"], number> = { daily: 60, weekly: 110, monthly: 64, quarterly: 24 };

/**
 * Per-adapter deadline: how long a page request waits for ONE source before answering without it.
 * Default 8 s, because:
 *   - the upstream timeout is 30 s and slow sources really use it (DBnomics timing out at 30 s, Statistics Canada once
 *     at 18 s), so waiting for the slowest source made a first visit cost up to 30 s even with most series cached;
 *   - a source that is merely slow, not down, should still make it into the first answer: 8 s is generous for one
 *     batched API request and keeps the worst first visit around 8 s instead of 30 s;
 *   - it is well under the 30 s upstream timeout, so a source that misses it still gets the rest of its time: the
 *     request keeps running in the background (one request, shared by every caller) and fills the cache when it lands.
 * Only series with NO cached copy are waited for: a cached copy, even an expired one, is served at once (marked) while
 * it is refreshed in the background. MACRO_ADAPTER_DEADLINE_MS (0 to 60000) overrides it.
 */
export const DEFAULT_ADAPTER_DEADLINE_MS = 8_000;
export function adapterDeadlineMs(env: Record<string, string | undefined>): number {
  const raw = env.MACRO_ADAPTER_DEADLINE_MS?.trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 && n <= 60_000 ? n : DEFAULT_ADAPTER_DEADLINE_MS;
}

interface Entry { snapshot: MacroSnapshot; storedAt: number; expires: number; provisional: string[] }
interface AdapterEntry { series: AdapterSeries[]; storedAt: number; expires: number }
interface AdapterFailure { message: string; until: number; kind: ErrorKind; rateLimited: RateLimitedError | null }
interface Failure { cause: string; kind: ErrorKind; rl: RateLimitedError | null }
/** One upstream refresh of one adapter: started once, joined by every caller until it settles (single-flight). */
interface Job { startedAt: number; promise: Promise<{ series: AdapterSeries[] } | { failure: Failure }>; background: boolean }
/** Where a served ok series came from in this assembly ("refreshing": an older copy, with a refresh running). */
type Origin = "memory" | "disk" | "fetched" | "stale" | "refreshing";
interface Notes { stale: string[]; limited: RateLimitedError[]; origin: Map<string, Origin>; provisional: Set<string> }

const emptyServed = (): ServedStats => ({ memory: 0, disk: 0, fetched: 0, stale: 0, refreshing: 0, pending: 0, failed: 0, unrequested: 0 });
/** Legacy one-word summary (x-bbterminal-cache): STALE if any older copy is served, MISS if anything went (or is going) upstream, else HIT. */
const stateOf = (s: ServedStats): MacroSnapshot["cacheState"] => (s.stale ? "STALE" : s.fetched || s.pending ? "MISS" : "HIT");

export function macroProxyPlugin(
  simulateRequested = false,
  adapters: MacroAdapter[] | undefined = undefined,
  env: Record<string, string | undefined> = process.env,
): Plugin {
  const mounted = adapters ?? [dbnomicsAdapter, ...directAdapters(env)];
  const secrets = [env.BLS_API_KEY, env.FRED_API_KEY];
  const cacheDir = resolveCacheDir(env);
  const store: MacroDiskCache | null = cacheDir ? createDiskCache(cacheDir, secrets) : null;
  const deadlineMs = adapterDeadlineMs(env);
  // The outage-simulation endpoint is DEV-ONLY. It is live only when ALL hold:
  //   1. MACRO_ALLOW_SIMULATE=1 was set (simulateRequested),
  //   2. this plugin was mounted through Vite's `configureServer` hook, i.e. the dev server
  //      (the production gateway in server/index.ts and `vite preview` only ever call
  //      `configurePreviewServer`, which never sets `isDevServer`),
  //   3. NODE_ENV is not "production".
  let isDevServer = false;
  const allowSimulate = () => simulateRequested && isDevServer && process.env.NODE_ENV !== "production";
  let simulate: "off" | "outage" = "off";
  const byId = new Map(mounted.map((a) => [a.id, a]));
  const adapterFailure = new Map<string, AdapterFailure>(); // per provider: a provider that is down is down for every catalogue

  /** Remembers a failed upstream attempt (cool-down, honoured Retry-After) and returns its scrubbed cause. */
  function recordFailure(id: string, err: unknown, nowMs: number): Failure {
    const cause = scrub(errMessage(err), secrets);
    const rl = err instanceof RateLimitedError ? new RateLimitedError(cause, err.retryAfterMs) : null;
    const kind: ErrorKind = err instanceof AdapterError ? err.kind : "error";
    adapterFailure.set(id, { message: cause, until: nowMs + (rl ? rl.retryAfterMs : FAILURE_COOLDOWN_MS), kind, rateLimited: rl });
    console.warn(`[macro-proxy] ${id} fetch failed: ${cause}`);
    return { cause, kind, rl };
  }

  /** One cached, single-flight snapshot loader per catalogue. Adapter caches are per catalogue (different series sets). */
  function makeLoader(catalogue: string, catalogDefs: SeriesDef[], adaptersOf: Map<string, MacroAdapter>, trim?: Record<SeriesDef["frequency"], number>) {
    let cache: Entry | null = null;
    let inflight: Promise<{ entry: Entry; cacheState: "HIT" | "MISS" | "STALE" }> | null = null;
    let lastFailure: { at: number; message: string; until: number } | null = null;
    const adapterCache = new Map<string, AdapterEntry>();
    const jobs = new Map<string, Job>();

    const failed = (d: SeriesDef, nowMs: number, message: string, kind: ErrorKind): AdapterSeries =>
      ({ id: d.id, ok: false, error: message, errorKind: kind, observations: [], provider: d.provider, sourceUrl: "", refreshedAt: null, retrievedAt: new Date(nowMs).toISOString() });
    const pendingSeries = (d: SeriesDef, nowMs: number) => failed(d, nowMs,
      `Still loading: ${d.provider} has not answered within ${deadlineMs / 1000} s. The request keeps running on the server; this page refreshes itself when it arrives, or retry in a moment.`, "pending");

    const diskKey = (adapterId: string, d: SeriesDef) => `${catalogue}/${adapterId}/${d.id}`;
    const ttlOf = (adapter: MacroAdapter, d: SeriesDef) => adapter.cacheMs ?? FREQ_TTL_MS[d.frequency];
    const remember = (id: string, series: AdapterSeries[], storedAt: number, expires: number) => { adapterCache.set(id, { series, storedAt, expires }); return series; };

    /**
     * Starts the upstream refresh of one adapter. It runs to completion whoever is still waiting: on success it fills
     * the memory and disk caches, on failure it records the cool-down. It never throws.
     */
    function startJob(id: string, adapter: MacroAdapter, defs: SeriesDef[], todo: SeriesDef[], disk: Map<string, { s: AdapterSeries; at: number }>, nowMs: number): Job {
      const job: Job = { startedAt: Date.now(), promise: null as never, background: false };
      jobs.set(id, job);
      job.promise = (async () => {
        try {
          const got = await adapter.fetchSeries(todo, nowMs);
          adapterFailure.delete(id);
          const fetchedAt = new Date(nowMs).toISOString();
          for (const x of got) {
            const d = todo.find((t) => t.id === x.id);
            if (d && x.ok && store) store.set(diskKey(id, d), { source: x.provider || id, seriesId: x.id, fetchedAt, value: x });
          }
          const got1 = new Map(got.map((x) => [x.id, x]));
          const series = defs.map((d) => got1.get(d.id) ?? disk.get(d.id)?.s).filter((x): x is AdapterSeries => !!x);
          const usable = series.some((x) => x.ok);
          // Expires when the first of its series is due again (only that one is refetched then).
          const due = defs.map((d) => (got1.has(d.id) ? nowMs : disk.get(d.id)?.at ?? nowMs) + ttlOf(adapter, d));
          if (job.background) console.info(`[macro-proxy] ${catalogue}/${id} answered in the background after ${((Date.now() - job.startedAt) / 1000).toFixed(1)} s; cache filled.`);
          return { series: remember(id, series, nowMs, usable ? Math.min(...due) : nowMs + ALL_FAILED_RETRY_MS) };
        } catch (err) {
          return { failure: recordFailure(id, err, nowMs) };
        } finally {
          if (jobs.get(id) === job) jobs.delete(id);
        }
      })();
      return job;
    }

    /** Waits for `p` at most `ms`; undefined if the time ran out first. */
    async function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<undefined>((r) => { timer = setTimeout(() => r(undefined), ms); });
      try { return await Promise.race([p, timeout]); } finally { clearTimeout(timer); }
    }

    /**
     * Runs one adapter through its cache. Never throws, and never waits longer than the deadline:
     *   fresh copy (memory, then disk)  → served as is;
     *   older copy (expired, ≤ 7 days)  → served at once, marked, while one background refresh runs;
     *   no copy                         → wait for the refresh up to the deadline, then answer "still loading" for it.
     */
    async function runAdapter(id: string, adapter: MacroAdapter, defs: SeriesDef[], nowMs: number, notes: Notes): Promise<AdapterSeries[]> {
      const tag = (series: AdapterSeries[], o: Origin) => { for (const x of series) if (x.ok) notes.origin.set(x.id, o); return series; };
      const cached = adapterCache.get(id);
      if (simulate === "off" && cached && cached.expires > nowMs) return tag(cached.series, "memory");
      // Disk: series still fresh for their frequency are reused as they are; only the others are asked for.
      const disk = new Map<string, { s: AdapterSeries; at: number }>();
      if (simulate === "off" && store) {
        for (const d of defs) {
          const e = store.get<AdapterSeries>(diskKey(id, d));
          if (e && e.value.id === d.id && e.value.ok) disk.set(d.id, { s: e.value, at: Date.parse(e.fetchedAt) });
        }
      }
      const freshOnDisk = (d: SeriesDef) => { const e = disk.get(d.id); return !!e && nowMs - e.at < ttlOf(adapter, d); };
      const todo = defs.filter((d) => !freshOnDisk(d));
      if (!todo.length) {
        const at = (d: SeriesDef) => disk.get(d.id)!.at;
        return tag(remember(id, defs.map((d) => disk.get(d.id)!.s), Math.min(...defs.map(at)), Math.min(...defs.map((d) => at(d) + ttlOf(adapter, d)))), "disk");
      }
      // Older copies to serve meanwhile, per series: the in-memory copy, else whatever the disk holds (after a restart).
      const older = new Map<string, { s: AdapterSeries; at: number }>();
      if (cached) for (const s of cached.series) if (s.ok) older.set(s.id, { s, at: cached.storedAt });
      for (const [k, e] of disk) if (!older.has(k)) older.set(k, e);
      for (const [k, e] of older) if (nowMs - e.at >= STALE_MAX_AGE_MS) older.delete(k);
      const olderAt = () => new Date(Math.min(...[...older.values()].map((e) => e.at))).toISOString();
      /** Every series: its fresh disk copy, else its older copy (marked), else `none`. */
      const compose = (none: (d: SeriesDef) => AdapterSeries, refreshing: boolean) => defs.map((d) => {
        if (freshOnDisk(d)) { notes.origin.set(d.id, "disk"); return disk.get(d.id)!.s; }
        const o = older.get(d.id);
        if (!o) return none(d);
        notes.origin.set(d.id, refreshing ? "refreshing" : "stale");
        return { ...o.s, staleCache: { fetchedAt: new Date(o.at).toISOString(), refreshing } };
      });
      const onFailure = (f: Failure) => {
        if (f.rl) notes.limited.push(f.rl);
        if (older.size) notes.stale.push(`${id} is unreachable (${f.cause}). Showing its data retrieved at ${olderAt()}.`);
        return compose((d) => failed(d, nowMs, f.cause, f.kind), false);
      };

      const cool = adapterFailure.get(id);
      if (simulate === "off" && cool && nowMs < cool.until) return onFailure({ cause: cool.message, kind: cool.kind, rl: cool.rateLimited });
      if (simulate === "outage") return onFailure(recordFailure(id, new Error(`Simulated outage: ${id} unreachable (MACRO_ALLOW_SIMULATE test switch).`), nowMs));

      // A provider that refuses all requests right now (FRED breaker open) is not refreshed at all, not even in the background.
      const refused = jobs.has(id) ? null : adapter.refusal?.();
      if (refused) return onFailure({ cause: refused.message, kind: refused.kind, rl: null });
      const job = jobs.get(id) ?? startJob(id, adapter, defs, todo, disk, nowMs);
      // Only series with no copy at all are worth waiting for, and only until the deadline counted from when the
      // refresh STARTED (a caller joining a refresh that already missed it does not wait again).
      const waitMs = todo.some((d) => !older.has(d.id)) ? job.startedAt + deadlineMs - Date.now() : 0;
      const r = waitMs > 0 ? await within(job.promise, waitMs) : undefined;
      if (r && "series" in r) {
        for (const x of r.series) if (x.ok) notes.origin.set(x.id, todo.some((d) => d.id === x.id) ? "fetched" : "disk");
        return r.series;
      }
      if (r) return onFailure(r.failure);
      if (waitMs > 0 && !job.background) console.info(`[macro-proxy] ${catalogue}/${id} missed the ${deadlineMs / 1000} s deadline; answering without it, the request continues in the background.`);
      job.background = true;
      notes.provisional.add(id);
      if (older.size) notes.stale.push(`${id}: its cached data (retrieved ${olderAt()}) is past its refresh interval; it is shown now while a refresh runs in the background.`);
      return compose((d) => pendingSeries(d, nowMs), true);
    }

    async function build(nowMs: number): Promise<Entry> {
      const notes: Notes = { stale: [], limited: [], origin: new Map(), provisional: new Set() };
      const byAdapter = await Promise.all(
        [...adaptersOf].map(async ([id, adapter]) => {
          const defs = catalogDefs.filter((d) => d.adapter === id);
          return defs.length ? { id, series: await runAdapter(id, adapter, defs, nowMs, notes) } : { id, series: [] as AdapterSeries[] };
        }),
      );
      const series: AdapterSeries[] = byAdapter.flatMap((a) => a.series).map((x) => {
        if (!trim) return x;
        const f = catalogDefs.find((d) => d.id === x.id)?.frequency;
        return f && x.observations.length > trim[f] ? { ...x, observations: x.observations.slice(-trim[f]) } : x;
      });
      const have = new Set(series.map((s) => s.id));
      // A configured series whose adapter is not mounted is reported, never silently dropped.
      for (const d of catalogDefs) if (!have.has(d.id)) series.push(failed(d, nowMs, `No adapter "${d.adapter}" is mounted for ${d.id}.`, "error"));
      const mountedIds = new Set(byAdapter.map((a) => a.id));
      const real = series.filter((s) => mountedIds.has(catalogDefs.find((d) => d.id === s.id)?.adapter ?? ""));
      const bad = series.filter((s) => !s.ok);
      const realBad = real.filter((s) => !s.ok);
      // Every source failed and none is still loading: the snapshot as a whole fails with the real cause.
      if (real.length > 0 && realBad.length === real.length && !realBad.some((s) => s.errorKind === "pending")) {
        if (notes.limited.length) throw notes.limited.reduce((a, b) => (b.retryAfterMs > a.retryAfterMs ? b : a));
        throw new Error([...new Set(realBad.map((s) => s.error))].slice(0, 3).join(" "));
      }
      const served = emptyServed();
      for (const s of real) {
        if (!s.ok) served[s.errorKind === "pending" ? "pending" : s.errorKind === "key_missing" ? "unrequested" : "failed"]++;
        else {
          const o = notes.origin.get(s.id) ?? "fetched";
          if (o === "refreshing") { served.stale++; served.refreshing++; } else served[o]++;
        }
      }
      const warnings = [...notes.stale, ...bad.map((s) => `${s.id}: ${s.error}`)];
      const cacheState = stateOf(served);
      return {
        snapshot: { adapter: [...adaptersOf.keys()].filter((id) => catalogDefs.some((d) => d.adapter === id)).join("+"), fetchedAt: new Date(nowMs).toISOString(), cacheState, served, warnings, series },
        storedAt: nowMs, expires: nowMs + SNAPSHOT_TTL_MS, provisional: [...notes.provisional],
      };
    }

    /**
     * The assembled snapshot answered again from memory: what was fetched or read from disk then is in memory now.
     * It is reused only while every background refresh it is waiting on is still running; once one lands, the next
     * request reassembles it from the adapter caches (no upstream request).
     */
    function reused(c: Entry) {
      const s = c.snapshot.served;
      if (!s) return { entry: c, cacheState: c.snapshot.cacheState };
      const served = { ...s, memory: s.memory + s.disk + s.fetched, disk: 0, fetched: 0 };
      const snapshot: MacroSnapshot = { ...c.snapshot, served, cacheState: stateOf(served) };
      return { entry: { ...c, snapshot }, cacheState: snapshot.cacheState };
    }

    async function load() {
      const now = Date.now();
      if (simulate === "off" && cache && cache.expires > now && cache.provisional.every((id) => jobs.has(id))) return reused(cache);
      if (inflight) return inflight; // single-flight
      if (lastFailure && now < lastFailure.until && simulate === "off") {
        if (cache && now - cache.storedAt < STALE_MAX_AGE_MS) return staleOf(cache, lastFailure.message);
        throw new Error(lastFailure.message);
      }
      inflight = (async () => {
        try {
          const entry = await build(now);
          cache = entry; lastFailure = null;
          return { entry, cacheState: entry.snapshot.cacheState };
        } catch (err) {
          const cause = scrub(errMessage(err), secrets);
          const until = now + (err instanceof RateLimitedError ? err.retryAfterMs : FAILURE_COOLDOWN_MS);
          lastFailure = { at: now, message: cause, until };
          console.warn(`[macro-proxy] upstream fetch failed: ${cause}`);
          if (cache && now - cache.storedAt < STALE_MAX_AGE_MS) return staleOf(cache, cause);
          throw err;
        } finally { inflight = null; }
      })();
      return inflight;
    }

    function staleOf(c: Entry, cause: string) {
      // The refresh this older snapshot was waiting on has ended (it failed): nothing is loading any more, so the page stops polling.
      const served = c.snapshot.served && { ...c.snapshot.served, refreshing: 0, pending: 0 };
      const snapshot: MacroSnapshot = { ...c.snapshot, served, cacheState: "STALE", warnings: [`The data source is unreachable (${cause}). Showing data retrieved at ${c.snapshot.fetchedAt}.`, ...c.snapshot.warnings] };
      return { entry: { ...c, snapshot }, cacheState: "STALE" as const };
    }
    /** The cached series for an id from the last assembled snapshot, without any upstream request (undefined if none). */
    const peek = (id: string) => cache?.snapshot.series.find((x) => x.id === id && x.ok);
    return { load, peek, reset(clear: boolean) { lastFailure = null; if (clear) { cache = null; adapterCache.clear(); store?.clear(); } } };
  }

  const main = makeLoader("overview", SERIES, byId);
  // The US catalogue reads 6 years of FRED history (enough for the table, sparkline and y/y); detail views fetch the full history.
  const usAdapters = new Map(byId);
  if (byId.has("fred") && !adapters) usAdapters.set("fred", fredAdapter(env.FRED_API_KEY, { compact: true }));
  const us = makeLoader("us", US_SERIES, usAdapters, US_TRIM);
  /** Opening the US section makes US detail views likely: warm their shared reaction data (no-op without a key or while the FRED breaker is open). */
  const prewarmShared = () => { if (!adapters && !fredPaused()) detail.prewarm(); };
  // Overview series that are not on FRED reuse the overview snapshot's copy (same provider data, same history window), so opening
  // their detail view costs no upstream request. The US catalogue is trimmed for the table, so it is not reused.
  const detail = createDetailService({ defs: ALL_BY_ID, adapters: byId, fredKey: env.FRED_API_KEY, fromSnapshot: (id) => main.peek(id), store });

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    const url = new URL(req.url ?? "", "http://x");
    if (!url.pathname.startsWith("/macro-proxy/")) { next(); return; }
    const route = url.pathname.slice("/macro-proxy/".length);

    if (route === "_simulate" && req.method === "POST") {
      if (!allowSimulate()) { sendJson(res, { results: null, warnings: [{ message: "Not found." }] }, 404); return; }
      const mode = url.searchParams.get("mode");
      if (mode !== "off" && mode !== "outage") { sendJson(res, { results: null, warnings: [{ message: "mode must be off|outage" }] }, 400); return; }
      simulate = mode;
      adapterFailure.clear();
      const clear = url.searchParams.get("clear") === "1";
      // a mode change must not be answered with the previous mode's remembered failure
      main.reset(clear); us.reset(clear);
      sendJson(res, { results: { simulate, cacheCleared: clear } });
      return;
    }
    if (req.method !== "GET") { next(); return; }
    if (route === "series") {
      const id = url.searchParams.get("id") ?? "";
      try {
        const { detail: d, cacheState } = await detail.get(id);
        res.setHeader("x-bbterminal-cache", cacheState);
        res.setHeader("cache-control", "no-store");
        sendJson(res, { results: d });
      } catch (err) {
        if (err instanceof RateLimitedError) res.setHeader("retry-after", String(Math.ceil(err.retryAfterMs / 1000)));
        sendJson(res, { results: null, warnings: [{ message: scrub(errMessage(err), secrets) }] }, (err as { status?: number }).status === 404 ? 404 : 502);
      }
      return;
    }
    if (route === "calendar") {
      try {
        res.setHeader("cache-control", "no-store");
        sendJson(res, { results: { fetchedAt: new Date().toISOString(), source: "FRED release calendar (dates from the agencies' published schedules)", releases: await detail.calendar() } });
      } catch (err) { sendJson(res, { results: null, warnings: [{ message: scrub(errMessage(err), secrets) }] }, 502); }
      return;
    }
    if (route !== "snapshot" && route !== "us") { sendJson(res, { results: null, warnings: [{ message: `Unknown macro route "${route}". Use /macro-proxy/snapshot, /macro-proxy/us or /macro-proxy/series?id=….` }] }, 404); return; }

    try {
      const { entry, cacheState } = await (route === "us" ? us : main).load();
      if (route === "us") prewarmShared();
      res.setHeader("x-bbterminal-cache", cacheState);
      res.setHeader("cache-control", "no-store");
      // The page only needs what a row shows (latest, previous, y/y base, 48-point sparkline); detail views fetch full history.
      // The server keeps the untrimmed copy, which detail views of non-FRED series reuse.
      const series = route === "snapshot" ? entry.snapshot.series.map((x) => {
        const f = SERIES.find((d) => d.id === x.id)?.frequency;
        return f && x.observations.length > US_TRIM[f] ? { ...x, observations: x.observations.slice(-US_TRIM[f]) } : x;
      }) : entry.snapshot.series;
      sendJson(res, { results: { ...entry.snapshot, series, cacheState } });
    } catch (err) {
      if (err instanceof RateLimitedError) res.setHeader("retry-after", String(Math.ceil(err.retryAfterMs / 1000)));
      sendJson(res, { results: null, warnings: [{ message: scrub(errMessage(err), secrets) }] }, 502);
    }
  }

  const plugin = middlewarePlugin("bbterminal-macro-proxy", handle);
  const mountPreview = plugin.configurePreviewServer;
  return {
    ...plugin,
    configureServer(server) {
      isDevServer = true;
      if (simulateRequested && process.env.NODE_ENV !== "production") console.warn("[macro-proxy] MACRO_ALLOW_SIMULATE active: /macro-proxy/_simulate enabled (dev server only).");
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      if (simulateRequested) console.warn("[macro-proxy] MACRO_ALLOW_SIMULATE ignored: not the dev server.");
      return typeof mountPreview === "function" ? mountPreview.call(this, server) : undefined;
    },
  };
}
