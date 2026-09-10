import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const API_PREFIX = "/api";
const API_TARGET = "http://127.0.0.1:6900";
const UPSTREAM_TIMEOUT_MS = 25_000;
// HEAT/QCARD can fan out 60-120+ individual requests on one page load/range
// switch; without a cap they all hit the OpenBB backend at once, which is
// what triggered both the yfinance rate-limit and sporadic upstream
// connection failures during testing. Cap concurrency, queue the rest. The
// backend is a single Python/uvicorn process, so keep this modest — a wider
// gate just moves the pile-up from "queued here" to "timing out there."
const MAX_CONCURRENT_UPSTREAM = 6;

interface CacheEntry {
  status: number;
  contentType: string;
  body: Buffer;
  expires: number;
}

/**
 * Tiered TTL for the OpenBB API proxy. This is a read-only market-data API
 * (the whole app only ever issues GET — no writes to cache-bust), and
 * QCARD/HEAT's per-ticker fan-outs were re-requesting the same daily-interval
 * history on every page load / range switch with zero caching anywhere in the
 * stack — the direct cause of the yfinance "Too Many Requests" rate-limit hit
 * during HEAT testing. Live-feel surfaces (XAU scalper, FX board — 5m/15m/1h
 * intraday polling every 20-30s) get a short TTL so they still feel live;
 * slow-changing data (daily/weekly history, treasury, profile) is cached for
 * minutes, since none of it moves meaningfully faster than that.
 */
function ttlForUrl(url: string): number {
  const u = new URL(url, "http://internal");
  const pathname = u.pathname;
  const interval = u.searchParams.get("interval");

  if (pathname.includes("/fixedincome/government/treasury_rates")) return 30 * 60_000;
  // 13F filings only change quarterly and each fund's full holdings list can
  // run into the thousands of rows (Vanguard: ~8.4k) — the Funds/Ranking
  // tabs fan out to 20+ funds on load, so a short TTL would re-pull that
  // whole payload set on every tab switch for data that's static for months.
  if (pathname.includes("/equity/ownership/form_13f")) return 60 * 60_000;
  if (pathname.includes("/regulators/sec/institutions_search")) return 60 * 60_000;
  // 5 min, not 30: yfinance/OpenBB was observed returning a degraded profile
  // payload (missing employees/HQ/phone/website/beta) with a normal 200 —
  // isCacheableBody() below rejects those, but a short TTL bounds the damage
  // from any degraded-but-passing snapshot that slips through.
  if (pathname.includes("/equity/profile")) return 5 * 60_000;
  if (pathname.includes("/news/")) return 60_000;
  if (pathname.includes("/equity/discovery/")) return 60_000;
  if (interval === "5m" || interval === "15m" || interval === "1h") return 15_000;
  if (interval === "1d" || interval === "1W") return 180_000;
  if (pathname.includes("/price/quote")) return 20_000;
  return 30_000;
}

/**
 * yfinance/OpenBB was observed returning a *degraded* 200 for the same
 * symbol seconds apart: a quote missing last_price/prev_close/open/volume
 * (while bid/ask/year_high/moving-averages still came through), and a
 * profile missing employees/HQ/phone/website/beta (while dividend_yield/
 * market_cap still came through). Both looked like a normal successful
 * response to the naive "was it 200 with a body" check, so they got cached
 * and served as DES's data for the rest of the TTL. Require the field a
 * consumer actually needs before trusting a response enough to cache it —
 * worst case we just cache less, not wrong data.
 */
function isCacheableBody(pathname: string, buf: Buffer): boolean {
  if (!pathname.includes("/equity/price/quote") && !pathname.includes("/equity/profile")) return true;
  try {
    const json = JSON.parse(buf.toString("utf8"));
    const row = Array.isArray(json?.results) ? json.results[0] : json?.results;
    if (!row) return false;
    if (pathname.includes("/equity/price/quote")) return row.last_price != null;
    if (pathname.includes("/equity/profile")) return row.employees != null || row.hq_country != null;
    return true;
  } catch {
    return false;
  }
}

