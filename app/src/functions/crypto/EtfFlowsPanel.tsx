import { SectionTitle, GapNotice } from "@/functions/research/shared";

/**
 * Bitcoin ETF daily net-flow/AUM by fund (IBIT, FBTC, GBTC, etc.) has no
 * official free API. Farside Investors — the usual free aggregator for this
 * table — sits behind Cloudflare bot protection: a direct fetch of
 * farside.co.uk/btc/ returns HTTP 403 with a Cloudflare challenge page
 * (verified live), which is both a technical wall and a signal they don't
 * want automated access. OpenBB's installed `etf` endpoints were also
 * checked directly (`etf/holdings`, `etf/historical`, `etf/nport_disclosure`,
 * etc.) — none of them expose daily creation/redemption flow or AUM-by-fund.
 * Per the phase brief, this stays flagged open rather than forcing a
 * scraper against a site that's actively blocking it.
 */
export function EtfFlowsPanel() {
  return (
    <div className="p-4 flex flex-col gap-4 text-[12px]">
      <SectionTitle>BITCOIN ETF FLOWS — OPEN DECISION</SectionTitle>
      <GapNotice>
        No confirmed free, legitimate source found. Farside Investors (the usual free aggregator of daily net
        flow/AUM by fund — IBIT, FBTC, GBTC, etc.) actively blocks automated access: a direct request returns HTTP
        403 behind a Cloudflare bot challenge, and scraping past that would go against the site's own anti-bot
        protection rather than just its terms. OpenBB's installed <code>etf</code> endpoints
        (<code>etf/holdings</code>, <code>etf/historical</code>, <code>etf/nport_disclosure</code>) were checked
        directly and don't cover daily flow/AUM either.
      </GapNotice>
      <div className="text-term-text leading-relaxed">
        Options if this is worth building later: a paid data vendor with a real ETF-flow API (e.g. SoSoValue,
        CoinGlass Pro), or manually re-publishing Farside's numbers on some cadence — neither is a "free and
        automatic" fit, so this needs an explicit decision rather than a default.
      </div>
    </div>
  );
}
