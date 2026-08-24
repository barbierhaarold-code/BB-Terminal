import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchQuote, fetchProfile } from "@/lib/api";
import { fmtPrice, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";
import { SummaryTab } from "./research/SummaryTab";
import { VisualBreakdownTab } from "./research/VisualBreakdownTab";
import { IntrinsicValueTab } from "./research/IntrinsicValueTab";
import { DcfValuationTab } from "./research/DcfValuationTab";
import { FundamentalsTab } from "./research/FundamentalsTab";
import { FinancialsTab } from "./research/FinancialsTab";
import { FinancialChartsTab } from "./research/FinancialChartsTab";
import { EarningsTab } from "./research/EarningsTab";
import { OwnershipTab } from "./research/OwnershipTab";
import { RatingsTab } from "./research/RatingsTab";
import { PeersTab } from "./research/PeersTab";

type ResearchTab =
  | "summary" | "visual" | "intrinsic" | "dcf" | "fundamentals"
  | "financials" | "charts" | "earnings" | "ownership" | "ratings" | "peers";

const TABS: { id: ResearchTab; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "visual", label: "Visual Breakdown" },
  { id: "intrinsic", label: "Intrinsic Value" },
  { id: "dcf", label: "DCF Valuation" },
  { id: "fundamentals", label: "Fundamentals" },
  { id: "financials", label: "Financials" },
  { id: "charts", label: "Financial Charts" },
  { id: "earnings", label: "Earnings" },
  { id: "ownership", label: "Ownership" },
  { id: "ratings", label: "Ratings" },
  { id: "peers", label: "Peers" },
];

export function RESEARCH({ symbol }: { symbol: string }) {
  const [tab, setTab] = useState<ResearchTab>("summary");

  return (
    <div className="h-full flex flex-col min-h-0">
      <PriceHeader symbol={symbol} />
      <div className="flex items-center gap-1 px-2 h-8 border-b border-term-border bg-term-panel2 text-[11px] uppercase tracking-wider overflow-x-auto scroll-thin shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-2 py-0.5 border shrink-0",
              tab === t.id ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin">
        {tab === "summary" && <SummaryTab symbol={symbol} />}
        {tab === "visual" && <VisualBreakdownTab symbol={symbol} />}
        {tab === "intrinsic" && <IntrinsicValueTab symbol={symbol} />}
        {tab === "dcf" && <DcfValuationTab symbol={symbol} />}
        {tab === "fundamentals" && <FundamentalsTab symbol={symbol} />}
        {tab === "financials" && <FinancialsTab symbol={symbol} />}
        {tab === "charts" && <FinancialChartsTab symbol={symbol} />}
        {tab === "earnings" && <EarningsTab symbol={symbol} />}
        {tab === "ownership" && <OwnershipTab symbol={symbol} />}
        {tab === "ratings" && <RatingsTab symbol={symbol} />}
        {tab === "peers" && <PeersTab symbol={symbol} />}
      </div>
    </div>
  );
}

/** Slim live price header shared across every sub-tab — same `quote`/`profile`
 * query keys as INTEL/DES, so switching sub-tabs never re-fetches. */
function PriceHeader({ symbol }: { symbol: string }) {
  const quoteQ = useQuery({ queryKey: ["quote", symbol], queryFn: () => fetchQuote(symbol), refetchInterval: 5000 });
  const profileQ = useQuery({ queryKey: ["profile", symbol], queryFn: () => fetchProfile(symbol) });
  const q = quoteQ.data;
  const p = profileQ.data;
  const chg = q?.last_price != null && q?.prev_close != null ? q.last_price - q.prev_close : undefined;
  const chgPct = q?.last_price != null && q?.prev_close != null ? ((q.last_price - q.prev_close) / q.prev_close) * 100 : undefined;
  const dir = chg == null ? "flat" : chg >= 0 ? "up" : "down";

  return (
    <div className="flex items-baseline gap-4 px-3 h-10 border-b border-term-border shrink-0 overflow-x-auto scroll-thin">
      <span className="text-[16px] text-term-amber font-bold tracking-widest shrink-0">{symbol}</span>
      <span className="text-term-heading truncate">{p?.name ?? "—"}</span>
      <span className={cn("num font-bold shrink-0", dir === "up" && "up", dir === "down" && "down")}>{fmtPrice(q?.last_price)}</span>
      <span className={cn("num text-[11px] shrink-0", dir === "up" && "up", dir === "down" && "down")}>
        {chg == null ? "" : (chg >= 0 ? "+" : "") + fmtPrice(chg)} ({fmtPct(chgPct)})
      </span>
      <span className="sub-header shrink-0">{p?.stock_exchange ?? q?.exchange ?? "—"} · {p?.sector ?? "—"}</span>
    </div>
  );
}
