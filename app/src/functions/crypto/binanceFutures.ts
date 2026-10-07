// Binance USDT-M Futures public REST — free, no key, CORS open (verified:
// `access-control-allow-origin: *` on premiumIndex/openInterest/
// globalLongShortAccountRatio). Covers funding rate, open interest, and
// long/short account ratio for major perpetuals without auth.
const FAPI = "https://fapi.binance.com";

// Mirrors the CRYPTO dashboard's tracked coins, mapped to their USDT-margined
// perp symbol. MATICUSDT was delisted after the Polygon MATIC->POL migration
// (verified live: 400 on MATICUSDT, 200 on POLUSDT), so Polygon uses POLUSDT.
export const DERIVATIVES_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT",
  "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "LTCUSDT", "POLUSDT", "DOTUSDT",
] as const;

export interface DerivativesRow {
  symbol: string;
  markPrice: number;
  fundingRate: number;
  nextFundingTime: number;
  openInterest: number;
  openInterestNotional: number;
  longAccountPct: number;
  shortAccountPct: number;
  longShortRatio: number;
}

interface PremiumIndexRaw { symbol: string; markPrice: string; lastFundingRate: string; nextFundingTime: number }
interface OpenInterestRaw { symbol: string; openInterest: string }
interface LongShortRaw { longAccount: string; shortAccount: string; longShortRatio: string }

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${FAPI}${path}`);
  if (!res.ok) {
    const hint = res.status === 451 || res.status === 403 ? " — region-blocked by Binance"
      : res.status === 429 || res.status === 418 ? " — rate-limited by Binance" : "";
    throw new Error(`Binance Futures ${path.split("?")[0]} failed: HTTP ${res.status}${hint}`);
  }
  return res.json() as Promise<T>;
}

/** One row per tracked perp: mark price, funding rate, OI, and long/short ratio. */
export async function fetchDerivatives(): Promise<DerivativesRow[]> {
  // Remember why a symbol failed so "every request failed" surfaces as an
  // error with its cause instead of an empty table ("no data returned").
  let firstFailure: unknown;
  const rows = await Promise.all(
    DERIVATIVES_SYMBOLS.map(async (symbol): Promise<DerivativesRow | null> => {
      try {
        const [premium, oi, ls] = await Promise.all([
          getJson<PremiumIndexRaw>(`/fapi/v1/premiumIndex?symbol=${symbol}`),
          getJson<OpenInterestRaw>(`/fapi/v1/openInterest?symbol=${symbol}`),
          getJson<LongShortRaw[]>(`/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`),
        ]);
        const markPrice = Number(premium.markPrice);
        const openInterest = Number(oi.openInterest);
        const longShort = ls[0];
        return {
          symbol,
          markPrice,
          fundingRate: Number(premium.lastFundingRate),
          nextFundingTime: premium.nextFundingTime,
          openInterest,
          openInterestNotional: openInterest * markPrice,
          longAccountPct: longShort ? Number(longShort.longAccount) * 100 : NaN,
          shortAccountPct: longShort ? Number(longShort.shortAccount) * 100 : NaN,
          longShortRatio: longShort ? Number(longShort.longShortRatio) : NaN,
        };
      } catch (e) {
        firstFailure ??= e;
        return null;
      }
    })
  );
  const ok = rows.filter((r): r is DerivativesRow => r !== null);
  if (ok.length === 0 && firstFailure) {
    const msg = firstFailure instanceof Error ? firstFailure.message : String(firstFailure);
    throw new Error(/HTTP \d+/.test(msg) ? msg : `Binance Futures unreachable (${msg}) — network, VPN or region block`);
  }
  return ok;
}
