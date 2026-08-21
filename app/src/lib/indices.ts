// US index → tracking ETF (used by CC to approximate after-hours/pre-market
// move) and the source list for search.ts's index hits (item 4: raw index
// tickers like ^VIX searchable alongside its ETPs, same list CC already
// shows, single source of truth).
export const INDICES = [
  { sym: "^GSPC", name: "S&P 500",    etf: "SPY" },
  { sym: "^DJI",  name: "Dow Jones",  etf: "DIA" },
  { sym: "^IXIC", name: "NASDAQ",     etf: "QQQ" },
  { sym: "^RUT",  name: "Russell 2k", etf: "IWM" },
  { sym: "^VIX",  name: "VIX",        etf: undefined as string | undefined },
];
