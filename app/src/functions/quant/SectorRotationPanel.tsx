import { useState } from "react";
import { useSectorRotation, ROTATION_PERIODS } from "@/lib/sectors";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";

type SortPeriod = (typeof ROTATION_PERIODS)[number]["label"];

export function SectorRotationPanel() {
  const rows = useSectorRotation();
  const [sortBy, setSortBy] = useState<SortPeriod>("1M");
  const sortIdx = ROTATION_PERIODS.findIndex((p) => p.label === sortBy);

  const ranked = [...rows].sort((a, b) => (b.returns[sortIdx] ?? -999) - (a.returns[sortIdx] ?? -999));
  const anyLoading = rows.some((r) => r.isLoading);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 h-8 px-3 border-b border-term-border bg-term-panel2 text-[10px] uppercase tracking-wider">
        <span className="text-term-muted">Rank by</span>
        {ROTATION_PERIODS.map((p) => (
          <button key={p.label} onClick={() => setSortBy(p.label)}
            className={cn("px-1.5 py-0.5 border",
              p.label === sortBy ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto scroll-thin p-2">
        <table className="grid-data w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th>#</th>
              <th>Sector</th>
              <th>ETF</th>
              {ROTATION_PERIODS.map((p) => <th key={p.label} className="text-right">{p.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {ranked.map((row, i) => (
              <tr key={row.def.name}>
                <td className="text-term-muted">{i + 1}</td>
                <td className="text-term-text">{row.def.name}</td>
                <td className="num text-term-muted">{row.def.etf}</td>
                {row.returns.map((v, j) => (
                  <td key={j} className={cn("num text-right", v != null && (v >= 0 ? "up" : "down"))}>
                    {row.isLoading && v == null ? "…" : fmtPct(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {anyLoading && <div className="text-term-muted text-[11px] p-2">Loading sector history…</div>}
      </div>
    </div>
  );
}
