import { useMemo, useState } from "react";
import { useJournal } from "@/store/journalStore";
import { useTradePlans } from "@/store/tradePlanStore";
import { useAuth } from "@/store/authStore";
import { isServerMode } from "@/lib/userData/backend";
import { importBlockedReason, importIntoAccount } from "@/lib/userData/accountImport";
import { legacyToBatch, previewLegacy, readImportMarker, readLegacyLocal, writeImportMarker, type LegacyLocal } from "@/lib/userData/legacyLocal";
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, downloadBackupFile } from "@/lib/journalBackup";
import { PLAN_SCHEMA_VERSION } from "@/lib/tradePlan";
import { cn } from "@/lib/cn";

const btn = "px-3 py-1.5 border text-[11px] uppercase tracking-wider font-bold border-term-border text-term-muted hover:text-term-amber hover:border-term-amber disabled:opacity-40 disabled:hover:text-term-muted disabled:hover:border-term-border";
const usd = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Done = { ok: boolean; lines: string[] };

/**
 * "Import my local journal into this account" — EXPLICIT, never automatic.
 * Shown only in server mode, when the account is loaded and browser-local data exists.
 * It reads the legacy local data (read-only), previews it, asks for confirmation, writes
 * idempotently to the account, re-checks count and net P&L, and leaves local data untouched.
 */