/** Tiny counting semaphore so a HEAT/QCARD fan-out queues instead of flooding. */
function createGate(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return {
    acquire(): Promise<void> {
      if (active < max) { active++; return Promise.resolve(); }
      return new Promise((resolve) => queue.push(resolve));
    },
    release() {
      active--;
      const next = queue.shift();
      if (next) { active++; next(); }
    },
  };
}

// The Investors module fans out heavily to OpenBB's `sec` provider: the
// Funds tab pulls 21 institutional CIKs' full 13F holdings (Vanguard ~8.4k
// rows, Citadel ~13.5k), and Insider Trading pulls Form 4s for 60 tickers.
// Both are CPU-heavy on the single uvicorn process, but the harder failure
// found during testing was correctness, not just speed: the SEC provider's
// on-disk cache (`~/OpenBBUserData/cache/sql/sec_form4.db.gz`) isn't safe
// under concurrent writers — verified live via direct backend calls, several
// concurrent insider_trading requests each threw
// "OperationalError -> attempt to write a readonly database", not a timeout.
// Sharing the general MAX_CONCURRENT_UPSTREAM=6 gate made both problems
// worse. A single-flight gate serializes every SEC-provider call so the
// cache is never written concurrently, at the cost of a slower cold-cache
// load — acceptable for a personal tool where these results are then cached
// for a long TTL (see ttlForUrl above).
const FORM_13F_TIMEOUT_MS = 45_000;

