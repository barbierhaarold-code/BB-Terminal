import { FX_BOARD } from "@/lib/forex";
import { COINS } from "@/lib/crypto";

// ────────────────────────────────────────────────────────────
// TradingView Advanced Real-Time Chart widget — the free, embeddable
// widget (drawing tools + indicators included), loaded once and reused by
// GP for every instrument. This is display-only: it renders inside its own
// iframe and exposes no data back to the app, so nothing that computes off
// live prices (scalper ATR, ticker tape, correlation panel, day-range bars)
// touches this — they keep using the existing yfinance/OpenBB pipeline.
// ────────────────────────────────────────────────────────────

declare global {
  interface Window {
    TradingView?: {
      widget: new (options: Record<string, unknown>) => unknown;
    };
  }
}

let scriptPromise: Promise<void> | null = null;

/** Injects the official `tv.js` embed script once and caches the promise —
 * every GP mount awaits the same load instead of re-fetching the script. */
export function loadTradingViewScript(): Promise<void> {
  if (window.TradingView) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load the TradingView widget script"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

const FX_BOARD_BY_SYMBOL = new Map(FX_BOARD.map((i) => [i.symbol, i]));
const COIN_SYMBOLS = new Set(COINS.map((c) => c.sym));

// Metals have no free spot ticker through yfinance (see forex.ts), but
// TradingView carries real OANDA spot feeds for both — use those instead of
// mapping to the futures contract, since spot is what "gold chart" usually
// means to a reader.
const METAL_TV_SYMBOL: Record<string, string> = {
  "GC=F": "OANDA:XAUUSD",
  "SI=F": "OANDA:XAGUSD",
};

const INDEX_TV_SYMBOL: Record<string, string> = {
  "^GSPC": "TVC:SPX",
  "^DJI": "TVC:DJI",
  "^IXIC": "NASDAQ:IXIC",
  "^RUT": "TVC:RUT",
  "^VIX": "TVC:VIX",
};

/**
 * Map an internal app symbol to a TradingView-resolvable ticker.
 *
 * Equities fall through unprefixed (no `EXCHANGE:` prefix) — the equity
 * universe doesn't carry a primary-listing exchange per ticker, and
 * TradingView's widget is lenient about resolving a bare US ticker like
 * "AAPL" to its listing on its own. `allow_symbol_change` stays on in the
 * widget config, so any mapping here that resolves to the wrong instrument
 * is one click for the user to fix, not a dead end.
 */
export function toTradingViewSymbol(symbol: string): string {
  if (METAL_TV_SYMBOL[symbol]) return METAL_TV_SYMBOL[symbol];
  if (symbol === "DX-Y.NYB") return "TVC:DXY";
  if (INDEX_TV_SYMBOL[symbol]) return INDEX_TV_SYMBOL[symbol];

  const fx = FX_BOARD_BY_SYMBOL.get(symbol);
  if (fx && (fx.kind === "major" || fx.kind === "cross")) return `FX:${symbol.replace("=X", "")}`;

  if (COIN_SYMBOLS.has(symbol)) return `COINBASE:${symbol.replace("-USD", "USD")}`;

  return symbol;
}
