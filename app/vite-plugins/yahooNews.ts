// Per-symbol headlines from Yahoo Finance's public RSS feed — the fallback for
// OpenBB's `/news/company` (yfinance provider). Verified 2026-10-07: yfinance 1.6.0's
// own news request (the `ncp` endpoint) now returns zero items for every symbol, so
// OpenBB answers 204 No Content, while this RSS feed still serves headlines.
// Free, no key, no scraping of page HTML. Auth-gated like every "-proxy" route.
import type { Plugin } from "vite";
import { errMessage, fetchWithTimeout, middlewarePlugin, sendJson } from "./shared";

const TTL_MS = 60_000;
const MAX_ITEMS = 40;
const SYMBOL_RE = /^[A-Za-z0-9.^=\-]{1,20}$/;

interface Item { id: string; date: string; title: string; url: string; source: string; summary?: string; symbol: string }

const cache = new Map<string, { items: Item[]; expires: number }>();
const inflight = new Map<string, Promise<Item[]>>();

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .trim();
const tag = (block: string, name: string) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? decode(m[1]) : "";
};

async function load(symbol: string): Promise<Item[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/rss+xml,text/xml" } }, 15_000);
  if (!r.ok) throw new Error(`Yahoo RSS returned HTTP ${r.status}`);
  const xml = await r.text();
  if (!xml.includes("<rss")) throw new Error("Yahoo RSS returned an unexpected payload");
  const items: Item[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = tag(m[1], "title");
    const link = tag(m[1], "link");
    const ts = Date.parse(tag(m[1], "pubDate"));
    if (!title || !link || !Number.isFinite(ts)) continue;
    items.push({
      id: tag(m[1], "guid") || link, date: new Date(ts).toISOString(), title, url: link,
      source: "Yahoo Finance", summary: tag(m[1], "description") || undefined, symbol,
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

export function yahooNewsProxyPlugin(): Plugin {
  return middlewarePlugin("bbterminal-yahoo-news-proxy", async (req, res, next) => {
    if (!req.url?.startsWith("/yahoo-news-proxy/headlines") || req.method !== "GET") { next(); return; }
    const u = new URL(req.url, "http://internal");
    const symbol = u.searchParams.get("symbol") ?? "";
    const limit = Math.min(Math.max(Number(u.searchParams.get("limit")) || 15, 1), MAX_ITEMS);
    if (!SYMBOL_RE.test(symbol)) { sendJson(res, { results: [], warnings: [{ message: "invalid symbol" }] }, 400); return; }
    try {
      let hit = cache.get(symbol);
      if (!hit || hit.expires < Date.now()) {
        let p = inflight.get(symbol);
        if (!p) { p = load(symbol).finally(() => inflight.delete(symbol)); inflight.set(symbol, p); }
        hit = { items: await p, expires: Date.now() + TTL_MS };
        cache.set(symbol, hit);
      }
      sendJson(res, { results: hit.items.slice(0, limit) });
    } catch (err) {
      sendJson(res, { results: [], warnings: [{ message: `Yahoo news feed unavailable — ${errMessage(err)}` }] }, 502);
    }
  });
}
