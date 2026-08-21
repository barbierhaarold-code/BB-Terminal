import { Fragment, useState } from "react";
import { useJournal } from "@/store/journalStore";
import type { Trade } from "@/lib/journal";
import { MACRO_BIAS_OPTIONS, CONVICTION_OPTIONS, mask } from "@/lib/journal";
import { fmtPrice } from "@/lib/format";
import { cn } from "@/lib/cn";

const inputCls = "bg-term-panel border border-term-border px-1.5 py-0.5 text-term-text placeholder:text-term-muted focus:outline-none focus:border-term-amber text-[11px]";

export function TradeTable({ trades }: { trades: Trade[] }) {
  const { setups, deleteTrade, assignSetup, pricesHidden } = useJournal();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bulkSetupId, setBulkSetupId] = useState("");

  const setupById = new Map(setups.map((s) => [s.id, s.name]));
  const sorted = [...trades].sort((a, b) => (a.entryAt < b.entryAt ? 1 : -1));

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  function toggleAll() {
    setSelected(selected.size === sorted.length ? new Set() : new Set(sorted.map((t) => t.id)));
  }

  function applyBulkSetup() {
    if (selected.size === 0) return;
    assignSetup(Array.from(selected), bulkSetupId || undefined);
    setSelected(new Set());
    setBulkSetupId("");
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span>TRADES</span>
        <span className="sub-header normal-case tracking-normal font-normal">{trades.length} in view</span>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-term-borderSoft bg-term-amberSubtle text-[11px]">
          <span className="text-term-amber font-bold">{selected.size} selected</span>
          <select value={bulkSetupId} onChange={(e) => setBulkSetupId(e.target.value)} className={inputCls}>
            <option value="">— no setup —</option>
            {setups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={applyBulkSetup} className="px-2 py-0.5 border border-term-amber text-term-amber">Assign setup</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-term-muted hover:text-term-text">clear</button>
        </div>
      )}

      {trades.length === 0 ? (
        <div className="p-4 text-term-muted text-[11px] uppercase tracking-widest">No trades match the current filters.</div>
      ) : (
        <div className="max-h-[420px] overflow-auto scroll-thin">
          <table className="w-full grid-data text-[11px]">
            <thead>
              <tr>
                <th className="w-6"><input type="checkbox" checked={selected.size === sorted.length} onChange={toggleAll} /></th>
                <th>SYMBOL</th><th>DIR</th><th className="text-right">SIZE</th>
                <th className="text-right">ENTRY</th><th className="text-right">EXIT</th>
                <th className="text-right">RESULT</th><th>DATE</th><th>SETUP</th><th>SRC</th><th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <Fragment key={t.id}>
                  <tr className="cursor-pointer hover:bg-term-panel2" onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></td>
                    <td className="text-term-amber font-semibold">{t.symbol}</td>
                    <td className={t.direction === "buy" ? "text-term-green" : "text-term-red"}>{t.direction}</td>
                    <td className="num text-right">{t.size}</td>
                    <td className="num text-right">{fmtPrice(t.entryPrice, 2)}</td>
                    <td className="num text-right">{fmtPrice(t.exitPrice, 2)}</td>
                    <td className={cn("num text-right", t.result >= 0 ? "up" : "down")}>{mask(`${t.result >= 0 ? "+" : ""}${fmtPrice(t.result, 2)}`, pricesHidden)}</td>
                    <td className="text-term-muted">{t.entryAt.slice(0, 16).replace("T", " ")}</td>
                    <td className="text-term-muted">{t.setupId ? setupById.get(t.setupId) ?? "—" : "—"}</td>
                    <td className="text-term-muted uppercase">{t.source}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => deleteTrade(t.id)} className="text-term-red/70 hover:text-term-red px-1">✕</button>
                    </td>
                  </tr>
                  {expanded === t.id && (
                    <tr>
                      <td colSpan={11} className="bg-term-panel2 p-0">
                        <TradeEditPanel trade={t} onClose={() => setExpanded(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TradeEditPanel({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const { updateTrade, setups } = useJournal();
  const [form, setForm] = useState({
    symbol: trade.symbol,
    direction: trade.direction,
    size: String(trade.size),
    entryPrice: String(trade.entryPrice),
    exitPrice: String(trade.exitPrice),
    result: String(trade.result),
    setupId: trade.setupId ?? "",
    macroBias: trade.macroBias ?? "",
    conviction: trade.conviction ?? "",
    newsEvent: trade.newsEvent ?? "",
    feeling: trade.feeling ?? "",
    notes: trade.notes ?? "",
  });

  function save() {
    updateTrade(trade.id, {
      symbol: form.symbol.trim().toUpperCase(),
      direction: form.direction,
      size: Number(form.size),
      entryPrice: Number(form.entryPrice),
      exitPrice: Number(form.exitPrice),
      result: Number(form.result),
      setupId: form.setupId || undefined,
      macroBias: form.macroBias || undefined,
      conviction: form.conviction || undefined,
      newsEvent: form.newsEvent.trim() || undefined,
      feeling: form.feeling.trim() || undefined,
      notes: form.notes.trim() || undefined,
    });
    onClose();
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="p-3 flex flex-col gap-2 border-t border-b border-term-amberDim">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <input value={form.symbol} onChange={(e) => set("symbol", e.target.value)} className={cn(inputCls, "uppercase")} />
        <div className="flex gap-1">
          {(["buy", "sell"] as const).map((d) => (
            <button key={d} onClick={() => set("direction", d)}
              className={cn("flex-1 px-1 py-0.5 border text-[10px] uppercase", d === form.direction ? (d === "buy" ? "border-term-green text-term-green" : "border-term-red text-term-red") : "border-term-border text-term-muted")}>
              {d}
            </button>
          ))}
        </div>
        <input value={form.size} onChange={(e) => set("size", e.target.value)} placeholder="size" className={cn(inputCls, "num")} />
        <input value={form.entryPrice} onChange={(e) => set("entryPrice", e.target.value)} placeholder="entry" className={cn(inputCls, "num")} />
        <input value={form.exitPrice} onChange={(e) => set("exitPrice", e.target.value)} placeholder="exit" className={cn(inputCls, "num")} />
        <input value={form.result} onChange={(e) => set("result", e.target.value)} placeholder="result" className={cn(inputCls, "num")} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <select value={form.setupId} onChange={(e) => set("setupId", e.target.value)} className={inputCls}>
          <option value="">— setup —</option>
          {setups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={form.macroBias} onChange={(e) => set("macroBias", e.target.value)} className={inputCls}>
          <option value="">— biais macro —</option>
          {MACRO_BIAS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={form.conviction} onChange={(e) => set("conviction", e.target.value)} className={inputCls}>
          <option value="">— conviction —</option>
          {CONVICTION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input value={form.feeling} onChange={(e) => set("feeling", e.target.value)} placeholder="ressenti" className={inputCls} />
      </div>
      <input value={form.newsEvent} onChange={(e) => set("newsEvent", e.target.value)} placeholder="news / événement macro" className={cn(inputCls, "w-full")} />
      <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="notes" rows={2} className={cn(inputCls, "w-full resize-none")} />
      <div className="flex gap-2">
        <button onClick={save} className="px-3 py-1 border border-term-amber text-term-amber text-[11px] uppercase font-bold">Save</button>
        <button onClick={onClose} className="px-3 py-1 border border-term-border text-term-muted text-[11px] uppercase">Cancel</button>
      </div>
    </div>
  );
}