export function ImportLocalDialog() {
  const email = useAuth((s) => s.email);
  const userId = useAuth((s) => s.session?.user.id ?? null);
  const journalReady = useJournal((s) => s.status) === "ready";
  const plansReady = useTradePlans((s) => s.status) === "ready";
  const accountTrades = useJournal((s) => s.trades);
  const accountSetups = useJournal((s) => s.setups);
  const accountPlans = useTradePlans((s) => s.plans);
  const accountCapital = useJournal((s) => s.baseCapital);
  const [legacy, setLegacy] = useState<LegacyLocal | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [copyCapital, setCopyCapital] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  // Read-only probe so the button appears only when browser-local data exists.
  const probe = useMemo(() => (isServerMode() ? readLegacyLocal() : null), [userId, done]);

  if (!isServerMode() || !userId || !journalReady || !plansReady || !probe) return null;
  if (!legacy && !probe.present && probe.problems.length === 0) return null;

  const marker = readImportMarker();
  const pv = legacy ? previewLegacy(legacy, { trades: accountTrades, setups: accountSetups, plans: accountPlans }) : null;

  function open() { setDone(null); setConfirmed(false); setLegacy(readLegacyLocal()); }
  function close() { setLegacy(null); setConfirmed(false); }

  function downloadLocalCopy() {
    if (!legacy) return;
    downloadBackupFile({
      header: { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt: new Date().toISOString(), appVersion: "local-copy",
        tradeCount: legacy.trades.length, totalNetPnl: pv?.netPnl ?? 0, planCount: legacy.plans.length },
      data: { trades: legacy.trades, setups: legacy.setups, baseCapital: legacy.baseCapital, pricesHidden: legacy.pricesHidden,
        tradePlans: { schemaVersion: PLAN_SCHEMA_VERSION, plans: legacy.plans } },
    });
  }

  async function run() {
    if (!legacy || !pv || busy) return;
    setBusy(true);
    try {
      const r = await importIntoAccount(legacyToBatch(legacy), { copyBaseCapital: copyCapital ? legacy.baseCapital : null });
      writeImportMarker({ account: userId!.slice(0, 8), at: new Date().toISOString(), trades: r.after.trades.length, plans: r.after.plans.length });
      setDone({
        ok: r.check.ok,
        lines: [
          `Imported ${r.inserted.trades} new trades, ${r.inserted.plans} new plans, ${r.inserted.setups} new setups; ${r.plan.skipped.trades} trades and ${r.plan.skipped.plans} plans were already in this account (skipped).`,
          `Re-checked on the server: ${r.check.actualTrades} trades (expected ${r.check.expectedTrades}), net P&L ${usd(r.check.actualNet)} (expected ${usd(r.check.expectedNet)}), ${r.check.actualPlans} plans (expected ${r.check.expectedPlans}).`,
          r.baseCapital.action === "set" ? `Base capital set to ${usd(r.baseCapital.value ?? 0)}.` : r.baseCapital.action === "kept-existing" ? "This account already had a base capital: kept." : "",
          r.check.ok ? "Verified ✔ — your browser's local data was left untouched." : `⚠ MISMATCH: ${r.check.problems.join("; ")}. Nothing local was changed; it is safe to run the import again.`,
        ].filter(Boolean),
      });
    } catch (e) {
      setDone({ ok: false, lines: [`Import failed: ${(e as Error).message}`, "Local data is untouched and this import can be run again safely (rows already saved are skipped)."] });
    } finally { setBusy(false); }
  }

  if (!legacy) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button onClick={open} className={cn(btn, "border-term-amber text-term-amber")} data-testid="import-local-open">Import my local journal into this account</button>
        {marker && <div className="sub-header normal-case tracking-normal font-normal text-term-muted" data-testid="import-local-marker">
          Already imported from this browser into account {marker.account}… on {new Date(marker.at).toLocaleString()} — running it again is safe.
        </div>}
      </div>
    );
  }

  const blocked = importBlockedReason();
  return (
    <div className="panel w-[500px] max-w-full" role="dialog" aria-label="Import my local journal" data-testid="import-local-dialog">
      <div className="panel-header"><span>IMPORT LOCAL JOURNAL → ACCOUNT</span></div>
      <div className="p-3 flex flex-col gap-2 text-[11px]">
        {legacy.problems.length > 0 ? (
          <div className="text-term-red" role="alert">The local data could not be read, so nothing can be imported: {legacy.problems.join(" ")} It was left untouched.</div>
        ) : pv && (
          <>
            <div className="text-term-text" data-testid="import-local-preview">
              Found in this browser: <b className="num">{pv.trades}</b> trades · net P&L <b className="num">{usd(pv.netPnl)}</b> USD ·{" "}
              {pv.from ? <>from <b className="num">{pv.from}</b> to <b className="num">{pv.to}</b></> : "no dates"} ·{" "}
              <b className="num">{pv.plans}</b> plans · <b className="num">{pv.setups}</b> setups{pv.baseCapital != null && <> · base capital <b className="num">{usd(pv.baseCapital)}</b></>}.
            </div>
            <div className="text-term-muted">
              Into <b className="text-term-text">{email}</b>: <b className="num">{pv.plan.batch.trades.length}</b> new trades,{" "}
              <b className="num">{pv.plan.skipped.trades}</b> already there (skipped); <b className="num">{pv.plan.batch.plans.length}</b> new plans.
              Running it twice never creates duplicates.
            </div>
            <div className="text-term-amber">This data lives in this browser and is not tied to any account. Import it only if it is yours.</div>
            {legacy.baseCapital != null && accountCapital == null && (
              <label className="flex items-center gap-2 text-term-text">
                <input type="checkbox" checked={copyCapital} onChange={(e) => setCopyCapital(e.target.checked)} />
                Also set this account's base capital to {usd(legacy.baseCapital)} (it has none yet)
              </label>
            )}
            <label className="flex items-center gap-2 text-term-text">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="import-local-confirm" />
              This is my data and it belongs to {email}
            </label>
            {blocked && <div className="text-term-red">{blocked}</div>}
          </>
        )}
        {done && (
          <div role={done.ok ? "status" : "alert"} className={cn("flex flex-col gap-0.5", done.ok ? "text-term-amber" : "text-term-red")} data-testid="import-local-result">
            {done.lines.map((l) => <div key={l}>{l}</div>)}
          </div>
        )}
        <div className="flex gap-1 flex-wrap">
          {legacy.problems.length === 0 && <button onClick={downloadLocalCopy} className={btn}>Download local backup first</button>}
          {legacy.problems.length === 0 && (
            <button onClick={() => void run()} disabled={!confirmed || busy || !!blocked} className={cn(btn, "border-term-amber text-term-amber")} data-testid="import-local-run">
              {busy ? "Importing…" : done ? "Run again (safe)" : "Import into account"}
            </button>
          )}
          <button onClick={close} className={btn}>Close</button>
        </div>
      </div>
    </div>
  );
}
