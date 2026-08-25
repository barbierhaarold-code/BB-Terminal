// Altcoin Season Index — no free official API for this; it's the standard
// self-computed metric (popularized by blockchaincenter.net, canonically a
// 90-day window): the % of the top-N coins by market cap (excluding BTC and
// stablecoins) that outperformed BTC over a trailing window. >=75 =
// "Altcoin Season", <=25 = "Bitcoin Season", otherwise neutral. Sourced from
// CoinGecko's free `/coins/markets` endpoint (no key, CORS open — verified),
// which returns a `price_change_percentage_{window}_in_currency` field per
// coin, but only for a fixed set of windows: 1h/24h/7d/14d/30d/200d/1y — 90d
// is NOT one of them (verified live: requesting `price_change_percentage=90d`
// silently returns 200 with the field just missing, no error). 30d is the
// closest supported window and is itself a commonly-shown variant of this
// index elsewhere, so it's used here instead, with the label reflecting the
// real window rather than claiming 90d.
const COINGECKO_MARKETS_URL = "https://api.coingecko.com/api/v3/coins/markets";
const TOP_N = 50;
const WINDOW_DAYS = 30;

// Wrapped/pegged/stablecoin tickers that would otherwise pollute a top-50
// market-cap list and distort "coins that beat BTC" (a stablecoin trivially
// loses to BTC, a wrapped-BTC token trivially ties it — neither is a real
// altcoin performance signal).
const EXCLUDE_SYMBOLS = new Set([
  "usdt", "usdc", "dai", "fdusd", "tusd", "usde", "usds", "pyusd", "busd",
  "wbtc", "wsteth", "steth", "weth", "cbbtc", "wbeth",
]);

export interface AltcoinSeasonResult {
  index: number; // 0-100, % of tracked alts that beat BTC over the window
  outperformers: number;
  tracked: number;
  windowDays: number;
  label: "Bitcoin Season" | "Neutral" | "Altcoin Season";
}

interface CgMarketRow {
  id: string;
  symbol: string;
  price_change_percentage_30d_in_currency?: number | null;
}

export async function fetchAltcoinSeason(): Promise<AltcoinSeasonResult> {
  const url = `${COINGECKO_MARKETS_URL}?vs_currency=usd&order=market_cap_desc&per_page=${TOP_N}&page=1&price_change_percentage=${WINDOW_DAYS}d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko markets failed: HTTP ${res.status}`);
  const rows: CgMarketRow[] = await res.json();

  const btc = rows.find((r) => r.id === "bitcoin");
  const btcChange = btc?.price_change_percentage_30d_in_currency;
  if (btcChange == null) throw new Error(`CoinGecko did not return BTC's ${WINDOW_DAYS}d change`);

  const alts = rows.filter(
    (r) => r.id !== "bitcoin" && !EXCLUDE_SYMBOLS.has(r.symbol.toLowerCase()) && r.price_change_percentage_30d_in_currency != null
  );
  const outperformers = alts.filter((r) => (r.price_change_percentage_30d_in_currency as number) > btcChange).length;
  const index = alts.length > 0 ? Math.round((outperformers / alts.length) * 100) : 0;

  return {
    index,
    outperformers,
    tracked: alts.length,
    windowDays: WINDOW_DAYS,
    label: index >= 75 ? "Altcoin Season" : index <= 25 ? "Bitcoin Season" : "Neutral",
  };
}
