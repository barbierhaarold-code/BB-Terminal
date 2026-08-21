import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchIndexHistorical, fetchTreasuryRates, fetchCryptoHistorical,
  fetchGainers, fetchLosers, fetchNewsCompany,
  fetchEtfExtended, extendedHoursMove, fetchCommodityHistorical,
  type Candle,
} from "@/lib/api";
import { fmtPrice, fmtPct, fmtTime, fmtPctFromDecimal } from "@/lib/format";
import { useWorkspace } from "@/store/workspaceStore";
import { XauScalper } from "@/components/XauScalper";
import { NormalizedChart } from "@/components/NormalizedChart";
import { useSectorPerformance } from "@/lib/sectors";
import { FX_BOARD, intradayQueryOptions, intradayStats } from "@/lib/forex";
import { INDICES } from "@/lib/indices";
import { cn } from "@/lib/cn";

function chgPctOf(data: Candle[] | undefined): number | undefined {
  if (!data || data.length < 2) return undefined;
  const last = data[data.length - 1], prev = data[data.length - 2];
  return ((last.close - prev.close) / prev.close) * 100;
}

function Spark({ values, color = "#b45cff" }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 28 - ((v - min) / (max - min || 1)) * 24;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 100 28" className="w-full h-8">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────
// A. US MARKETS — index cards with regular + after-hours pricing
// ────────────────────────────────────────────────────────────
function UsMarkets() {
  const idxQueries = useQueries({
    queries: INDICES.map((i) => ({
      queryKey: ["cc-idx", i.sym],
      queryFn: () => fetchIndexHistorical(i.sym, 14),
      refetchInterval: 60_000,
    })),
  });
  // Extended-hours candles from the tracking ETFs (only those with one).
  const ahQueries = useQueries({
    queries: INDICES.map((i) => ({
      queryKey: ["cc-ah", i.etf],
      queryFn: () => (i.etf ? fetchEtfExtended(i.etf) : Promise.resolve([] as Candle[])),
      enabled: !!i.etf,
      refetchInterval: 60_000,
    })),
  });

  return (
    <div className="panel h-full">
      <div className="panel-header">
        <span>US MARKETS</span>
        <span className="sub-header normal-case tracking-normal font-normal">regular + after-hours · 14d</span>
      </div>
      <div className="grid grid-cols-5 divide-x divide-term-border flex-1">
        {INDICES.map((idx, i) => {
          const q = idxQueries[i];
          const data = q.data ?? [];
          const last = data[data.length - 1];
          const chgPct = chgPctOf(data);
          const dir = chgPct == null ? "flat" : chgPct >= 0 ? "up" : "down";
          const vals = data.map((d) => d.close);
          const ah = extendedHoursMove(ahQueries[i].data);
          return (
            <div key={idx.sym} className="p-2 flex flex-col">
              <div className="sub-header">{idx.name}</div>
              <div className="num text-[16px] text-term-heading mt-1">
                {q.isLoading ? "…" : last?.close != null ? last.close.toFixed(2) : "—"}
              </div>
              <div className={cn("num text-[11px]", dir === "up" && "up", dir === "down" && "down")}>
                {fmtPct(chgPct)}
              </div>
              {ah.changePct != null ? (
                <div className="mt-1 text-[10px] leading-tight">
                  <span className="sub-header">{ah.session === "pre" ? "PRE" : "AFT"}·HRS</span>
                  <div className={cn("num", ah.changePct >= 0 ? "up" : "down")}>
                    {ah.last?.toFixed(2)} <span className="text-[9px]">{fmtPct(ah.changePct)}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-[10px] leading-tight">
                  <span className="sub-header">{idx.etf ? "AFT·HRS" : ""}</span>
                  <div className="text-term-muted num">{idx.etf ? "—" : ""}</div>
                </div>
              )}
              <div className="mt-auto pt-1">
                <Spark values={vals} color={dir === "up" ? "#22ee22" : dir === "down" ? "#ff3b3b" : "#b45cff"} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// C. Sector performance — ranked bar list (shared source w/ HEAT)
// ────────────────────────────────────────────────────────────
function SectorPanel() {
  const openTab = useWorkspace((s) => s.openTab);
  const sectors = useSectorPerformance();
  const ranked = [...sectors].sort((a, b) => (b.changePct ?? -99) - (a.changePct ?? -99));
  const maxAbs = Math.max(0.1, ...ranked.map((s) => Math.abs(s.changePct ?? 0)));

  return (
    <div className="panel h-full cursor-pointer" onClick={() => openTab("HEAT")}>
      <div className="panel-header">
        <span>SECTORS</span>
        <span className="sub-header normal-case tracking-normal font-normal">today · click → HEAT</span>
      </div>
      <div className="flex-1 overflow-auto scroll-thin p-2 flex flex-col gap-0.5">
        {ranked.map((s) => {
          const v = s.changePct;
          const dir = v == null ? "flat" : v >= 0 ? "up" : "down";
          const w = v == null ? 0 : (Math.abs(v) / maxAbs) * 50;
          return (
            <div key={s.def.name} className="flex items-center gap-2 text-[11px] py-0.5">
              <span className="text-term-text truncate w-[42%]">{s.def.name}</span>
              <div className="flex-1 flex items-center justify-center h-3 relative">
                <div className="absolute inset-y-0 left-1/2 w-px bg-term-border" />
                <div className={cn("absolute inset-y-0.5", v != null && v >= 0 ? "bg-term-green/40 left-1/2" : "bg-term-red/40 right-1/2")}
                     style={{ width: `${w}%` }} />
              </div>
              <span className={cn("num w-14 text-right", dir === "up" && "up", dir === "down" && "down")}>
                {s.isLoading ? "…" : fmtPct(v)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// D. Compact treasury yields
// ────────────────────────────────────────────────────────────
const YIELD_KEYS: [string, keyof import("@/lib/api").TreasuryRow][] = [
  ["3M", "month_3"], ["6M", "month_6"], ["2Y", "year_2"],
  ["5Y", "year_5"], ["10Y", "year_10"], ["30Y", "year_30"],
];

function TreasuryStrip() {
  const openTab = useWorkspace((s) => s.openTab);
  const curve = useQuery({ queryKey: ["cc-treasury"], queryFn: () => fetchTreasuryRates(2), refetchInterval: 3600_000 });
  const today = curve.data?.slice().sort((a, b) => (a.date > b.date ? -1 : 1))[0];
  const spread = today?.year_10 != null && today?.year_2 != null ? (today.year_10 - today.year_2) * 100 : undefined;
  const status =
    spread == null ? { t: "—", tone: "text-term-muted" }
    : spread < 0 ? { t: "INVERTED", tone: "down" }
    : spread < 25 ? { t: "FLAT", tone: "amber" }
    : { t: "NORMAL", tone: "up" };

  return (
    <div className="panel h-full cursor-pointer" onClick={() => openTab("CURV")}>
      <div className="panel-header">
        <span>US TREASURY YIELDS</span>
        <span className={cn("normal-case tracking-normal font-bold text-[11px]",
          status.tone === "up" && "up", status.tone === "down" && "down",
          status.tone === "amber" && "amber", status.tone.startsWith("text") && status.tone)}>{status.t}</span>
      </div>
      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="sub-header">2s-10s SPREAD</span>
          <span className={cn("num font-semibold text-[13px]", spread == null ? "" : spread >= 0 ? "up" : "down")}>
            {spread == null ? "—" : `${spread >= 0 ? "+" : ""}${spread.toFixed(0)} bps`}
          </span>
        </div>
        <div className="border-t border-term-borderSoft pt-2 grid grid-cols-6 gap-1">
          {YIELD_KEYS.map(([l, k]) => (
            <div key={l} className="text-center">
              <div className="sub-header">{l}</div>
              <div className="num text-term-text text-[12px]">
                {today?.[k] != null ? fmtPctFromDecimal(today[k] as number, 2) : "—"}
              </div>
            </div>
          ))}
        </div>
        <div className="sub-header text-center mt-1">CLICK → CURV</div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// E. Global markets — Indices / Crypto / FX / Commodities toggle
// ────────────────────────────────────────────────────────────
type GmTab = "Indices" | "Crypto" | "FX" | "Commodities";
const GM_TABS: GmTab[] = ["Indices", "Crypto", "FX", "Commodities"];

const INTL_INDICES = [
  { sym: "^STOXX50E", name: "Euro Stoxx 50" },
  { sym: "^FTSE",  name: "FTSE 100" },
  { sym: "^GDAXI", name: "DAX" },
  { sym: "^FCHI",  name: "CAC 40" },
  { sym: "^N225",  name: "Nikkei 225" },
  { sym: "^HSI",   name: "Hang Seng" },
  { sym: "^AXJO",  name: "ASX 200" },
  { sym: "^KS11",  name: "KOSPI" },
];
const CRYPTOS = [
  { sym: "BTC-USD", name: "Bitcoin", digits: 0 },
  { sym: "ETH-USD", name: "Ethereum", digits: 0 },
  { sym: "SOL-USD", name: "Solana", digits: 2 },
  { sym: "BNB-USD", name: "BNB", digits: 2 },
  { sym: "XRP-USD", name: "XRP", digits: 4 },
  { sym: "DOGE-USD", name: "Dogecoin", digits: 4 },
  { sym: "ADA-USD", name: "Cardano", digits: 4 },
  { sym: "AVAX-USD", name: "Avalanche", digits: 2 },
];
const COMMODITIES = [
  { sym: "GC=F", name: "Gold", digits: 2 },
  { sym: "SI=F", name: "Silver", digits: 3 },
  { sym: "CL=F", name: "WTI Crude", digits: 2 },
  { sym: "BZ=F", name: "Brent Crude", digits: 2 },
  { sym: "NG=F", name: "Nat Gas", digits: 3 },
  { sym: "HG=F", name: "Copper", digits: 3 },
  { sym: "ZC=F", name: "Corn", digits: 2 },
  { sym: "ZW=F", name: "Wheat", digits: 2 },
];

interface Row { name: string; last?: number; chgPct?: number; digits: number; isLoading: boolean; }

function RowList({ rows }: { rows: Row[] }) {
  return (
    <div className="p-2 flex flex-col divide-y divide-term-borderSoft text-[12px]">
      {rows.map((r) => {
        const dir = r.chgPct == null ? "flat" : r.chgPct >= 0 ? "up" : "down";
        return (
          <div key={r.name} className="flex items-center gap-2 py-1.5">
            <span className="text-term-amber font-bold text-[11px] flex-1 truncate">{r.name}</span>
            <span className="num w-24 text-right">
              {r.isLoading ? "…" : r.last != null
                ? r.last.toLocaleString(undefined, { minimumFractionDigits: r.digits, maximumFractionDigits: r.digits })
                : "—"}
            </span>
            <span className={cn("num text-[11px] w-16 text-right", dir === "up" && "up", dir === "down" && "down")}>
              {fmtPct(r.chgPct)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function GmIndices() {
  const qs = useQueries({
    queries: INTL_INDICES.map((x) => ({
      queryKey: ["gm-idx", x.sym], queryFn: () => fetchIndexHistorical(x.sym, 10), refetchInterval: 120_000,
    })),
  });
  return <RowList rows={INTL_INDICES.map((x, i) => ({
    name: x.name, digits: 2, isLoading: qs[i].isLoading,
    last: qs[i].data?.[qs[i].data!.length - 1]?.close, chgPct: chgPctOf(qs[i].data),
  }))} />;
}
function GmCrypto() {
  const qs = useQueries({
    queries: CRYPTOS.map((x) => ({
      queryKey: ["gm-crypto", x.sym], queryFn: () => fetchCryptoHistorical(x.sym, 10), refetchInterval: 60_000,
    })),
  });
  return <RowList rows={CRYPTOS.map((x, i) => ({
    name: x.name, digits: x.digits, isLoading: qs[i].isLoading,
    last: qs[i].data?.[qs[i].data!.length - 1]?.close, chgPct: chgPctOf(qs[i].data),
  }))} />;
}
function GmCommodities() {
  const qs = useQueries({
    queries: COMMODITIES.map((x) => ({
      queryKey: ["gm-comm", x.sym], queryFn: () => fetchCommodityHistorical(x.sym, 10), refetchInterval: 120_000,
    })),
  });
  return <RowList rows={COMMODITIES.map((x, i) => ({
    name: x.name, digits: x.digits, isLoading: qs[i].isLoading,
    last: qs[i].data?.[qs[i].data!.length - 1]?.close, chgPct: chgPctOf(qs[i].data),
  }))} />;
}
function GmFx() {
  // Reuse the shared FX intraday cache (same fetch as FXC / ticker tape).
  const qs = useQueries({ queries: FX_BOARD.map((inst) => intradayQueryOptions(inst)) });
  return <RowList rows={FX_BOARD.map((inst, i) => {
    const s = intradayStats(qs[i].data);
    const chgPct = s.last != null && s.prevClose ? ((s.last - s.prevClose) / s.prevClose) * 100 : undefined;
    return { name: inst.pair, digits: inst.digits, isLoading: qs[i].isLoading, last: s.last, chgPct };
  })} />;
}

function GlobalMarkets() {
  const [tab, setTab] = useState<GmTab>("Indices");
  return (
    <div className="panel h-full">
      <div className="panel-header">
        <span>GLOBAL MARKETS</span>
        <div className="flex items-center gap-1">
          {GM_TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("px-1.5 py-0.5 text-[10px] uppercase tracking-wider border normal-case",
                t === tab ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto scroll-thin">
        {tab === "Indices" && <GmIndices />}
        {tab === "Crypto" && <GmCrypto />}
        {tab === "FX" && <GmFx />}
        {tab === "Commodities" && <GmCommodities />}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Movers + news (existing behaviour)
// ────────────────────────────────────────────────────────────
function MoversPanel({ kind }: { kind: "gainers" | "losers" }) {
  const openTab = useWorkspace((s) => s.openTab);
  const q = useQuery({
    queryKey: [`cc-${kind}`], queryFn: kind === "gainers" ? fetchGainers : fetchLosers, refetchInterval: 120_000,
  });
  const tone = kind === "gainers" ? "up" : "down";
  return (
    <div className="panel h-full">
      <div className="panel-header">
        <span className={tone}>{kind === "gainers" ? "TOP GAINERS" : "TOP LOSERS"}</span>
        <span className="sub-header normal-case tracking-normal font-normal cursor-pointer hover:text-term-amber" onClick={() => openTab("MOV")}>view all →</span>
      </div>
      <div className="flex-1 overflow-auto scroll-thin">
        <table className="w-full text-[12px]">
          <tbody>
            {(q.data ?? []).slice(0, 8).map((m, i) => (
              <tr key={m.symbol} onClick={() => openTab("INTEL", m.symbol)}
                  className="cursor-pointer border-b border-term-borderSoft hover:bg-term-amberSubtle">
                <td className="px-2 py-1 text-term-muted num w-6">{i + 1}</td>
                <td className="px-2 py-1 num text-term-amber font-semibold w-16">{m.symbol}</td>
                <td className="px-2 py-1 text-term-heading truncate max-w-[200px]">{m.name}</td>
                <td className="px-2 py-1 num text-right">{fmtPrice(m.price)}</td>
                <td className={cn("px-2 py-1 num text-right w-20", tone)}>{fmtPct(m.percent_change * 100)}</td>
              </tr>
            ))}
            {q.isLoading && <tr><td colSpan={5} className="p-3 text-term-muted">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="border-t border-term-border p-1 sub-header text-center">CLICK → INTEL</div>
    </div>
  );
}

function NewsPanel() {
  const news = useQuery({ queryKey: ["cc-news"], queryFn: () => fetchNewsCompany("SPY", 12), staleTime: 60_000 });
  return (
    <div className="panel h-full">
      <div className="panel-header"><span>MARKET HEADLINES</span></div>
      <div className="flex-1 overflow-auto scroll-thin divide-y divide-term-borderSoft">
        {news.isLoading && <div className="p-3 text-term-muted">Loading…</div>}
        {(news.data ?? []).slice(0, 12).map((n, i) => (
          <a key={n.id + i} href={n.url} target="_blank" rel="noreferrer"
            className="block px-3 py-1.5 hover:bg-term-amberSubtle group">
            <div className="sub-header">{fmtTime(n.date)} · {n.source}</div>
            <div className="text-term-heading group-hover:text-term-amber text-[12px] leading-snug line-clamp-2">{n.title}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Command Center — assembled layout (scrolls inside the FunctionPanel)
// ────────────────────────────────────────────────────────────
export function CC() {
  return (
    <div className="p-3 flex flex-col gap-3">
      {/* Band 1: index cards (A) + pinned XAU scalper */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", minHeight: 190 }}>
        <UsMarkets />
        <XauScalper />
      </div>

      {/* Band 2: normalized performance chart (B) + sectors (C) */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", height: 340 }}>
        <div className="panel min-h-0">
          <div className="panel-header">
            <span>INDEX PERFORMANCE</span>
            <span className="sub-header normal-case tracking-normal font-normal">normalized · % change</span>
          </div>
          <div className="flex-1 min-h-0"><NormalizedChart /></div>
        </div>
        <SectorPanel />
      </div>

      {/* Band 3: global markets (E) + treasury (D) */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", height: 300 }}>
        <GlobalMarkets />
        <TreasuryStrip />
      </div>

      {/* Band 4: movers + headlines */}
      <div className="grid grid-cols-3 gap-3" style={{ height: 300 }}>
        <MoversPanel kind="gainers" />
        <MoversPanel kind="losers" />
        <NewsPanel />
      </div>
    </div>
  );
}
