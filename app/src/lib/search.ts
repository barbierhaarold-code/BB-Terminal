import { useEffect, useState } from "react";
import { searchSymbols } from "@/lib/api";
import { UNIVERSE } from "@/lib/universe";
import { FX_BOARD } from "@/lib/forex";
import { COINS } from "@/lib/crypto";
import { INDICES } from "@/lib/indices";
import type { FunctionCode } from "@/lib/functions";

// ────────────────────────────────────────────────────────────
// Global unified symbol search — merges the equity universe (S&P 500 /
// Nasdaq 100 / Dow 30, static, instant), the forex/metals instrument list
// (forex.ts, static, instant), and crypto (static, instant) into one
// index. Equities outside the curated universe fall back to the live SEC
// full-text search (searchSymbols), debounced.
// ────────────────────────────────────────────────────────────

export type InstrumentKind = "equity" | "forex" | "metal" | "crypto" | "index";

export interface SearchHit {
  kind: InstrumentKind;
  /** The symbol to act on — Yahoo-style ticker for equities, "EURUSD=X" etc. for forex/metals. */
  symbol: string;
  /** Primary label, e.g. "AAPL" or "EUR/USD". */
  label: string;
  /** Secondary text, e.g. company name or "Forex — Major". */
  sublabel: string;
  /** Where selecting this hit should navigate. */
  target: FunctionCode;
  /** Extra search-only terms not shown in the UI — e.g. "XAUUSD" for the gold future. */
  aliases?: string[];
}

// Gold prices as real spot XAU/USD now (Twelve Data), silver is still
// COMEX futures (SI=F, no free spot source — see forex.ts) and displayed
// as "SILVER (FUT)" accordingly. People search the common ticker
// convention ("XAUUSD", "XAU", "XAGUSD") regardless — keep both findable.
const METAL_ALIASES: Record<string, string[]> = {
  "GC=F": ["XAUUSD", "XAU", "GOLD"],
  "SI=F": ["XAGUSD", "XAG", "SILVER"],
};

const EQUITY_HITS: SearchHit[] = UNIVERSE.map((c) => ({
  kind: "equity",
  symbol: c.symbol,
  label: c.symbol,
  sublabel: c.name,
  target: "INTEL",
}));

// Forex/metals/DXY search hits open the chart (GP) directly, not the FXC
// dashboard — searching a specific instrument should land on that
// instrument, the same way searching an equity gets you straight to data
// about it rather than a generic markets overview.
const FOREX_HITS: SearchHit[] = FX_BOARD.map((inst) => ({
  kind: inst.kind === "metal" ? "metal" : inst.kind === "index" ? "index" : "forex",
  symbol: inst.symbol,
  label: inst.pair,
  sublabel: inst.symbol === "GC=F" ? "Metal — spot" : inst.kind === "metal" ? "Metal — futures" : inst.kind === "index" ? "Index — dollar" : inst.kind === "major" ? "Forex — major" : "Forex — cross",
  target: "GP",
  aliases: METAL_ALIASES[inst.symbol],
}));

const INDEX_HITS: SearchHit[] = INDICES.map((i) => ({
  kind: "index",
  symbol: i.sym,
  label: i.sym.replace("^", ""),
  sublabel: `Index — ${i.name}`,
  target: "GP",
}));

const CRYPTO_HITS: SearchHit[] = COINS.map((c) => ({
  kind: "crypto",
  symbol: c.sym,
  label: c.sym.replace("-USD", ""),
  sublabel: c.name,
  target: "CRYPTO",
}));

const STATIC_HITS: SearchHit[] = [...EQUITY_HITS, ...FOREX_HITS, ...INDEX_HITS, ...CRYPTO_HITS];
const STATIC_SYMBOLS = new Set(STATIC_HITS.map((h) => h.symbol));

function scoreMatch(query: string, hit: SearchHit): number {
  const q = query.toUpperCase();
  const sym = hit.label.toUpperCase().replace(/[\/=()]/g, "").replace(/\s*FUT\s*$/, "");
  const sub = hit.sublabel.toUpperCase();
  const aliasHit = hit.aliases?.some((a) => a.toUpperCase().startsWith(q));
  if (sym === q) return 100;
  if (aliasHit) return 90;
  if (sym.startsWith(q)) return 80;
  if (sub.startsWith(q)) return 60;
  if (sym.includes(q)) return 40;
  if (sub.includes(q)) return 20;
  return 0;
}

/** Instant, synchronous match against the static universe (equities + forex + crypto). */
export function searchStatic(query: string, limit = 8): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  return STATIC_HITS
    .map((hit) => ({ hit, score: scoreMatch(q, hit) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.hit);
}

/**
 * Debounced hook: instant static matches immediately, plus a live SEC
 * full-text search for equities outside the curated universe (only fires
 * for queries of 2+ chars, skips symbols already covered statically).
 */
export function useSymbolSearch(query: string): { hits: SearchHit[]; isSearching: boolean } {
  const [liveHits, setLiveHits] = useState<SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const staticHits = searchStatic(query, 8);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setLiveHits([]); return; }
    // Enough static coverage already — skip the network round-trip.
    if (staticHits.length >= 5) { setLiveHits([]); return; }

    let alive = true;
    setIsSearching(true);
    const t = setTimeout(() => {
      searchSymbols(q, 8)
        .then((results) => {
          if (!alive) return;
          const hits: SearchHit[] = results
            .filter((r) => !STATIC_SYMBOLS.has(r.symbol))
            .map((r) => ({ kind: "equity", symbol: r.symbol, label: r.symbol, sublabel: r.name, target: "INTEL" }));
          setLiveHits(hits);
        })
        .catch(() => { if (alive) setLiveHits([]); })
        .finally(() => { if (alive) setIsSearching(false); });
    }, 250);

    return () => { alive = false; clearTimeout(t); setIsSearching(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const merged = [...staticHits, ...liveHits].slice(0, 10);
  return { hits: merged, isSearching };
}
