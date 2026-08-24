import { useState } from "react";
import { useAllFundHoldings, rankFunds, sectorBreakdown, type FundRanking } from "./fundsData";
import { Loading, ErrorBlock, EmptyBlock, SectionTitle, BarTrend } from "@/functions/research/shared";
import { Donut } from "./Donut";
import { fmtVolume, fmtDate, fmtPctFromDecimal } from "@/lib/format";

export function FundsPanel() {
  const { data, isLoading, error } = useAllFundHoldings();
  const [selectedCik, setSelectedCik] = useState<string | null>(null);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBlock err={error as Error} />;
  if (!data || data.every((f) => f.holdings.length === 0)) return <EmptyBlock>No 13F data available.</EmptyBlock>;

  const ranked = rankFunds(data);
  const selected = selectedCik ? ranked.find((f) => f.fund.cik === selectedCik) : null;
  if (selected) return <FundDetail fund={selected} onBack={() => setSelectedCik(null)} />;

  return (
    <div className="p-4 flex flex-col gap-3 text-[12px]">
      <SectionTitle>TOP INSTITUTIONAL FUNDS — LATEST 13F-HR</SectionTitle>
      <div className="sub-header">SEC EDGAR · FORM 13F-HR · CLICK A FUND TO DRILL IN</div>
      <div className="border border-term-border overflow-auto scroll-thin">
        <table className="w-full grid-data">
          <thead>
            <tr>
              <th>Rank</th><th>Fund</th>
              <th className="text-right">Portfolio Value</th>
              <th className="text-right">Holdings</th>
              <th className="text-right">Top-20 Conc.</th>
              <th>As Of</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((f, i) => (
              <tr
                key={f.fund.cik}
                className="cursor-pointer hover:bg-term-amberSubtle"
                onClick={() => setSelectedCik(f.fund.cik)}
              >
                <td className="num">{i + 1}</td>
                <td>{f.fund.name}</td>
                <td className="num text-right">${fmtVolume(f.totalValue)}</td>
                <td className="num text-right">{f.holdingsCount.toLocaleString()}</td>
                <td className="num text-right">{fmtPctFromDecimal(f.top20Concentration)}</td>
                <td className="text-term-muted">{fmtDate(f.asOf)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FundDetail({ fund, onBack }: { fund: FundRanking; onBack: () => void }) {
  const sectors = sectorBreakdown(fund.holdings);
  const top10 = [...fund.holdings].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 10);

  return (
    <div className="p-4 flex flex-col gap-6 text-[12px]">
      <button onClick={onBack} className="text-term-muted hover:text-term-text self-start text-[11px] uppercase tracking-widest">
        ← Back to Funds
      </button>
      <div>
        <SectionTitle>{fund.fund.name.toUpperCase()}</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 max-w-2xl">
          <KV k="PORTFOLIO VALUE" v={`$${fmtVolume(fund.totalValue)}`} />
          <KV k="HOLDINGS" v={fund.holdingsCount.toLocaleString()} />
          <KV k="TOP-20 CONCENTRATION" v={fmtPctFromDecimal(fund.top20Concentration)} />
          <KV k="AS OF" v={fmtDate(fund.asOf)} />
        </div>
      </div>

      <div>
        <SectionTitle>SECTOR ALLOCATION</SectionTitle>
        <div className="sub-header mb-2">
          BY MATCHED MARKET VALUE — "OTHER / UNMAPPED" COVERS ISSUERS OUTSIDE THE TRACKED S&amp;P/NASDAQ/DOW UNIVERSE
        </div>
        <Donut data={sectors.map((s) => ({ label: s.sector, value: s.value }))} />
      </div>

      <div>
        <SectionTitle>TOP-10 HOLDINGS</SectionTitle>
        <BarTrend data={top10.map((h) => ({ label: h.issuer, value: h.value }))} fmt={(v) => "$" + fmtVolume(v)} height={180} />
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <>
      <div className="sub-header py-0.5">{k}</div>
      <div className="num text-right py-0.5 text-term-text">{v}</div>
    </>
  );
}
