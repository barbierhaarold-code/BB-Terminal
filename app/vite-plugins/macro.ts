import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { middlewarePlugin, sendJson, errMessage } from "./shared";
import { SERIES } from "../src/lib/macro/config";
import type { MacroSnapshot } from "../src/lib/macro/types";
import { dbnomicsAdapter, RateLimitedError, type MacroAdapter } from "./macroAdapters";

// ────────────────────────────────────────────────────────────
// /macro-proxy — Macro Hub data. ONE upstream request fetches every configured
// series (DBnomics accepts a list of series ids), so a page load costs one browser
// request and at most one upstream request, however many series there are.
//
// The data updates daily to quarterly, so the snapshot is cached for hours and
// single-flighted (concurrent callers share one upstream round-trip). Errors are
// honest: the real HTTP cause is passed through. If the upstream fails and an older
// snapshot exists it is served marked STALE with a warning. An upstream 429 is
// honoured (Retry-After), and a failure is remembered for a few seconds so a burst
// of Retry clicks cannot hammer the provider.
//
// DBnomics publishes no rate limit and sends no rate-limit headers (checked
// 2026-10-09), so the self-imposed budget is: one request per refresh, at most one
// refresh per 6 h in normal operation.
//
// Dev-only switch: MACRO_ALLOW_SIMULATE=1 enables POST /macro-proxy/_simulate for
// outage tests; same three-part gate as the COT plugin (see below).
// ────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 6 * 60 * 60_000;
const STALE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const FAILURE_COOLDOWN_MS = 5_000;

interface Entry { snapshot: MacroSnapshot; storedAt: number; expires: number }

export function macroProxyPlugin(simulateRequested = false, adapters: MacroAdapter[] = [dbnomicsAdapter]): Plugin {
  // The outage-simulation endpoint is DEV-ONLY. It is live only when ALL hold:
  //   1. MACRO_ALLOW_SIMULATE=1 was set (simulateRequested),
  //   2. this plugin was mounted through Vite's `configureServer` hook, i.e. the dev server
  //      (the production gateway in server/index.ts and `vite preview` only ever call
  //      `configurePreviewServer`, which never sets `isDevServer`),
  //   3. NODE_ENV is not "production".
  let isDevServer = false;
  const allowSimulate = () => simulateRequested && isDevServer && process.env.NODE_ENV !== "production";
  let simulate: "off" | "outage" = "off";
  let cache: Entry | null = null;
  let inflight: Promise<{ entry: Entry; cacheState: "HIT" | "MISS" | "STALE" }> | null = null;
  let lastFailure: { at: number; message: string; until: number } | null = null;
  const byId = new Map(adapters.map((a) => [a.id, a]));

  async function build(nowMs: number): Promise<Entry> {
    const series: MacroSnapshot["series"] = [];
    const warnings: string[] = [];
    for (const [id, adapter] of byId) {
      const defs = SERIES.filter((d) => d.adapter === id);
      if (defs.length === 0) continue;
      if (simulate === "outage") throw new Error(`Simulated outage: ${id} unreachable (MACRO_ALLOW_SIMULATE test switch).`);
      series.push(...(await adapter.fetchSeries(defs, nowMs)));
    }
    const bad = series.filter((s) => !s.ok);
    for (const s of bad) warnings.push(`${s.id}: ${s.error}`);
    if (series.length > 0 && bad.length === series.length) throw new Error(`The data source answered but returned no usable series. ${bad[0].error}`);
    return {
      snapshot: { adapter: [...byId.keys()].join("+"), fetchedAt: new Date(nowMs).toISOString(), cacheState: "MISS", warnings, series },
      storedAt: nowMs, expires: nowMs + CACHE_TTL_MS,
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
        return { entry, cacheState: "MISS" as const };
      } catch (err) {
        const cause = errMessage(err);
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

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    const url = new URL(req.url ?? "", "http://x");
    if (!url.pathname.startsWith("/macro-proxy/")) { next(); return; }
    const route = url.pathname.slice("/macro-proxy/".length);

    if (route === "_simulate" && req.method === "POST") {
      if (!allowSimulate()) { sendJson(res, { results: null, warnings: [{ message: "Not found." }] }, 404); return; }
      const mode = url.searchParams.get("mode");
      if (mode !== "off" && mode !== "outage") { sendJson(res, { results: null, warnings: [{ message: "mode must be off|outage" }] }, 400); return; }
      simulate = mode;
      lastFailure = null; // a mode change must not be answered with the previous mode's remembered failure
      const clear = url.searchParams.get("clear") === "1";
      if (clear) { cache = null; lastFailure = null; }
      sendJson(res, { results: { simulate, cacheCleared: clear } });
      return;
    }
    if (req.method !== "GET") { next(); return; }
    if (route !== "snapshot") { sendJson(res, { results: null, warnings: [{ message: `Unknown macro route "${route}". Use /macro-proxy/snapshot.` }] }, 404); return; }

    try {
      const { entry, cacheState } = await load();
      res.setHeader("x-bbterminal-cache", cacheState);
      res.setHeader("cache-control", "no-store");
      sendJson(res, { results: { ...entry.snapshot, cacheState } });
    } catch (err) {
      if (err instanceof RateLimitedError) res.setHeader("retry-after", String(Math.ceil(err.retryAfterMs / 1000)));
      sendJson(res, { results: null, warnings: [{ message: errMessage(err) }] }, 502);
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
