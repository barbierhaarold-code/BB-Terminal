import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trash2, Pencil, Check, X } from "lucide-react";
import { fetchQuotes, type Quote } from "@/lib/api";
import { fmtPrice, fmtPct, fmtDate, dirClass } from "@/lib/format";
import { usePortfolio } from "@/store/portfolioStore";
import { computePositionMetrics, computeBookTotals, type Position } from "@/lib/portfolio";
import { useWorkspace } from "@/store/workspaceStore";
import { cn } from "@/lib/cn";

export function PositionsTable() {
  const { positions, addPosition, updatePosition, removePosition } = usePortfolio();
  const openTab = useWorkspace((s) => s.openTab);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const symbols = useMemo(() => positions.map((p) => p.symbol), [positions]);
  const quotesQ = useQuery({
    queryKey: ["portfolio-quotes", symbols.join(",")],
    queryFn: () => fetchQuotes(symbols),
    enabled: symbols.length > 0,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const quoteBySymbol = useMemo(() => {
    const m = new Map<string, Quote>();
    for (const q of quotesQ.data ?? []) m.set(q.symbol, q);
    return m;
  }, [quotesQ.data]);

  const rows = useMemo(
    () => computePositionMetrics(positions, quoteBySymbol),
    [positions, quoteBySymbol]
  );
  const totals = useMemo(() => computeBookTotals(rows), [rows]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-4 flex-wrap px-3 py-2 border-b border-term-border bg-term-panel2 text-[11px]">
        <Stat label="Market Value" value={fmtPrice(totals.marketValue)} prefix="$" />
        <Stat label="Day P&L" value={fmtPrice(totals.dayPnl)} prefix={totals.dayPnl >= 0 ? "+$" : "-$"} abs
          tone={dirClass(totals.dayPnl)} sub={fmtPct(totals.dayPnlPct)} />
        <Stat label="Total P&L" value={fmtPrice(totals.totalPnl)} prefix={totals.totalPnl >= 0 ? "+$" : "-$"} abs
          tone={dirClass(totals.totalPnl)} sub={fmtPct(totals.totalPnlPct)} />
        <button
          onClick={() => setShowForm((v) => !v)}
          className="ml-auto px-2.5 py-1 border border-term-amber text-term-amber uppercase tracking-wider hover:bg-term-amberSubtle shrink-0"
        >
          {showForm ? "Close" : "+ Add Position"}
        </button>
      </div>

      {showForm && <AddPositionForm onAdd={(p) => { addPosition(p); setShowForm(false); }} />}

      <div className="flex-1 overflow-auto scroll-thin">
        {positions.length === 0 && (
          <div className="p-6 text-center text-term-muted text-[12px] uppercase tracking-widest">
            No positions yet — click + Add Position.
          </div>
        )}
        {positions.length > 0 && (
          <table className="w-full text-[12px] grid-data">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="text-right">Shares</th>
                <th className="text-right">Cost Basis</th>
                <th>Opened</th>
                <th className="text-right">Last</th>
                <th className="text-right">Mkt Value</th>
                <th className="text-right">Day P&L</th>
                <th className="text-right">Total P&L</th>
                <th className="text-right">Weight</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) =>
                editingId === r.position.id ? (
                  <EditRow
                    key={r.position.id}
                    position={r.position}
                    onSave={(patch) => { updatePosition(r.position.id, patch); setEditingId(null); }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <tr key={r.position.id} className="cursor-pointer" onClick={() => openTab("INTEL", r.position.symbol)}>
                    <td className="num text-term-amber font-semibold">{r.position.symbol}</td>
                    <td className="num text-right">{r.position.shares}</td>
                    <td className="num text-right text-term-muted">{fmtPrice(r.position.costBasis)}</td>
                    <td className="text-term-muted">{fmtDate(r.position.date)}</td>
                    <td className="num text-right">{r.last != null ? fmtPrice(r.last) : "—"}</td>
                    <td className="num text-right text-term-heading">{r.marketValue != null ? fmtPrice(r.marketValue) : "—"}</td>
                    <td className={cn("num text-right", dirClass(r.dayPnl))}>
                      {r.dayPnl != null ? (r.dayPnl >= 0 ? "+" : "") + fmtPrice(r.dayPnl) : "—"}
                    </td>
                    <td className={cn("num text-right", dirClass(r.totalPnl))}>
                      {r.totalPnl != null ? (r.totalPnl >= 0 ? "+" : "") + fmtPrice(r.totalPnl) : "—"}
                      <span className="text-term-muted ml-1">({fmtPct(r.totalPnlPct)})</span>
                    </td>
                    <td className="num text-right text-term-muted">{r.weight != null ? r.weight.toFixed(1) + "%" : "—"}</td>
                    <td className="text-center whitespace-nowrap">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingId(r.position.id); }}
                        className="text-term-muted hover:text-term-amber mr-2"
                        title="Edit position"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removePosition(r.position.id); }}
                        className="text-term-muted hover:text-term-red"
                        title="Remove position"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, prefix = "", abs = false, tone, sub }: {
  label: string; value: string; prefix?: string; abs?: boolean; tone?: "up" | "down" | "flat"; sub?: string;
}) {
  const display = abs ? value.replace("-", "") : value;
  return (
    <div className="flex flex-col shrink-0">
      <span className="sub-header">{label}</span>
      <span className={cn("num text-[13px]", tone === "up" && "up", tone === "down" && "down", !tone && "text-term-heading")}>
        {prefix}{display}
        {sub && <span className="text-term-muted text-[11px] ml-1.5">({sub})</span>}
      </span>
    </div>
  );
}

const inputCls = "bg-term-panel border border-term-border px-2 py-1 text-term-text placeholder:text-term-muted focus:outline-none focus:border-term-amber";
const labelCls = "sub-header block mb-1";

function EditRow({ position, onSave, onCancel }: {
  position: Position;
  onSave: (patch: { shares: number; costBasis: number; date: string }) => void;
  onCancel: () => void;
}) {
  const [shares, setShares] = useState(String(position.shares));
  const [costBasis, setCostBasis] = useState(String(position.costBasis));
  const [date, setDate] = useState(position.date.slice(0, 10));
  const [err, setErr] = useState<string | null>(null);

  function save() {
    const sh = Number(shares);
    const cb = Number(costBasis);
    if (!Number.isFinite(sh) || sh <= 0) { setErr("Shares must be a positive number."); return; }
    if (!Number.isFinite(cb) || cb <= 0) { setErr("Cost basis must be a positive number."); return; }
    if (!date) { setErr("Date is required."); return; }
    onSave({ shares: sh, costBasis: cb, date });
  }

  return (
    <tr className="bg-term-bg2">
      <td className="num text-term-amber font-semibold">{position.symbol}</td>
      <td className="text-right"><input value={shares} onChange={(e) => setShares(e.target.value)} inputMode="decimal" className={cn(inputCls, "w-20 num text-right")} /></td>
      <td className="text-right"><input value={costBasis} onChange={(e) => setCostBasis(e.target.value)} inputMode="decimal" className={cn(inputCls, "w-24 num text-right")} /></td>
      <td><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(inputCls, "w-36 num")} /></td>
      <td colSpan={5}>{err && <span className="text-term-red">{err}</span>}</td>
      <td className="text-center whitespace-nowrap">
        <button onClick={save} className="text-term-muted hover:text-term-green mr-2" title="Save"><Check size={14} /></button>
        <button onClick={onCancel} className="text-term-muted hover:text-term-red" title="Cancel"><X size={14} /></button>
      </td>
    </tr>
  );
}

