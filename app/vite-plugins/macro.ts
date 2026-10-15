import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { middlewarePlugin, sendJson, errMessage } from "./shared";
import { SERIES } from "../src/lib/macro/config";
import { US_SERIES } from "../src/lib/macro/usCatalog";
import { ALL_BY_ID } from "../src/lib/macro/catalog";
import type { AdapterSeries, ErrorKind, MacroSnapshot, SeriesDef } from "../src/lib/macro/types";
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
// The assembled snapshot is held for a few minutes. Concurrent callers
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

interface Entry { snapshot: MacroSnapshot; storedAt: number; expires: number }
interface AdapterEntry { series: AdapterSeries[]; storedAt: number; expires: number }
interface AdapterFailure { message: string; until: number; kind: ErrorKind; rateLimited: RateLimitedError | null }

export function macroProxyPlugin(
  simulateRequested = false,
  adapters: MacroAdapter[] | undefined = undefined,
  env: Record<string, string | undefined> = process.env,
): Plugin {
  const mounted = adapters ?? [dbnomicsAdapter, ...directAdapters(env)];
  const secrets = [env.BLS_API_KEY, env.FRED_API_KEY];
  const cacheDir = resolveCacheDir(env);
  const store: MacroDiskCache | null = cacheDir ? createDiskCache(cacheDir, secrets) : null;
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

  /** One cached, single-flight snapshot loader per catalogue. Adapter caches are per catalogue (different series sets). */
  function makeLoader(catalogue: string, catalogDefs: SeriesDef[], adaptersOf: Map<string, MacroAdapter>, trim?: Record<SeriesDef["frequency"], number>) {
    let cache: Entry | null = null;
    let inflight: Promise<{ entry: Entry; cacheState: "HIT" | "MISS" | "STALE" }> | null = null;
    let lastFailure: { at: number; message: string; until: number } | null = null;
    const adapterCache = new Map<string, AdapterEntry>();

    const failed = (d: SeriesDef, nowMs: number, message: string, kind: ErrorKind): AdapterSeries =>
      ({ id: d.id, ok: false, error: message, errorKind: kind, observations: [], provider: d.provider, sourceUrl: "", refreshedAt: null, retrievedAt: new Date(nowMs).toISOString() });

    const diskKey = (adapterId: string, d: SeriesDef) => `${catalogue}/${adapterId}/${d.id}`;
    const ttlOf = (adapter: MacroAdapter, d: SeriesDef) => adapter.cacheMs ?? FREQ_TTL_MS[d.frequency];

    /** Runs one adapter through its cache. Never throws: failures come back as per-series errors or as older data plus a stale note. */
    async function runAdapter(id: string, adapter: MacroAdapter, defs: SeriesDef[], nowMs: number, notes: { stale: string[]; fetched: { n: number }; limited: RateLimitedError[] }): Promise<AdapterSeries[]> {
      const cached = adapterCache.get(id);
      if (simulate === "off" && cached && cached.expires > nowMs) return cached.series;
      // Disk: series still fresh for their frequency are reused as they are; only the others are asked for.
      const disk = new Map<string, { s: AdapterSeries; at: number }>();
      if (simulate === "off" && store) {
        for (const d of defs) {
          const e = store.get<AdapterSeries>(diskKey(id, d));
          if (e && e.value.id === d.id && e.value.ok) disk.set(d.id, { s: e.value, at: Date.parse(e.fetchedAt) });
        }
      }
      const freshOnDisk = (d: SeriesDef) => { const e = disk.get(d.id); return !!e && nowMs - e.at < ttlOf(adapter, d); };
      const remember = (series: AdapterSeries[], storedAt: number, expires: number) => { adapterCache.set(id, { series, storedAt, expires }); return series; };
      const todo = defs.filter((d) => !freshOnDisk(d));
      if (!todo.length) {
        const at = (d: SeriesDef) => disk.get(d.id)!.at;
        return remember(defs.map((d) => disk.get(d.id)!.s), Math.min(...defs.map(at)), Math.min(...defs.map((d) => at(d) + ttlOf(adapter, d))));
      }
      // Older data to fall back on: the in-memory copy, else whatever the disk holds (after a restart).
      const older = cached ? { series: cached.series, storedAt: cached.storedAt }
        : disk.size ? { series: defs.map((d) => disk.get(d.id)?.s ?? failed(d, nowMs, "Not retrieved yet.", "error")), storedAt: Math.min(...[...disk.values()].map((e) => e.at)) }
        : null;
      const cool = adapterFailure.get(id);
      const useOlder = (cause: string) => {
        notes.stale.push(`${id} is unreachable (${cause}). Showing its data retrieved at ${new Date(older!.storedAt).toISOString()}.`);
        return older!.series;
      };
      if (simulate === "off" && cool && nowMs < cool.until) {
        if (cool.rateLimited) notes.limited.push(cool.rateLimited);
        if (older && nowMs - older.storedAt < STALE_MAX_AGE_MS) return useOlder(cool.message);
        return defs.map((d) => failed(d, nowMs, cool.message, cool.kind));
      }
      try {
        if (simulate === "outage") throw new Error(`Simulated outage: ${id} unreachable (MACRO_ALLOW_SIMULATE test switch).`);
        const got = await adapter.fetchSeries(todo, nowMs);
        notes.fetched.n++;
        adapterFailure.delete(id);
        const fetchedAt = new Date(nowMs).toISOString();
        for (const x of got) {
          const d = todo.find((t) => t.id === x.id);
          if (d && x.ok && store && simulate === "off") store.set(diskKey(id, d), { source: x.provider || id, seriesId: x.id, fetchedAt, value: x });
        }
        const byId = new Map(got.map((x) => [x.id, x]));
        const series = defs.map((d) => byId.get(d.id) ?? disk.get(d.id)?.s).filter((x): x is AdapterSeries => !!x);
        const usable = series.some((x) => x.ok);
        // Expires when the first of its series is due again (only that one is refetched then).
        const due = defs.map((d) => (byId.has(d.id) ? nowMs : disk.get(d.id)?.at ?? nowMs) + ttlOf(adapter, d));
        return remember(series, nowMs, usable ? Math.min(...due) : nowMs + ALL_FAILED_RETRY_MS);
      } catch (err) {
        const cause = scrub(errMessage(err), secrets);
        const rl = err instanceof RateLimitedError ? new RateLimitedError(cause, err.retryAfterMs) : null;
        const kind: ErrorKind = err instanceof AdapterError ? err.kind : "error";
        adapterFailure.set(id, { message: cause, until: nowMs + (rl ? rl.retryAfterMs : FAILURE_COOLDOWN_MS), kind, rateLimited: rl });
        if (rl) notes.limited.push(rl);
        console.warn(`[macro-proxy] ${id} fetch failed: ${cause}`);
        if (older && nowMs - older.storedAt < STALE_MAX_AGE_MS) return useOlder(cause);
        return defs.map((d) => failed(d, nowMs, cause, kind));
      }
    }

    async function build(nowMs: number): Promise<Entry> {
      const notes = { stale: [] as string[], fetched: { n: 0 }, limited: [] as RateLimitedError[] };
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
      if (real.length > 0 && realBad.length === real.length) {
        if (notes.limited.length) throw notes.limited.reduce((a, b) => (b.retryAfterMs > a.retryAfterMs ? b : a));
        throw new Error([...new Set(realBad.map((s) => s.error))].slice(0, 3).join(" "));
      }
      const warnings = [...notes.stale, ...bad.map((s) => `${s.id}: ${s.error}`)];
      const cacheState = notes.stale.length ? "STALE" : notes.fetched.n > 0 ? "MISS" : "HIT";
      return {
        snapshot: { adapter: [...adaptersOf.keys()].filter((id) => catalogDefs.some((d) => d.adapter === id)).join("+"), fetchedAt: new Date(nowMs).toISOString(), cacheState, warnings, series },
        storedAt: nowMs, expires: nowMs + SNAPSHOT_TTL_MS,
      };
    }

    async function load() {
      const now = Date.now();
      if (simulate === "off" && cache && cache.expires > now) return { entry: cache, cacheState: "HIT" as const };
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
      const snapshot: MacroSnapshot = { ...c.snapshot, cacheState: "STALE", warnings: [`The data source is unreachable (${cause}). Showing data retrieved at ${c.snapshot.fetchedAt}.`, ...c.snapshot.warnings] };
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
