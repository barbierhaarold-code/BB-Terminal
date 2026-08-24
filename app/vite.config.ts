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

function apiCachePlugin(): Plugin {
  const cache = new Map<string, CacheEntry>();
  const gate = createGate(MAX_CONCURRENT_UPSTREAM);

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

    await gate.acquire();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
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
      gate.release();
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
const COT_GOLD_URL = "https://www.tradingster.com/cot/legacy-futures/088691";
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
  let cache: { data: CotSnapshot; expires: number } | null = null;

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    if (req.url !== "/cot-proxy/gold" || req.method !== "GET") { next(); return; }

    const now = Date.now();
    if (cache && cache.expires > now) {
      res.setHeader("content-type", "application/json");
      res.setHeader("x-bbterminal-cache", "HIT");
      res.end(JSON.stringify({ results: cache.data }));
      return;
    }

    try {
      const upstream = await fetch(COT_GOLD_URL);
      const html = await upstream.text();
      const parsed = upstream.ok ? parseCotHtml(html) : null;
      if (!parsed) throw new Error(`Could not parse Tradingster COT report (status ${upstream.status})`);
      cache = { data: parsed, expires: now + COT_TTL_MS };
      res.setHeader("content-type", "application/json");
      res.setHeader("x-bbterminal-cache", "MISS");
      res.end(JSON.stringify({ results: parsed }));
    } catch (err) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
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
// The free tier is capped at 8 API credits/minute — `/time_series` costs
// noticeably more per call than `/quote` (verified by exhausting the
// per-minute cap while probing this), so the two are cached very
// differently: `/quote` (last/high/low/change) is cheap and cached for
// 20s to match the existing board/scalper poll cadence; `/time_series`
// (candles, only needed for ATR) is expensive and cached for 5 minutes,
// however many components ask for either.
function spotMetalsPlugin(apiKey: string | undefined): Plugin {
  const TARGET = "https://api.twelvedata.com";
  const QUOTE_TTL_MS = 20_000;
  const SERIES_TTL_MS = 5 * 60_000;
  const cache = new Map<string, { body: string; expires: number }>();

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

    const hit = cache.get(cacheKey);
    if (hit && hit.expires > now) {
      res.setHeader("x-bbterminal-cache", "HIT");
      res.end(hit.body);
      return;
    }

    try {
      const upstreamPath = kind === "series"
        ? `/time_series?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&outputsize=100&apikey=${apiKey}`
        : `/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
      const upstream = await fetch(TARGET + upstreamPath);
      const json = await upstream.json();
      if (!upstream.ok || json.status === "error") {
        throw new Error(json.message ?? `Twelve Data error (${upstream.status})`);
      }
      const body = JSON.stringify({ results: json });
      cache.set(cacheKey, { body, expires: now + ttl });
      res.setHeader("x-bbterminal-cache", "MISS");
      res.end(body);
    } catch (err) {
      res.statusCode = 502;
      res.setHeader("x-bbterminal-cache", "ERROR");
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname), "");
  return {
    plugins: [
      react(),
      apiCachePlugin(),
      cotProxyPlugin(),
      spotMetalsPlugin(env.TWELVE_DATA_API_KEY),
      getXApiProxyPlugin(env.GETX_API_KEY),
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