function AddPositionForm({ onAdd }: { onAdd: (p: { symbol: string; shares: number; costBasis: number; date: string }) => void }) {
  const [symbol, setSymbol] = useState("");
  const [shares, setShares] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    const s = symbol.trim().toUpperCase();
    const sh = Number(shares);
    const cb = Number(costBasis);
    if (!s) { setErr("Symbol is required."); return; }
    if (!Number.isFinite(sh) || sh <= 0) { setErr("Shares must be a positive number."); return; }
    if (!Number.isFinite(cb) || cb <= 0) { setErr("Cost basis must be a positive number."); return; }
    if (!date) { setErr("Date is required."); return; }
    onAdd({ symbol: s, shares: sh, costBasis: cb, date });
  }

  return (
    <div className="flex items-end gap-2 flex-wrap px-3 py-2 border-b border-term-border bg-term-bg2 text-[11px]">
      <div>
        <label className={labelCls}>Symbol</label>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="AAPL"
          spellCheck={false} className={cn(inputCls, "w-24")} />
      </div>
      <div>
        <label className={labelCls}>Shares</label>
        <input value={shares} onChange={(e) => setShares(e.target.value)} placeholder="10" inputMode="decimal"
          className={cn(inputCls, "w-20 num")} />
      </div>
      <div>
        <label className={labelCls}>Cost Basis</label>
        <input value={costBasis} onChange={(e) => setCostBasis(e.target.value)} placeholder="150.00" inputMode="decimal"
          className={cn(inputCls, "w-24 num")} />
      </div>
      <div>
        <label className={labelCls}>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(inputCls, "w-36 num")} />
      </div>
      <button onClick={submit} className="px-2.5 py-1 border border-term-amber text-term-amber uppercase tracking-wider hover:bg-term-amberSubtle">
        Add
      </button>
      {err && <span className="text-term-red">{err}</span>}
    </div>
  );
}
