import { useMemo, useState } from "react";
import { useJournal } from "@/store/journalStore";
import { parseImportText, type ImportResult } from "@/lib/journal";
import { fmtPrice } from "@/lib/format";
import { cn } from "@/lib/cn";

const PLACEHOLDER = `XAUUSD buy 0.3 / 4390.64 → 4388.52  -54.93 / 2026.08.14 17:01:56
EURUSD sell 1.0 / 1.16850 → 1.16720  +130.00 / 2026.08.15 09:22:10`;

/**
 * One-time bulk backfill for existing trade history — pastes MT4/5-style
 * lines ("SYMBOL direction size / entry → exit  result / YYYY.MM.DD HH:mm:ss"),
 * previews the parse before committing, and reports lines it couldn't read
 * instead of silently dropping them. Imported trades land in the same
 * table as manual entries and are editable afterward — this box is not
 * itself part of the ongoing logging flow.
 */
export function BulkImport() {
  const { bulkAddTrades } = useJournal();
  const [text, setText] = useState("");
  const [imported, setImported] = useState<number | null>(null);

  const parsed: ImportResult = useMemo(() => parseImportText(text), [text]);

  function commit() {
    if (parsed.trades.length === 0) return;
    const n = bulkAddTrades(parsed.trades);
    setImported(n);
    setText("");
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span>BULK IMPORT</span>
        <span className="sub-header normal-case tracking-normal font-normal">one-time backfill · MT4/5-style paste</span>
      </div>
      <div className="p-3 flex flex-col gap-2">
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setImported(null); }}
          placeholder={PLACEHOLDER}
          rows={5}
          spellCheck={false}
          className="bg-term-panel border border-term-border px-2 py-1.5 text-term-text placeholder:text-term-muted/60 focus:outline-none focus:border-term-amber w-full num text-[11px] resize-y"
        />

        {text.trim().length > 0 && (
          <div className="flex items-center gap-4 text-[11px]">
            <span className="text-term-green">{parsed.trades.length} parsed</span>
            {parsed.errors.length > 0 && <span className="text-term-red">{parsed.errors.length} failed</span>}
            <button onClick={commit} disabled={parsed.trades.length === 0}
              className={cn("ml-auto px-3 py-1 border text-[11px] uppercase tracking-wider font-bold",
                parsed.trades.length > 0 ? "border-term-amber text-term-amber hover:bg-term-amberSubtle" : "border-term-border text-term-muted cursor-not-allowed")}>
              Import {parsed.trades.length || ""}
            </button>
          </div>
        )}

        {parsed.trades.length > 0 && (
          <div className="border border-term-borderSoft max-h-[180px] overflow-auto scroll-thin">
            <table className="w-full grid-data text-[11px]">
              <thead>
                <tr>
                  <th>SYMBOL</th><th>DIR</th><th className="text-right">SIZE</th>
                  <th className="text-right">ENTRY</th><th className="text-right">EXIT</th>
                  <th className="text-right">RESULT</th><th>DATE</th>
                </tr>
              </thead>
              <tbody>
                {parsed.trades.map((t, i) => (
                  <tr key={i}>
                    <td className="text-term-amber font-semibold">{t.symbol}</td>
                    <td className={t.direction === "buy" ? "text-term-green" : "text-term-red"}>{t.direction}</td>
                    <td className="num text-right">{t.size}</td>
                    <td className="num text-right">{fmtPrice(t.entryPrice, 2)}</td>
                    <td className="num text-right">{fmtPrice(t.exitPrice, 2)}</td>
                    <td className={cn("num text-right", t.result >= 0 ? "up" : "down")}>{t.result >= 0 ? "+" : ""}{fmtPrice(t.result, 2)}</td>
                    <td className="text-term-muted">{t.entryAt.replace("T", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {parsed.errors.length > 0 && (
          <div className="border border-term-red/40 p-2 max-h-[120px] overflow-auto scroll-thin">
            {parsed.errors.map((e, i) => (
              <div key={i} className="text-[11px] mb-1">
                <span className="text-term-red">✗</span>{" "}
                <span className="text-term-muted num">{e.line}</span>
                <div className="text-term-red/80 ml-4">{e.reason}</div>
              </div>
            ))}
          </div>
        )}

        {imported != null && (
          <div className="text-term-green text-[11px] uppercase tracking-wider">✓ imported {imported} trade{imported === 1 ? "" : "s"}</div>
        )}
      </div>
    </div>
  );
}
