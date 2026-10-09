import { useRef, useState } from "react";
import { useJournal } from "@/store/journalStore";
import { useTradePlans } from "@/store/tradePlanStore";
import { computeStats } from "@/lib/journal";
import {
  downloadBackup, parseBackup, applyImport,
  type BackupFile, type ApplyResult,
} from "@/lib/journalBackup";
import { cn } from "@/lib/cn";
import { isServerMode } from "@/lib/userData/backend";

type Notice = { tone: "ok" | "error"; text: string };

const btn = "px-3 py-1.5 border text-[11px] uppercase tracking-wider font-bold border-term-border text-term-muted hover:text-term-amber hover:border-term-amber disabled:opacity-40 disabled:hover:text-term-muted disabled:hover:border-term-border";

/**
 * Export / Import JSON for the whole Track Record store. Import never writes
 * anything until the user has seen what the file contains and picked
 * Replace or Merge; malformed files are rejected with the reason shown.
 */
export function BackupPanel() {
  const tradeCount = useJournal((s) => s.trades.length);
  const planCount = useTradePlans((s) => s.plans.length);
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const baseCapital = useJournal((s) => s.baseCapital);
  const server = isServerMode();
  const [busy, setBusy] = useState(false);
  const [copyCapital, setCopyCapital] = useState(true);
  const [pending, setPending] = useState<{ fileName: string; backup: BackupFile; warnings: string[] } | null>(null);

  function onExport() {
    try {
      const { fileName, tradeCount: n } = downloadBackup();
      setNotice({ tone: "ok", text: `Exported ${n} trades and ${planCount} plans → ${fileName}` });
    } catch (e) {
      setNotice({ tone: "error", text: `Export failed: ${(e as Error).message}` });
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setNotice(null);
    setPending(null);
    setReading(true);
    try {
      const result = parseBackup(await file.text());
      if (!result.ok) setNotice({ tone: "error", text: `Import rejected — ${result.error}` });
      else setPending({ fileName: file.name, backup: result.backup, warnings: result.warnings });
    } catch (e) {
      setNotice({ tone: "error", text: `Could not read file: ${(e as Error).message}` });
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = ""; // allow re-picking the same file
    }
  }

  async function confirm(mode: "replace" | "merge") {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const r: ApplyResult = await applyImport(pending.backup, mode, { copyBaseCapital: server && copyCapital });
      const planText = r.plans
        ? ` Plans: ${r.plans.before} → ${r.plans.after}${mode === "merge" ? ` (${r.plans.added} added, ${r.plans.skipped} duplicates skipped)` : ""}.`
        : " Plans untouched (file has none).";
      setNotice({
        tone: "ok",
        text: (mode === "replace"
          ? `Replaced: ${r.before} → ${r.after} trades.`
          : `Merged: ${r.before} → ${r.after} trades (${r.added} added, ${r.skipped} duplicates skipped).`) + planText
          + (r.check ? (r.check.ok ? ` Re-checked on the server: ${r.check.actualTrades} trades, net ${r.check.actualNet.toFixed(2)} ✔.` : ` ⚠ Server re-check mismatch: ${r.check.problems.join("; ")}.`) : ""),
      });
      if (r.check && !r.check.ok) setNotice({ tone: "error", text: `Imported, but the server re-check does not match: ${r.check.problems.join("; ")}.` });
      setPending(null);
    } catch (e) {
      setNotice({ tone: "error", text: `Import failed${server ? " (nothing was changed or the import can be safely re-run)" : ", data unchanged"}: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const b = pending?.backup;
  const net = b ? computeStats(b.data.trades, b.data.baseCapital).netProfit : 0;

  return (
    <div className="flex flex-col gap-2 ml-auto items-end">
      <div className="flex gap-1">
        <button onClick={onExport} disabled={tradeCount === 0 && planCount === 0} title={tradeCount === 0 && planCount === 0 ? "Nothing to export yet" : "Download all Track Record data as JSON"} className={btn}>
          Export JSON
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={reading} className={btn}>
          {reading ? "Reading…" : "Import JSON"}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>

      {tradeCount === 0 && planCount === 0 && !notice && !pending && (
        <div className="sub-header normal-case tracking-normal font-normal text-term-muted">No trades yet — nothing to export.</div>
      )}

      {notice && (
        <div className={cn("text-[11px] max-w-[460px] text-right", notice.tone === "error" ? "text-term-red" : "text-term-amber")} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </div>
      )}

      {pending && b && (
        <div className="panel w-[460px] max-w-full" role="dialog" aria-label="Confirm import">
          <div className="panel-header"><span>CONFIRM IMPORT</span><span className="sub-header normal-case tracking-normal font-normal">{pending.fileName}</span></div>
          <div className="p-3 flex flex-col gap-2 text-[11px]">
            <div className="text-term-text">
              This file contains <b className="num">{b.data.trades.length}</b> trades
              (net P&L <b className="num">{net.toFixed(2)}</b>, {b.data.setups.length} setups
              {b.data.tradePlans ? <>, <b className="num">{b.data.tradePlans.plans.length}</b> trade plans</> : ", no trade plans"}).
              Current data has <b className="num">{tradeCount}</b> trades.
            </div>
            <div className="text-term-muted">
              Exported {b.header.exportedAt ? new Date(b.header.exportedAt).toLocaleString() : "?"} · app v{b.header.appVersion || "?"}
            </div>
            {pending.warnings.map((w) => <div key={w} className="text-term-red">⚠ {w}</div>)}
            {server && (
              <div className="text-term-muted" data-testid="server-import-note">
                Merge adds only what your account does not already have (same id or same fill = skipped) and can be run twice safely.
                Replace is disabled for server accounts.
                {b.data.baseCapital != null && baseCapital == null && (
                  <label className="flex items-center gap-2 mt-1 text-term-text">
                    <input type="checkbox" checked={copyCapital} onChange={(e) => setCopyCapital(e.target.checked)} />
                    Set this account's base capital to {b.data.baseCapital.toLocaleString()} (it has none yet)
                  </label>
                )}
              </div>
            )}
            {!server && <div className="text-term-muted">
              <b>Replace</b> overwrites all current trades, setups and base capital with the file's (trade plans too, but only if the file contains plans).{" "}
              <b>Merge</b> keeps current data and adds only trades and plans not already present.
            </div>}
            <div className="flex gap-1">
              {!server && <button onClick={() => void confirm("replace")} className={cn(btn, "border-term-red text-term-red hover:border-term-red hover:text-term-red")}>Replace</button>}
              <button onClick={() => void confirm("merge")} disabled={busy} className={cn(btn, "border-term-amber text-term-amber")}>{busy ? "Importing…" : "Merge (skip duplicates)"}</button>
              <button onClick={() => setPending(null)} className={btn}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
