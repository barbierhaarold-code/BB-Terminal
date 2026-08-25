// CoinGecko `/global` — free, no key, CORS open (verified). Covers total
// market cap and BTC/ETH dominance directly. Deeper on-chain metrics
// (exchange reserves, whale wallet flows) aren't in CoinGecko's free tier —
// that's typically a paid Glassnode/CryptoQuant feed, flagged as an open gap
// in OnChainPanel rather than built here.
const GLOBAL_URL = "https://api.coingecko.com/api/v3/global";

export interface GlobalMarketData {
  totalMarketCapUsd: number;
  totalVolumeUsd: number;
  btcDominance: number;
  ethDominance: number;
  marketCapChangePct24h: number;
  activeCryptocurrencies: number;
}

interface CgGlobalRaw {
  data: {
    total_market_cap: Record<string, number>;
    total_volume: Record<string, number>;
    market_cap_percentage: Record<string, number>;
    market_cap_change_percentage_24h_usd: number;
    active_cryptocurrencies: number;
  };
}

export async function fetchGlobalMarketData(): Promise<GlobalMarketData> {
  const res = await fetch(GLOBAL_URL);
  if (!res.ok) throw new Error(`CoinGecko /global failed: HTTP ${res.status}`);
  const json: CgGlobalRaw = await res.json();
  const d = json.data;
  return {
    totalMarketCapUsd: d.total_market_cap.usd,
    totalVolumeUsd: d.total_volume.usd,
    btcDominance: d.market_cap_percentage.btc,
    ethDominance: d.market_cap_percentage.eth,
    marketCapChangePct24h: d.market_cap_change_percentage_24h_usd,
    activeCryptocurrencies: d.active_cryptocurrencies,
  };
}
