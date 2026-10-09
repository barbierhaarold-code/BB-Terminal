import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { middlewarePlugin, sendJson, errMessage } from "./shared";
import { FEEDS, MAX_ITEMS } from "../src/lib/policy/config";
import { mergeItems } from "../src/lib/policy/filter";
import { looksLikeFeed, parseFeed } from "../src/lib/policy/parse";
import type { FeedDef, FeedHealth, PolicyItem, PolicySnapshot } from "../src/lib/policy/types";

// ────────────────────────────────────────────────────────────
// /policy-proxy — Policy Feed. One snapshot of every configured official RSS/Atom feed.
//
// Politeness: each feed is fetched at most once per its own cache window (15 min), concurrent callers share one
// refresh (single-flight), requests to the same host are spaced ≥ 1 s apart (different hosts run in parallel), a
// failed feed is retried only after 5 min (or its Retry-After), and the honest User-Agent names the tool and what it
// does. No keys, no scraping, no bot-challenge bypass: a 403 or a challenge page becomes the feed's visible health
// state ("unavailable (HTTP 403)") and the other feeds keep working. A feed that failed after an earlier success keeps
// serving its older items, marked stale.
// ────────────────────────────────────────────────────────────

export const USER_AGENT = "AbdelKhaderTerminal/1.0 (personal market-data terminal; reads public central-bank RSS/Atom feeds)";
const TIMEOUT_MS = 20_000;
const MAX_BODY = 3_000_000;
const HOST_SPACING_MS = 1_000;
const FAILURE_RETRY_MS = 5 * 60_000;
const STALE_MAX_MS = 7 * 24 * 3_600_000;

interface FeedState { items: PolicyItem[]; okAt: number | null; attemptAt: number; error: string | null; retryAfterMs: number; refreshing: boolean }
export type FeedFetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; statusText: string; headers: { get(n: string): string | null }; text(): Promise<string> }>;

export interface PolicyOptions { feeds?: FeedDef[]; fetcher?: FeedFetcher; now?: () => number; sleep?: (ms: number) => Promise<void> }

export function policyProxyPlugin(o: PolicyOptions = {}): Plugin {
  const feeds = o.feeds ?? FEEDS;
  const fetcher: FeedFetcher = o.fetcher ?? ((url, init) => fetch(url, init));
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const state = new Map<string, FeedState>(feeds.map((f) => [f.id, { items: [], okAt: null, attemptAt: 0, error: null, retryAfterMs: 0, refreshing: false }]));
  let inflight: Promise<boolean> | null = null;
  const hostChain = new Map<string, Promise<unknown>>();
  const hostLast = new Map<string, number>();

  /** Serialises requests per host with a minimum spacing. */
  function viaHost<T>(url: string, run: () => Promise<T>): Promise<T> {
    const host = new URL(url).host;
    const prev = hostChain.get(host) ?? Promise.resolve();
    const step = async () => {
      const wait = (hostLast.get(host) ?? 0) + HOST_SPACING_MS - now();
      if (wait > 0) await sleep(wait);
      hostLast.set(host, now());
      return run();
    };
    const p = prev.then(step, step);
    hostChain.set(host, p.catch(() => undefined));
    return p;
  }

  async function fetchOne(def: FeedDef): Promise<void> {
    const st = state.get(def.id)!;
    st.attemptAt = now();
    try {
      const res = await viaHost(def.url, () => fetcher(def.url, { headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5" }, signal: AbortSignal.timeout(TIMEOUT_MS) }));
      const body = (await res.text()).slice(0, MAX_BODY);
      if (res.status === 429) { const ra = Number(res.headers.get("retry-after")); st.retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : FAILURE_RETRY_MS; throw new Error("HTTP 429 Too Many Requests (rate limited)"); }
      if (/just a moment|cf-chl|challenge-platform/i.test(body.slice(0, 4000)) && res.status >= 400) throw new Error(`HTTP ${res.status}: the site answers with a bot challenge, which this terminal does not bypass`);
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}${res.status === 403 ? " (the site refuses automated readers; not worked around)" : ""}`);
      if (!looksLikeFeed(body)) throw new Error(`HTTP ${res.status} but the answer is not an RSS/Atom feed`);
      const items = parseFeed(body, def);
      if (items.length === 0) throw new Error("the feed was readable but contained no items");
      st.items = items; st.okAt = now(); st.error = null; st.retryAfterMs = 0;
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } };
      st.error = e.name === "TimeoutError" ? `no answer within ${TIMEOUT_MS / 1000}s` : (e.cause?.code ? `${e.message} (${e.cause.code})` : e.message);
      if (!st.retryAfterMs) st.retryAfterMs = FAILURE_RETRY_MS;
      console.warn(`[policy-proxy] ${def.id}: ${st.error}`);
    }
  }

  const due = (def: FeedDef) => {
    const st = state.get(def.id)!;
    if (st.attemptAt === 0) return true;
    const age = now() - st.attemptAt;
    return st.error ? age >= Math.max(st.retryAfterMs, 0) : age >= def.cacheMs;
  };

  async function refresh(): Promise<boolean> {
    const todo = feeds.filter(due);
    if (todo.length === 0) return false;
    await Promise.all(todo.map(fetchOne));
    return true;
  }

  async function snapshot(): Promise<PolicySnapshot> {
    let fetched = false;
    if (inflight) fetched = await inflight;
    else { inflight = refresh().finally(() => { inflight = null; }); fetched = await inflight; }
    const t = now();
    const health: FeedHealth[] = feeds.map((def) => {
      const st = state.get(def.id)!;
      const usable = st.items.length > 0 && st.okAt != null && t - st.okAt < STALE_MAX_MS;
      const dates = st.items.map((i) => i.publishedAt).filter((x): x is string => !!x).sort();
      return { id: def.id, institution: def.institution, label: def.label, contentType: def.contentType, url: def.url, ok: !st.error, error: st.error ?? undefined, items: usable ? st.items.length : 0, newest: dates.at(-1) ?? null, fetchedAt: st.okAt ? new Date(st.okAt).toISOString() : null, stale: !!st.error && usable };
    });
    const lists = feeds.map((def) => { const st = state.get(def.id)!; return st.items.length > 0 && st.okAt != null && t - st.okAt < STALE_MAX_MS ? st.items : []; });
    const items = mergeItems(lists, MAX_ITEMS);
    const anyStale = health.some((h) => h.stale);
    return { fetchedAt: new Date(t).toISOString(), cacheState: fetched ? "MISS" : anyStale ? "STALE" : "HIT", feeds: health, items };
  }

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    const url = new URL(req.url ?? "", "http://x");
    if (!url.pathname.startsWith("/policy-proxy/")) { next(); return; }
    if (req.method !== "GET") { next(); return; }
    const route = url.pathname.slice("/policy-proxy/".length);
    if (route !== "feed") { sendJson(res, { results: null, warnings: [{ message: `Unknown policy route "${route}". Use /policy-proxy/feed.` }] }, 404); return; }
    try {
      const snap = await snapshot();
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-bbterminal-cache", snap.cacheState);
      if (snap.feeds.every((f) => f.items === 0)) {
        sendJson(res, { results: null, warnings: [{ message: `No official feed could be read. ${snap.feeds.slice(0, 3).map((f) => `${f.institution} ${f.label}: ${f.error}`).join("; ")}` }] }, 502);
        return;
      }
      sendJson(res, { results: snap });
    } catch (err) {
      sendJson(res, { results: null, warnings: [{ message: errMessage(err) }] }, 502);
    }
  }
  return middlewarePlugin("bbterminal-policy-proxy", handle);
}
