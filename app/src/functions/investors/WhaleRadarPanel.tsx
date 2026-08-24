import { SectionTitle, GapNotice } from "@/functions/research/shared";

/**
 * Deliberately not built yet — the phase spec calls for a 1-2h research spike
 * before writing an implementation prompt, not a build inside this phase.
 * This panel documents that spike's findings so PENDING means "confirmed
 * scope, not started" rather than a placeholder full of fake numbers.
 */
export function WhaleRadarPanel() {
  return (
    <div className="p-4 flex flex-col gap-5 text-[12px] max-w-3xl">
      <SectionTitle>WHALE RADAR — RESEARCH SPIKE COMPLETE, BUILD PENDING</SectionTitle>

      <GapNotice>
        This tab is intentionally unbuilt. The spike below confirms the platform and data shape; implementing the live
        feed is a separate follow-up task, not part of this phase.
      </GapNotice>

      <div className="flex flex-col gap-2">
        <div className="text-term-amber text-[11px] tracking-widest font-bold">CONFIRMED — VERIFIED LIVE, 2026-08-24</div>
        <ul className="list-disc list-inside space-y-1 text-term-text">
          <li>Hyperliquid is the platform QFI's Whale Radar matches. <code className="text-term-amberBright">POST https://api.hyperliquid.xyz/info</code> is free, no key, no auth.</li>
          <li>
            Its spot market lists tokenized equities and metals confirming the "24/7 tokenized markets" framing —
            live tokens include <code>TSLA</code>, <code>NVDA</code>, <code>GOOGL</code>, <code>AAPL</code> (plus
            <code> TSLAX/NVDAX/AAPLX/EQ-</code> variants), <code>XAUT0</code>/<code>XAUM</code> (gold), and a
            <code> NASDAQ</code>-tracking token. The perp universe separately lists <code>SPX</code>.
          </li>
          <li>
            <code>{"{type: \"meta\"}"}</code> and <code>{"{type: \"spotMeta\"}"}</code> return the full instrument
            list; <code>{"{type: \"l2Book\", coin}"}</code> and <code>{"{type: \"candleSnapshot\"}"}</code> give
            order-book and OHLCV data per instrument — all free, all verified live.
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-term-red text-[11px] tracking-widest font-bold">THE GAP — WHY THIS ISN'T A QUICK ADD</div>
        <p className="text-term-text leading-relaxed">
          Hyperliquid's public API has no exchange-wide "recent trades across all wallets" endpoint. Per-wallet fills
          (<code>{"{type: \"userFills\", user}"}</code>) need a wallet address up front, and the public per-coin trade
          websocket channel doesn't carry counterparty addresses. QFI's "0x49e9…e1d0"-style feed implies they're
          polling a curated list of known large wallets (sourced from a leaderboard or a third-party tracker like
          HyperStats/HyperDash), not reading a native firehose — that curated wallet list is the missing piece, not
          the API access itself.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-term-muted text-[11px] tracking-widest font-bold">NEXT STEP</div>
        <p className="text-term-text leading-relaxed">
          Write a follow-up phase file scoped to: (1) sourcing a whale-wallet watchlist, (2) a poll or websocket layer
          against <code>userFills</code>/<code>clearinghouseState</code> per watched wallet, (3) a UI for large-print
          trades across the tokenized-equity/metals/index instruments confirmed above. Treat it as its own phase, not
          a same-session add-on to Funds/Insider/Congress.
        </p>
      </div>
    </div>
  );
}
