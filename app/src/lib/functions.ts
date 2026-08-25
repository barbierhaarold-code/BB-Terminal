export type FunctionCode =
  | "CC" | "INTEL" | "HELP"
  | "DES" | "GP" | "QR" | "HP"
  | "FA" | "KEY" | "DVD" | "EE" | "NI" | "RESEARCH"
  | "WEI" | "MOV" | "OMON"
  | "CURV" | "FXC" | "CRYPTO"
  | "QCARD" | "HEAT" | "TRACK" | "NH" | "INVEST" | "QUANT";

export interface FunctionDef {
  code: FunctionCode;
  name: string;
  needsSymbol: boolean;
  group: "Security" | "Markets" | "Macro" | "System" | "Journal";
  summary: string;
}

export const FUNCTIONS: FunctionDef[] = [
  { code: "CC",   name: "Command Center",        needsSymbol: false, group: "System", summary: "Morning briefing · markets, curve, FX, movers, news" },
  { code: "HELP", name: "Function Directory",    needsSymbol: false, group: "System", summary: "List of all terminal functions" },

  { code: "INTEL", name: "Stock Intelligence",   needsSymbol: true,  group: "Security", summary: "Full scorecard — signals across technical, value, fundamentals, analysts" },
  { code: "RESEARCH", name: "Equity Research",   needsSymbol: true,  group: "Security", summary: "Deep-dive workspace — DCF, fundamentals grade, financials, ownership, ratings, peers" },
  { code: "DES",  name: "Security Description", needsSymbol: true,  group: "Security", summary: "Company profile, sector, HQ, employees" },
  { code: "GP",   name: "Graph / Chart",         needsSymbol: true,  group: "Security", summary: "Historical candlestick chart + volume" },
  { code: "QR",   name: "Quote Recap",           needsSymbol: true,  group: "Security", summary: "Live quote: last, bid/ask, volume, day range" },
  { code: "HP",   name: "Historical Prices",     needsSymbol: true,  group: "Security", summary: "OHLCV table" },
  { code: "FA",   name: "Financial Analysis",    needsSymbol: true,  group: "Security", summary: "Income statement — last 5 fiscal years" },
  { code: "KEY",  name: "Key Ratios & Metrics",  needsSymbol: true,  group: "Security", summary: "PE, EV/EBITDA, margins, ROE, etc." },
  { code: "DVD",  name: "Dividend History",      needsSymbol: true,  group: "Security", summary: "All historical dividends" },
  { code: "EE",   name: "Analyst Estimates",     needsSymbol: true,  group: "Security", summary: "Target prices, recommendation, analyst count" },
  { code: "NI",   name: "News — Company",        needsSymbol: true,  group: "Security", summary: "Latest headlines for the symbol" },
  { code: "OMON", name: "Options Monitor",       needsSymbol: true,  group: "Security", summary: "Options chain, expected range, IV, open interest, unusual activity, Greeks exposure" },

  { code: "WEI",  name: "World Equity Indices",  needsSymbol: false, group: "Markets", summary: "Major global indices — level & daily change" },
  { code: "MOV",  name: "Market Movers",         needsSymbol: false, group: "Markets", summary: "US gainers, losers, most active" },
  { code: "CRYPTO", name: "Crypto Monitor",      needsSymbol: false, group: "Markets", summary: "Top crypto prices, Fear & Greed, Altcoin Season, derivatives, liquidations, on-chain" },
  { code: "FXC",  name: "Forex Center",          needsSymbol: false, group: "Markets", summary: "Majors, crosses, gold/silver, sessions clock, FX news" },
  { code: "QCARD", name: "Quote Cards",          needsSymbol: false, group: "Markets", summary: "Filterable ticker cards — price, change, sparkline, favorites" },
  { code: "HEAT", name: "Market Heatmap",        needsSymbol: false, group: "Markets", summary: "Sector→industry→ticker treemap, sized by cap, colored by change" },
  { code: "NH",   name: "News Hub",              needsSymbol: false, group: "Markets", summary: "News, tweets, econ calendar, earnings, corporate, prediction markets, Fed ops, market hours, live TV" },
  { code: "INVEST", name: "Investors / Institutional", needsSymbol: false, group: "Markets", summary: "13F fund holdings, who-holds-a-ticker ranking, insider trading, congressional trading, live on-chain whale trades" },
  { code: "QUANT", name: "Analytics / Quant",   needsSymbol: false, group: "Markets", summary: "Correlation matrix, cointegration/z-score pairs trading, beta & hedge ratio, sector rotation, COT positioning" },

  { code: "CURV", name: "US Yield Curve",        needsSymbol: false, group: "Macro", summary: "Treasury par yield curve" },

  { code: "TRACK", name: "Track Record",         needsSymbol: false, group: "Journal", summary: "Trading journal — manual log, bulk import, setups, performance stats" },
];

export const FN_BY_CODE: Record<string, FunctionDef> = Object.fromEntries(FUNCTIONS.map((f) => [f.code, f]));

export interface ParsedCommand {
  symbol?: string;
  code: FunctionCode;
}

/** Parse a free-form command like "AAPL DES", "DES", "AAPL", "TOP". */
export function parseCommand(raw: string, activeSymbol: string | null): ParsedCommand | null {
  const parts = raw.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  const isFn = (s: string): s is FunctionCode => s in FN_BY_CODE;

  if (parts.length === 1) {
    const p = parts[0];
    if (isFn(p)) {
      const fn = FN_BY_CODE[p];
      if (fn.needsSymbol) {
        if (!activeSymbol) return null;
        return { symbol: activeSymbol, code: p };
      }
      return { code: p };
    }
    // just a symbol — default to INTEL (the scorecard view)
    return { symbol: p, code: "INTEL" };
  }

  // Two or more tokens: SYMBOL FUNC
  const [sym, fn] = parts;
  if (isFn(fn)) return { symbol: sym, code: fn };
  // FUNC SYMBOL (also allowed)
  if (isFn(sym)) {
    const f = FN_BY_CODE[sym];
    return f.needsSymbol ? { symbol: fn, code: sym } : { code: sym };
  }
  return null;
}
