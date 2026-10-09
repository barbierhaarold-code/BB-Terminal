// Reading the pre-existing browser-local journal/plans — READ-ONLY.
// This file only ever calls localStorage.getItem on the two legacy keys. It never
// writes, removes or "migrates" them, and nothing here runs unless the user opens
// "Import my local journal into this account". The only key it may write is its own
// small marker (below), never one of the legacy keys.
import { computeStats, type Setup, type Trade } from "@/lib/journal";
import type { TradePlan } from "@/lib/tradePlan";
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, parseBackup } from "@/lib/journalBackup";
import { planImport, type ImportPlan } from "./importPlan";

export const LEGACY_JOURNAL_KEY = "bbterminal-journal";
export const LEGACY_PLANS_KEY = "bbterminal-trade-plans";
/** Our own marker (not a legacy key): remembers that an import happened, so the dialog can say so. */
export const IMPORT_MARKER_KEY = "bbterminal-local-import-v1";

export interface LegacyLocal {
  /** at least one trade, plan or setup exists locally */
  present: boolean;
  trades: Trade[];
  setups: Setup[];
  plans: TradePlan[];
  baseCapital: number | null;
  pricesHidden: boolean;
  /** why (part of) the local data could not be read; the import is refused when non-empty */
  problems: string[];
}

const EMPTY: LegacyLocal = { present: false, trades: [], setups: [], plans: [], baseCapital: null, pricesHidden: false, problems: [] };

function readKey(key: string): { raw: string | null; error?: string } {
  try { return { raw: localStorage.getItem(key) }; }
  catch (e) { return { raw: null, error: `Could not read "${key}": ${(e as Error).message}` }; }
}

export function readLegacyLocal(): LegacyLocal {
  const problems: string[] = [];
  const j = readKey(LEGACY_JOURNAL_KEY);
  const p = readKey(LEGACY_PLANS_KEY);
  if (j.error) problems.push(j.error);
  if (p.error) problems.push(p.error);

  let journalState: Record<string, unknown> = {};
  if (j.raw != null) {
    try { journalState = (JSON.parse(j.raw) as { state?: Record<string, unknown> }).state ?? {}; }
    catch (e) { problems.push(`The local journal is not valid JSON (${(e as Error).message}).`); }
  }
  let planList: unknown[] = [];
  if (p.raw != null) {
    try { planList = ((JSON.parse(p.raw) as { state?: { plans?: unknown[] } }).state?.plans) ?? []; }
    catch (e) { problems.push(`The local trade plans are not valid JSON (${(e as Error).message}).`); }
  }
  if (problems.length) return { ...EMPTY, problems };

  const trades = Array.isArray(journalState.trades) ? journalState.trades : [];
  const setups = Array.isArray(journalState.setups) ? journalState.setups : [];
  if (trades.length === 0 && setups.length === 0 && planList.length === 0) return EMPTY;

  // Validate with the same strict parser the JSON import uses (header is synthesised from the data itself).
  const cap = typeof journalState.baseCapital === "number" && journalState.baseCapital > 0 ? journalState.baseCapital : null;
  const text = JSON.stringify({
    header: { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt: "", appVersion: "", tradeCount: trades.length, totalNetPnl: 0 },
    data: { trades, setups, baseCapital: cap, pricesHidden: journalState.pricesHidden === true, tradePlans: { schemaVersion: 1, plans: planList } },
  });
  const res = parseBackup(text);
  if (!res.ok) return { ...EMPTY, problems: [res.error] };
  const d = res.backup.data;
  return { present: true, trades: d.trades, setups: d.setups, plans: d.tradePlans?.plans ?? [], baseCapital: d.baseCapital, pricesHidden: d.pricesHidden, problems: [] };
}

export interface LegacyPreview {
  trades: number; plans: number; setups: number;
  netPnl: number;
  /** YYYY-MM-DD of the first and last trade, null when there are no trades */
  from: string | null; to: string | null;
  baseCapital: number | null;
  plan: ImportPlan;
}

/** Everything the confirmation dialog shows. Pure; writes nothing. */
export function previewLegacy(l: LegacyLocal, account: { trades: Trade[]; setups: Setup[]; plans: TradePlan[] }): LegacyPreview {
  const days = l.trades.map((t) => t.entryAt.slice(0, 10)).sort();
  return {
    trades: l.trades.length, plans: l.plans.length, setups: l.setups.length,
    netPnl: computeStats(l.trades, null).netProfit,
    from: days[0] ?? null, to: days[days.length - 1] ?? null,
    baseCapital: l.baseCapital,
    plan: planImport(account, { setups: l.setups, trades: l.trades, plans: l.plans }),
  };
}

export const legacyToBatch = (l: LegacyLocal) => ({ setups: l.setups, trades: l.trades, plans: l.plans });

export interface ImportMarker { account: string; at: string; trades: number; plans: number }

export function readImportMarker(): ImportMarker | null {
  try { return JSON.parse(localStorage.getItem(IMPORT_MARKER_KEY) ?? "null") as ImportMarker | null; } catch { return null; }
}
export function writeImportMarker(m: ImportMarker): void {
  try { localStorage.setItem(IMPORT_MARKER_KEY, JSON.stringify(m)); } catch { /* informational only */ }
}
