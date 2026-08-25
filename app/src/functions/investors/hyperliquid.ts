// Hyperliquid public API — REST `info` endpoint (POST, JSON body, free, no
// key, CORS open — verified live: `access-control-allow-origin: *`) and the
// public `trades` websocket channel (see useHyperliquidTrades.ts). Confirmed
// during the phase-6 research spike and re-verified before building this.
const INFO_URL = "https://api.hyperliquid.xyz/info";

async function info<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid info ${body.type} failed: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface HLUniverseAsset { name: string; isDelisted?: boolean }
interface HLAssetCtx {
  funding: string; openInterest: string; prevDayPx: string; dayNtlVlm: string;
  premium: string | null; oraclePx: string; markPx: string; midPx: string | null;
}
export interface HLPerp {
  coin: string; oraclePx: number; markPx: number; premium: number;
  prevDayPx: number; dayNtlVlm: number; funding: number; openInterest: number;
}

/** Every live perp with its current mark/oracle/funding/volume — one call, no key. */
export const fetchHLPerps = async (): Promise<HLPerp[]> => {
  const [meta, ctxs] = await info<[{ universe: HLUniverseAsset[] }, HLAssetCtx[]]>({ type: "metaAndAssetCtxs" });
  return meta.universe
    .map((u, i): HLPerp | null => {
      const c = ctxs[i];
      if (!c || u.isDelisted) return null;
      const oraclePx = Number(c.oraclePx);
      if (!Number.isFinite(oraclePx) || oraclePx <= 0) return null;
      return {
        coin: u.name, oraclePx, markPx: Number(c.markPx), premium: Number(c.premium ?? 0),
        prevDayPx: Number(c.prevDayPx), dayNtlVlm: Number(c.dayNtlVlm), funding: Number(c.funding),
        openInterest: Number(c.openInterest),
      };
    })
    .filter((p): p is HLPerp => p !== null);
};

export interface HLFundingPoint { time: number; premium: number; fundingRate: number }

/** Hourly premium/funding history for one coin — real historical mark-vs-oracle spread, no key. */
export const fetchHLFundingHistory = (coin: string, startTimeMs: number): Promise<HLFundingPoint[]> =>
  info<{ coin: string; fundingRate: string; premium: string; time: number }[]>({
    type: "fundingHistory", coin, startTime: startTimeMs,
  }).then((rows) => rows.map((r) => ({ time: r.time, premium: Number(r.premium), fundingRate: Number(r.fundingRate) })));

/**
 * Real-world-asset-tracking markets verified live on Hyperliquid — NOT a
 * name match. The research spike's first pass found spot pairs literally
 * named AAPL/TSLA/GOOGL/NVDAX/XAUT0/XAUM and a perp named SPX and assumed
 * they were tokenized equities/indices; checking their actual oraclePx
 * against real-world prices proved that wrong (spot "AAPL" traded at
 * $0.057, perp "SPX" at 0.47 — neither near reality). Hyperliquid lets
 * anyone permissionlessly deploy a spot token or perp market with any name
 * (HIP-1/HIP-3), so a matching name alone means nothing.
 *
 * PAXG is the one exception: Paxos Gold is a real, independently-audited,
 * physically-redeemable gold token traded across the entire crypto
 * industry (not a Hyperliquid-native listing), and its Hyperliquid oracle
 * price ($4,629 at verification time) matches real spot gold. That's a
 * genuine 24/7 gold market. No equivalent exists for any index or
 * individual stock — every stock/index-named market checked failed the
 * same price-plausibility check that PAXG passed.
 */
export const VERIFIED_REAL_WORLD_MARKETS = [
  { coin: "PAXG", label: "Gold (PAXG · Paxos Gold)", refKind: "gold" as const },
];

/** Coins to subscribe to for the live trade feed: the highest-volume perps
 * (where genuinely large prints happen) plus every verified real-world
 * market above, even if its own volume wouldn't otherwise make the cut. */
export function pickTradeFeedCoins(perps: HLPerp[], topN = 40): string[] {
  const byVolume = [...perps].sort((a, b) => b.dayNtlVlm - a.dayNtlVlm).slice(0, topN).map((p) => p.coin);
  const set = new Set(byVolume);
  for (const m of VERIFIED_REAL_WORLD_MARKETS) set.add(m.coin);
  return Array.from(set);
}