function apiCachePlugin(): Plugin {
  const cache = new Map<string, CacheEntry>();
  const gate = createGate(MAX_CONCURRENT_UPSTREAM);
  const secGate = createGate(1);

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    if (!req.url?.startsWith(API_PREFIX) || req.method !== "GET") { next(); return; }

    const key = req.url;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expires > now) {
      res.statusCode = hit.status;
      res.setHeader("content-type", hit.contentType);
      res.setHeader("x-bbterminal-cache", "HIT");
      res.end(hit.body);
      return;
    }

    const isSecProvider = key.includes("provider=sec") || key.includes("/regulators/sec/");
    const isForm13F = key.includes("/equity/ownership/form_13f");
    const activeGate = isSecProvider ? secGate : gate;
    await activeGate.acquire();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), isForm13F ? FORM_13F_TIMEOUT_MS : UPSTREAM_TIMEOUT_MS);
      let upstream: Response;
      try {
        upstream = await fetch(API_TARGET + key, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      const contentType = upstream.headers.get("content-type") ?? "application/json";
      const pathname = new URL(key, "http://internal").pathname;
      if (upstream.ok && upstream.status !== 204 && buf.length > 0 && isCacheableBody(pathname, buf)) {
        cache.set(key, { status: upstream.status, contentType, body: buf, expires: now + ttlForUrl(key) });
      }
      res.statusCode = upstream.status;
      res.setHeader("content-type", contentType);
      res.setHeader("x-bbterminal-cache", "MISS");
      res.end(buf);
    } catch (err) {
      // A per-request upstream failure (backend hiccup, timeout) must not
      // become a fatal Vite dev-server error — that surfaces as a page-wide
      // blocking overlay for what should be one failed fetch. Fail this
      // request only; the app's existing loading/error UI states handle it.
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.setHeader("x-bbterminal-cache", "ERROR");
      res.end(JSON.stringify({ results: [], warnings: [{ message: String((err as Error)?.message ?? err) }] }));
    } finally {
      activeGate.release();
    }
  }

  return {
    name: "bbterminal-api-cache",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

// ────────────────────────────────────────────────────────────
// COT (Commitments of Traders) proxy — Tradingster mirrors the CFTC's
// weekly legacy futures-only report as a server-rendered HTML page (no API,
// no CORS headers), so it has to be fetched and parsed server-side like the
// OpenBB proxy above, not from the browser. Verified directly against the
// live page (view-source, not the rendered DOM): the position/percentage/
// trader-count numbers are plain text inside `<td class="number">`, but the
// week-over-week "Changes" row wraps its value in a nested
// `<span class='positive-num'|'negative-num'>` — a naive "no nested tags"
// regex misses that row entirely, so tags inside each cell are stripped
// before parsing. Column order (confirmed against the live table) is
// [NonComm Long, NonComm Short, NonComm Spreads, Comm Long, Comm Short,
// Total Long, Total Short, NonReportable Long, NonReportable Short],
// repeated for the positions row then the changes row.
// CFTC contract codes verified live against Tradingster's own page titles
// (each URL's rendered <title> was checked to actually name the contract
// below before being hardcoded here) — not guessed from memory.
const COT_CONTRACTS: Record<string, string> = {
  gold: "088691",     // COT Report: GOLD
  crude: "067651",    // COT Report: WTI-PHYSICAL
  eurusd: "099741",   // COT Report: EURO FX
  spx: "13874A",      // COT Report: E-MINI S&P 500
};
// COT reports are released weekly (Fridays, for the prior Tuesday) — no
// reason to re-scrape more than a few times a day.
const COT_TTL_MS = 6 * 60 * 60_000;

interface CotSnapshot {
  asOf: string;
  openInterest: number;
  nonCommercialLong: number;
  nonCommercialShort: number;
  nonCommercialLongChange: number;
  nonCommercialShortChange: number;
}

function parseCotHtml(html: string): CotSnapshot | null {
  const dateMatch = html.match(/Positions as of (\d{4}-\d{2}-\d{2})/);
  const oiMatch = html.match(/Open Interest:\s*(?:<[^>]+>)*\s*([\d,]+)/);
  if (!dateMatch) return null;

  const cells = [...html.matchAll(/<td class="number">([\s\S]*?)<\/td>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim());
  if (cells.length < 18) return null;

  const num = (s: string) => Number(s.replace(/,/g, ""));
  return {
    asOf: dateMatch[1],
    openInterest: oiMatch ? num(oiMatch[1]) : 0,
    nonCommercialLong: num(cells[0]),
    nonCommercialShort: num(cells[1]),
    nonCommercialLongChange: num(cells[9]),
    nonCommercialShortChange: num(cells[10]),
  };
}

function cotProxyPlugin(): Plugin {
  const cache = new Map<string, { data: CotSnapshot; expires: number }>();

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    const match = req.url?.match(/^\/cot-proxy\/([a-z0-9]+)$/);
    const code = match && COT_CONTRACTS[match[1]];
    if (!match || req.method !== "GET") { next(); return; }
    res.setHeader("content-type", "application/json");
    if (!code) {
      res.statusCode = 404;
      res.end(JSON.stringify({ results: null, warnings: [{ message: `Unknown COT contract "${match[1]}"` }] }));
      return;
    }

    const now = Date.now();
    const hit = cache.get(code);
    if (hit && hit.expires > now) {
      res.setHeader("x-bbterminal-cache", "HIT");
      res.end(JSON.stringify({ results: hit.data }));
      return;
    }

    try {
      const upstream = await fetch(`https://www.tradingster.com/cot/legacy-futures/${code}`);
      const html = await upstream.text();
      const parsed = upstream.ok ? parseCotHtml(html) : null;
      if (!parsed) throw new Error(`Could not parse Tradingster COT report (status ${upstream.status})`);
      cache.set(code, { data: parsed, expires: now + COT_TTL_MS });
      res.setHeader("x-bbterminal-cache", "MISS");
      res.end(JSON.stringify({ results: parsed }));
    } catch (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ results: null, warnings: [{ message: String((err as Error)?.message ?? err) }] }));
    }
  }

  return {
    name: "bbterminal-cot-proxy",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

// ────────────────────────────────────────────────────────────
// Twelve Data spot-metals proxy — GC=F/SI=F on the equity endpoint are
// COMEX *futures*, not spot, and carry a basis premium vs the XAU/USD price
// shown everywhere else (confirmed directly: GP's TradingView widget, on
// OANDA's real spot feed, consistently reads apart from GC=F). Twelve
// Data's free tier serves real spot XAU/USD directly (verified), but
// returns a 404 "Grow/Venture plan required" for XAG/USD — so only gold
// moves onto this feed; silver stays on SI=F with its futures disclaimer.
//
// The free tier is capped at 8 API credits/minute (and 800/day) — `/time_series`
// costs noticeably more per call than `/quote` (verified by exhausting the
// per-minute cap while probing this), so the two are cached very
// differently: `/quote` (last/high/low/change) is cheap and cached for
// 20s to match the existing board/scalper poll cadence; `/time_series`
// (candles, only needed for ATR) is expensive and cached for 5 minutes,
// however many components ask for either.
//
// This is the single choke point for every Twelve Data credit the app spends:
// XauScalper (quote + ATR series), TickerTape (quote), the FX board's gold
// row (renders <XauScalper/>, no own fetch), and the Copilot's
// get_scalper_snapshot tool (imperative fetchSpotQuote, outside React Query)
// all route through `/spot-proxy/*`. Two things on top of the symbol-keyed
// cache keep a burst of those consumers from each spending a credit:
//   1. single-flight — concurrent misses for the same key await one upstream
//      call instead of each firing their own (React Query dedupes its own
//      refetch, but a cold load + a StrictMode double-mount + a Copilot
//      question landing on the same tick are not one query);
//   2. a per-symbol request counter, logged every call, so "how many Twelve
//      Data credits did that sequence actually cost" is answerable from the
//      dev-server terminal (dev/build-only file — never ships to the browser).
// A cache-miss that comes back rate-limited is surfaced verbatim (honest
// "data unavailable", no retry) and is NOT cached, so recovery is immediate.
function spotMetalsPlugin(apiKey: string | undefined): Plugin {
  const TARGET = "https://api.twelvedata.com";
  const QUOTE_TTL_MS = 20_000;
  const SERIES_TTL_MS = 5 * 60_000;
  const cache = new Map<string, { body: string; expires: number }>();
  // key -> in-flight upstream call, so concurrent misses coalesce to one.
  const inflight = new Map<string, Promise<{ ok: boolean; body: string }>>();
  // Per-symbol tally within a rolling QUOTE_TTL_MS window: `served` = client
  // requests answered, `upstream` = actual Twelve Data calls made (credits
  // spent). In steady state upstream should be 0–1 per window per symbol.
  const usage = new Map<string, { served: number; upstream: number; windowStart: number }>();

  function bump(symbol: string, field: "served" | "upstream"): { served: number; upstream: number } {
    const now = Date.now();
    let u = usage.get(symbol);
    if (!u || now - u.windowStart >= QUOTE_TTL_MS) {
      u = { served: 0, upstream: 0, windowStart: now };
      usage.set(symbol, u);
    }
    u[field] += 1;
    return u;
  }

  async function callUpstream(kind: "quote" | "series", symbol: string, interval: string, cacheKey: string, ttl: number) {
    const existing = inflight.get(cacheKey);
    if (existing) return existing;

    const p = (async (): Promise<{ ok: boolean; body: string }> => {
      bump(symbol, "upstream");
      const upstreamPath = kind === "series"
        ? `/time_series?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&outputsize=100&apikey=${apiKey}`
        : `/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
      const upstream = await fetch(TARGET + upstreamPath);
      const json = await upstream.json();
      if (!upstream.ok || json.status === "error") {
        // Not cached — a transient rate-limit clears on the next call.
        throw new Error(json.message ?? `Twelve Data error (${upstream.status})`);
      }
      const body = JSON.stringify({ results: json });
      cache.set(cacheKey, { body, expires: Date.now() + ttl });
      return { ok: true, body };
    })();

    inflight.set(cacheKey, p);
    try {
      return await p;
    } finally {
      inflight.delete(cacheKey);
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    if (!req.url?.startsWith("/spot-proxy/") || req.method !== "GET") { next(); return; }

    res.setHeader("content-type", "application/json");
    if (!apiKey) {
      res.statusCode = 503;
      res.end(JSON.stringify({ results: null, warnings: [{ message: "TWELVE_DATA_API_KEY not configured" }] }));
      return;
    }

    const url = new URL(req.url, "http://internal");
    const kind = url.pathname === "/spot-proxy/series" ? "series" : "quote";
    const symbol = url.searchParams.get("symbol") ?? "XAU/USD";
    const interval = url.searchParams.get("interval") ?? "5min";
    const ttl = kind === "series" ? SERIES_TTL_MS : QUOTE_TTL_MS;
    const cacheKey = kind === "series" ? `series:${symbol}:${interval}` : `quote:${symbol}`;
    const now = Date.now();
    const u = bump(symbol, "served");

    const hit = cache.get(cacheKey);
    if (hit && hit.expires > now) {
      res.setHeader("x-bbterminal-cache", "HIT");
      console.log(`[spot-proxy] ${symbol} ${kind} HIT — window: ${u.upstream} upstream / ${u.served} served`);
      res.end(hit.body);
      return;
    }

    const coalesced = inflight.has(cacheKey);
    try {
      const { body } = await callUpstream(kind, symbol, interval, cacheKey, ttl);
      res.setHeader("x-bbterminal-cache", coalesced ? "COALESCED" : "MISS");
      console.log(`[spot-proxy] ${symbol} ${kind} ${coalesced ? "COALESCED" : "MISS"} — window: ${u.upstream} upstream / ${u.served} served`);
      res.end(body);
    } catch (err) {
      res.statusCode = 502;
      res.setHeader("x-bbterminal-cache", "ERROR");
      console.log(`[spot-proxy] ${symbol} ${kind} ERROR — window: ${u.upstream} upstream / ${u.served} served — ${String((err as Error)?.message ?? err)}`);
      res.end(JSON.stringify({ results: null, warnings: [{ message: String((err as Error)?.message ?? err) }] }));
    }
  }

  return {
    name: "bbterminal-spot-metals-proxy",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

// ────────────────────────────────────────────────────────────
// Quant service proxy (QUANT > Cointegration/Z-Score tabs) — forwards POSTs
// to the small local FastAPI process in quant_service/ (port 6901, started
// by start.sh alongside openbb-api). No caching: each request carries a
// different pair/lookback's price series in the body, so there's no stable
// cache key worth keying on, and the computation itself is cheap.
const QUANT_TARGET = "http://127.0.0.1:6901";

function quantProxyPlugin(): Plugin {
  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    if (!req.url?.startsWith("/quant-proxy/") || req.method !== "POST") { next(); return; }

    res.setHeader("content-type", "application/json");
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);

    try {
      const upstreamPath = req.url.slice("/quant-proxy".length);
      const upstream = await fetch(QUANT_TARGET + upstreamPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const text = await upstream.text();
      res.statusCode = upstream.status;
      if (upstream.ok) {
        res.end(JSON.stringify({ results: JSON.parse(text) }));
      } else {
        let detail = text;
        try { detail = JSON.parse(text)?.detail ?? text; } catch { /* not JSON */ }
        res.end(JSON.stringify({ results: null, warnings: [{ message: typeof detail === "string" ? detail : JSON.stringify(detail) }] }));
      }
    } catch (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ results: null, warnings: [{ message: String((err as Error)?.message ?? err) }] }));
    }
  }

  return {
    name: "bbterminal-quant-proxy",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

// ────────────────────────────────────────────────────────────
// GetXAPI proxy (Tweets tab) — a paid per-call X/Twitter data reseller
// (Bearer-token REST, $0.001/call on /twitter/user/tweets). The key must
// never reach the client bundle, same reasoning as spotMetalsPlugin above.
// Server-side cache TTL is a fixed floor independent of whatever poll
// interval the Tweets-tab settings panel is configured to — a cost safety
// net so a faster in-app setting can't multiply billed upstream calls.
function getXApiProxyPlugin(apiKey: string | undefined): Plugin {
  const TARGET = "https://api.getxapi.com";
  const TTL_MS = 4 * 60_000;
  const cache = new Map<string, { body: string; expires: number }>();

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    if (req.url?.split("?")[0] !== "/getx-proxy/user-tweets" || req.method !== "GET") { next(); return; }

    res.setHeader("content-type", "application/json");
    if (!apiKey) {
      res.statusCode = 503;
      res.end(JSON.stringify({ results: null, warnings: [{ message: "GETX_API_KEY not configured" }] }));
      return;
    }

    const url = new URL(req.url, "http://internal");
    const userNames = (url.searchParams.get("userNames") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const cacheKey = userNames.slice().sort().join(",");
    const now = Date.now();

    const hit = cache.get(cacheKey);
    if (hit && hit.expires > now) {
      res.setHeader("x-bbterminal-cache", "HIT");
      res.end(hit.body);
      return;
    }

    try {
      const perUser = await Promise.all(
        userNames.map(async (userName) => {
          const upstream = await fetch(`${TARGET}/twitter/user/tweets?userName=${encodeURIComponent(userName)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (!upstream.ok) return [];
          const json = await upstream.json().catch(() => null);
          const tweets = Array.isArray(json?.tweets) ? json.tweets : Array.isArray(json?.data) ? json.data : [];
          // Verified directly against a live GetXAPI response: fields are
          // camelCase (`createdAt`, not `created_at`), and `createdAt` is a
          // Twitter-format date string ("Sat Aug 22 02:32:52 +0000 2026"),
          // parseable by `new Date()` as-is.
          return tweets.map((t: Record<string, unknown>) => ({
            id: String(t.id ?? `${userName}-${t.createdAt}`),
            author: userName,
            text: String(t.text ?? ""),
            url: String(t.url ?? (t.id ? `https://x.com/${userName}/status/${t.id}` : "")),
            date: t.createdAt ? new Date(String(t.createdAt)).toISOString() : new Date().toISOString(),
          }));
        })
      );
      const merged = perUser.flat().sort((a, b) => (a.date > b.date ? -1 : 1));
      const body = JSON.stringify({ results: merged });
      cache.set(cacheKey, { body, expires: now + TTL_MS });
      res.setHeader("x-bbterminal-cache", "MISS");
      res.end(body);
    } catch (err) {
      res.statusCode = 502;
      res.setHeader("x-bbterminal-cache", "ERROR");
      res.end(JSON.stringify({ results: null, warnings: [{ message: String((err as Error)?.message ?? err) }] }));
    }
  }

  return {
    name: "bbterminal-getx-proxy",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

// ────────────────────────────────────────────────────────────
// Polymarket Gamma API proxy (Prediction Markets tab) — public read-only,
// no key, but no CORS headers either (verified: no `access-control-*`
// header on a direct curl), so it has to be proxied server-side like the
// COT scrape above. Pulls a curated set of tag_slugs (Fed decisions,
// macro/geopolitical events) rather than raw top-volume, which on
// Polymarket is dominated by sports and single-day crypto-price markets —
// verified directly against the live API.
const POLYMARKET_TAGS = ["fed", "interest-rates", "economy", "recession", "geopolitics", "international-affairs", "elections"];
const POLYMARKET_TTL_MS = 3 * 60_000;

interface PolymarketSubMarket {
  question: string; outcomes: string; outcomePrices: string;
  oneWeekPriceChange?: number; volume?: string; liquidity?: string;
  slug: string; endDate?: string;
}
interface PolymarketEvent {
  id: string; title: string; slug: string; endDate?: string;
  volume?: number; liquidity?: number; markets?: PolymarketSubMarket[];
}

function polymarketEventToRow(e: PolymarketEvent, tag: string) {
  const m = e.markets?.[0];
  if (!m) return null;
  let yesPrice: number | undefined;
  try {
    const outcomes: string[] = JSON.parse(m.outcomes ?? "[]");
    const prices: string[] = JSON.parse(m.outcomePrices ?? "[]");
    const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
    yesPrice = Number(prices[yesIdx >= 0 ? yesIdx : 0]);
  } catch {
    return null;
  }
  if (yesPrice == null || Number.isNaN(yesPrice)) return null;
  const weekChange = typeof m.oneWeekPriceChange === "number" ? m.oneWeekPriceChange : undefined;
  return {
    id: e.id,
    question: e.title,
    category: tag,
    probability: yesPrice,
    probabilityWeekAgo: weekChange != null ? yesPrice - weekChange : undefined,
    volume: e.volume ?? Number(m.volume ?? 0),
    liquidity: e.liquidity ?? Number(m.liquidity ?? 0),
    resolveDate: e.endDate ?? m.endDate ?? "",
    url: `https://polymarket.com/event/${e.slug}`,
  };
}

function predictionMarketsProxyPlugin(): Plugin {
  let cache: { body: string; expires: number } | null = null;

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    if (req.url !== "/polymarket-proxy/events" || req.method !== "GET") { next(); return; }

    res.setHeader("content-type", "application/json");
    const now = Date.now();
    if (cache && cache.expires > now) {
      res.setHeader("x-bbterminal-cache", "HIT");
      res.end(cache.body);
      return;
    }

    try {
      const perTag = await Promise.all(
        POLYMARKET_TAGS.map(async (tag) => {
          const url = `https://gamma-api.polymarket.com/events?closed=false&limit=8&tag_slug=${encodeURIComponent(tag)}&order=volume24hr&ascending=false`;
          const upstream = await fetch(url);
          if (!upstream.ok) return [];
          const json = (await upstream.json().catch(() => [])) as PolymarketEvent[];
          return Array.isArray(json) ? json.map((e) => polymarketEventToRow(e, tag)) : [];
        })
      );
      const seen = new Set<string>();
      const merged = perTag
        .flat()
        .filter((r): r is NonNullable<typeof r> => r != null)
        .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 24);
      const body = JSON.stringify({ results: merged });
      cache = { body, expires: now + POLYMARKET_TTL_MS };
      res.setHeader("x-bbterminal-cache", "MISS");
      res.end(body);
    } catch (err) {
      res.statusCode = 502;
      res.setHeader("x-bbterminal-cache", "ERROR");
      res.end(JSON.stringify({ results: null, warnings: [{ message: String((err as Error)?.message ?? err) }] }));
    }
  }

  return {
    name: "bbterminal-polymarket-proxy",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

// ────────────────────────────────────────────────────────────
// CongressInvests proxy (Investors > Congress tab) — a free, no-key,
// CORS-enabled aggregator of House/Senate STOCK Act trade disclosures
// (congressinvests.com). OpenBB's own `government_trades` command is
// FMP-only and 402-restricted on this app's free FMP tier (verified live),
// and Quiver Quantitative's API needs a paid plan even for data that shows
// on their free dashboard — this is proxied here not because of a CORS/key
// need (CORS is already open) but to cache against the free tier's
// 100-requests/day cap, same reasoning as the other proxies above.
const CONGRESS_API = "https://congressinvests.com";
const CONGRESS_PAGE_SIZE = 200;
const CONGRESS_PAGES = 3; // 600 most-recent disclosures, ~3 of the 100 free req/day
const CONGRESS_TTL_MS = 30 * 60_000;

function congressProxyPlugin(): Plugin {
  let cache: { body: string; expires: number } | null = null;

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    if (req.url !== "/congress-proxy/trades" || req.method !== "GET") { next(); return; }

    res.setHeader("content-type", "application/json");
    const now = Date.now();
    if (cache && cache.expires > now) {
      res.setHeader("x-bbterminal-cache", "HIT");
      res.end(cache.body);
      return;
    }

    try {
      const pages = await Promise.all(
        Array.from({ length: CONGRESS_PAGES }, (_, i) =>
          fetch(`${CONGRESS_API}/trades?limit=${CONGRESS_PAGE_SIZE}&offset=${i * CONGRESS_PAGE_SIZE}`)
            .then((r) => (r.ok ? r.json() : { trades: [] }))
            .catch(() => ({ trades: [] }))
        )
      );
      const merged = pages.flatMap((p) => (Array.isArray(p?.trades) ? p.trades : []));
      const body = JSON.stringify({ results: merged });
      cache = { body, expires: now + CONGRESS_TTL_MS };
      res.setHeader("x-bbterminal-cache", "MISS");
      res.end(body);
    } catch (err) {
      res.statusCode = 502;
      res.setHeader("x-bbterminal-cache", "ERROR");
      res.end(JSON.stringify({ results: null, warnings: [{ message: String((err as Error)?.message ?? err) }] }));
    }
  }

  return {
    name: "bbterminal-congress-proxy",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

// ────────────────────────────────────────────────────────────
// AI Copilot proxy (COPILOT panel) — forwards the chat/tool-calling loop to
// Anthropic's Messages API with the server-held key attached. There is
// deliberately no custom Python backend route for this: `openbb-api` on
// :6900 is a pip-installed package assembled by the OpenBB Platform itself,
// not code that lives in this repo (see quant_service/main.py's own comment
// for the same conclusion reached there), and the four Copilot tools need
// live access to browser-only state anyway — Track Record's trades and
// Portfolio's positions are Zustand stores persisted to localStorage
// (journalStore.ts / portfolioStore.ts), never synced to any backend. So the
// tool-calling loop itself runs client-side (see lib/copilotTools.ts), where
// it can call the exact same store getters and lib/api.ts fetchers the UI
// panels already use — zero reimplemented data access. This proxy's only
// job is keeping ANTHROPIC_API_KEY out of the browser bundle, same reasoning
// as spotMetalsPlugin/getXApiProxyPlugin above. The model string is forced
// here (not trusted from the request body) so it stays a one-line change.
const COPILOT_MODEL = "claude-sonnet-5";
const COPILOT_MAX_TOKENS = 2048;
const ANTHROPIC_VERSION = "2023-06-01";

function copilotProxyPlugin(apiKey: string | undefined): Plugin {
  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    if (req.url !== "/copilot-proxy/messages" || req.method !== "POST") { next(); return; }

    res.setHeader("content-type", "application/json");
    if (!apiKey) {
      res.statusCode = 503;
      res.end(JSON.stringify({ results: null, warnings: [{ message: "ANTHROPIC_API_KEY not configured — add it to app/.env and restart the dev server." }] }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ results: null, warnings: [{ message: "Malformed request body" }] }));
      return;
    }

    try {
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({ ...payload, model: COPILOT_MODEL, max_tokens: payload.max_tokens ?? COPILOT_MAX_TOKENS }),
      });
      const json = await upstream.json();
      if (!upstream.ok) {
        const message = json?.error?.message ?? `Anthropic API error (${upstream.status})`;
        res.statusCode = upstream.status;
        res.end(JSON.stringify({ results: null, warnings: [{ message }] }));
        return;
      }
      // Verification aid: log which tools the model actually invoked, right
      // where every other upstream call in this file already logs — visible
      // in the same dev-server terminal as the OpenBB/spot/COT proxy traffic.
      const toolCalls = Array.isArray(json?.content)
        ? json.content.filter((b: { type?: string }) => b?.type === "tool_use").map((b: { name?: string }) => b.name)
        : [];
      if (toolCalls.length > 0) {
        console.log(`[copilot] tool_use: ${toolCalls.join(", ")}`);
      }
      res.end(JSON.stringify({ results: json }));
    } catch (err) {
      res.statusCode = 502;
      res.end(JSON.stringify({ results: null, warnings: [{ message: String((err as Error)?.message ?? err) }] }));
    }
  }

  return {
    name: "bbterminal-copilot-proxy",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), "");
  return {
    plugins: [
      react(),
      apiCachePlugin(),
      cotProxyPlugin(),
      quantProxyPlugin(),
      spotMetalsPlugin(env.TWELVE_DATA_API_KEY),
      getXApiProxyPlugin(env.GETX_API_KEY),
      predictionMarketsProxyPlugin(),
      congressProxyPlugin(),
      copilotProxyPlugin(env.ANTHROPIC_API_KEY),
    ],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    server: {
      port: 5173,
      strictPort: false,
    },
  };
});
