// ────────────────────────────────────────────────────────────
// Track Record — JSON backup (export / import). Pure logic, no React.
// The file is a snapshot of the `bbterminal-journal` store: every trade with
// every field, setups, base capital and the privacy toggle, plus a small
// header (export date, app version, trade count, total net P&L) so a backup
// can be sanity-checked at a glance. Import validates strictly and reports
// the first problems found instead of loading a half-valid file.
// ────────────────────────────────────────────────────────────

import { computeStats, type Setup, type Trade } from "@/lib/journal";
import { useJournal } from "@/store/journalStore";
import { useTradePlans } from "@/store/tradePlanStore";
import { PLAN_SCHEMA_VERSION, mergePlans, parsePlansBlob, type PlansBlob } from "@/lib/tradePlan";
import pkg from "../../package.json";

export const BACKUP_FORMAT = "abdel-khader-track-record";
/** 2 = adds the optional `data.tradePlans` key. Files with formatVersion 1 (no plans) are still read exactly as before. */
export const BACKUP_FORMAT_VERSION = 2;

export interface BackupHeader {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: string;
  appVersion: string;
  tradeCount: number;
  totalNetPnl: number;
  /** v2+, informational */
  planCount?: number;
}

export interface BackupData {
  trades: Trade[];
  setups: Setup[];
  baseCapital: number;
  pricesHidden: boolean;
  /** Optional (v2+). Absent in old files, in which case import leaves the user's plans alone. */
  tradePlans?: PlansBlob;
}

export interface BackupFile { header: BackupHeader; data: BackupData }

export function backupFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `track-record-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

export function buildBackup(): BackupFile {
  const { trades, setups, baseCapital, pricesHidden } = useJournal.getState();
  const plans = useTradePlans.getState().plans;
  return {
    header: {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      appVersion: pkg.version,
      tradeCount: trades.length,
      totalNetPnl: computeStats(trades, baseCapital).netProfit,
      planCount: plans.length,
    },
    data: { trades, setups, baseCapital, pricesHidden, tradePlans: { schemaVersion: PLAN_SCHEMA_VERSION, plans } },
  };
}

export function downloadBackup(): { fileName: string; tradeCount: number } {
  const backup = buildBackup();
  const fileName = backupFileName();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { fileName, tradeCount: backup.header.tradeCount };
}

// ── Validation ──────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isIso = (v: unknown): v is string => typeof v === "string" && v.length > 0 && !Number.isNaN(Date.parse(v));
const OPT_STR = ["setupId", "macroBias", "conviction", "newsEvent", "feeling", "notes"] as const;

function validateTrade(raw: unknown, i: number): { trade?: Trade; error?: string } {
  const at = `trade #${i + 1}`;
  if (!isObj(raw)) return { error: `${at} is not an object` };
  if (typeof raw.id !== "string" || !raw.id) return { error: `${at}: missing "id"` };
  if (typeof raw.symbol !== "string" || !raw.symbol) return { error: `${at}: missing "symbol"` };
  if (raw.direction !== "buy" && raw.direction !== "sell") return { error: `${at}: "direction" must be "buy" or "sell"` };
  for (const k of ["size", "entryPrice", "exitPrice", "result"] as const) {
    if (!isNum(raw[k])) return { error: `${at}: "${k}" must be a finite number` };
  }
  if (!isIso(raw.entryAt)) return { error: `${at}: "entryAt" is not a valid date` };
  if (raw.exitAt !== undefined && !isIso(raw.exitAt)) return { error: `${at}: "exitAt" is not a valid date` };
  if (raw.source !== "manual" && raw.source !== "import") return { error: `${at}: "source" must be "manual" or "import"` };
  if (!isIso(raw.createdAt)) return { error: `${at}: "createdAt" is not a valid date` };
  for (const k of OPT_STR) {
    if (raw[k] !== undefined && typeof raw[k] !== "string") return { error: `${at}: "${k}" must be a string` };
  }
  // Keep every field present in the file (incl. any added by future versions).
  return { trade: raw as unknown as Trade };
}

export type ParseResult = { ok: true; backup: BackupFile; warnings: string[] } | { ok: false; error: string };

export function parseBackup(text: string): ParseResult {
  let json: unknown;
  try { json = JSON.parse(text); }
  catch (e) { return { ok: false, error: `Not valid JSON (${(e as Error).message}).` }; }

  if (!isObj(json) || !isObj(json.header) || !isObj(json.data)) {
    return { ok: false, error: 'Not a Track Record backup: expected top-level "header" and "data" objects.' };
  }
  const h = json.header;
  if (h.format !== BACKUP_FORMAT) return { ok: false, error: `Not a Track Record backup (format is "${String(h.format)}").` };
  if (!isNum(h.formatVersion) || h.formatVersion < 1 || h.formatVersion > BACKUP_FORMAT_VERSION) {
    return { ok: false, error: `Unsupported backup version (${String(h.formatVersion)}); this app reads version ${BACKUP_FORMAT_VERSION}.` };
  }
  const d = json.data;
  if (!Array.isArray(d.trades)) return { ok: false, error: 'Malformed backup: "data.trades" must be an array.' };
  if (!Array.isArray(d.setups)) return { ok: false, error: 'Malformed backup: "data.setups" must be an array.' };
  if (!isNum(d.baseCapital) || d.baseCapital <= 0) return { ok: false, error: 'Malformed backup: "data.baseCapital" must be a positive number.' };
  if (typeof d.pricesHidden !== "boolean") return { ok: false, error: 'Malformed backup: "data.pricesHidden" must be true/false.' };

  const setups: Setup[] = [];
  for (let i = 0; i < d.setups.length; i++) {
    const s = d.setups[i];
    if (!isObj(s) || typeof s.id !== "string" || !s.id || typeof s.name !== "string" || !s.name.trim()) {
      return { ok: false, error: `Malformed backup: setup #${i + 1} needs a string "id" and "name".` };
    }
    setups.push({ id: s.id, name: s.name });
  }

  const trades: Trade[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < d.trades.length; i++) {
    const r = validateTrade(d.trades[i], i);
    if (r.error) return { ok: false, error: `Malformed backup: ${r.error}.` };
    if (seen.has(r.trade!.id)) return { ok: false, error: `Malformed backup: duplicate trade id "${r.trade!.id}".` };
    seen.add(r.trade!.id);
    trades.push(r.trade!);
  }

  let tradePlans: PlansBlob | undefined;
  if (d.tradePlans !== undefined) {
    const pr = parsePlansBlob(d.tradePlans);
    if (!pr.ok) return { ok: false, error: pr.error };
    tradePlans = pr.blob;
  }

  const warnings: string[] = [];
  if (h.tradeCount !== trades.length) {
    warnings.push(`Header says ${String(h.tradeCount)} trades but the file contains ${trades.length}.`);
  }
  const net = computeStats(trades, d.baseCapital as number).netProfit;
  if (!isNum(h.totalNetPnl) || Math.abs(h.totalNetPnl - net) > 0.005) {
    warnings.push(`Header net P&L (${String(h.totalNetPnl)}) does not match the trades (${net.toFixed(2)}).`);
  }

  return {
    ok: true,
    warnings,
    backup: {
      header: {
        format: BACKUP_FORMAT,
        formatVersion: h.formatVersion,
        exportedAt: String(h.exportedAt ?? ""),
        appVersion: String(h.appVersion ?? ""),
        tradeCount: trades.length,
        totalNetPnl: net,
      },
      data: { trades, setups, baseCapital: d.baseCapital as number, pricesHidden: d.pricesHidden, ...(tradePlans ? { tradePlans } : {}) },
    },
  };
}

// ── Apply ───────────────────────────────────────────────────

/** Two trades are the same fill if everything that identifies it matches —
 * used alongside the id check so a re-imported backup is recognised even if
 * the ids were regenerated (e.g. by a bulk re-paste). */
function signature(t: Trade): string {
  return [t.symbol, t.direction, t.size, t.entryPrice, t.exitPrice, t.result, t.entryAt].join("|");
}

export interface ApplyResult {
  mode: "replace" | "merge"; before: number; after: number; added: number; skipped: number;
  /** undefined when the file carried no plans (the user's plans were left untouched) */
  plans?: { before: number; after: number; added: number; skipped: number };
}

/** Replace: the journal store becomes exactly the file's content. Plans are replaced ONLY if the file contains
 * a `tradePlans` key; a v1 file (no plans) leaves the user's plans untouched. */
export function applyReplace(b: BackupFile): ApplyResult {
  const before = useJournal.getState().trades.length;
  useJournal.setState({
    trades: b.data.trades,
    setups: b.data.setups,
    baseCapital: b.data.baseCapital,
    pricesHidden: b.data.pricesHidden,
  });
  const after = useJournal.getState().trades.length;
  let plans: ApplyResult["plans"];
  if (b.data.tradePlans) {
    const pb = useTradePlans.getState().plans.length;
    useTradePlans.setState({ plans: b.data.tradePlans.plans, loadError: null });
    plans = { before: pb, after: b.data.tradePlans.plans.length, added: b.data.tradePlans.plans.length, skipped: 0 };
  }
  return { mode: "replace", before, after, added: after, skipped: 0, plans };
}

/** Merge: adds trades not already present (same id or same fill signature)
 * *before the import*. Imported trades are compared only against the
 * pre-existing ones, never against each other, so identical fills inside the
 * file (e.g. two partial closes at the same price) are all kept.
 * Existing trades, base capital and settings are left untouched. Imported
 * setups are matched to existing ones by id, then by name; unmatched ones are
 * added, and trade setupIds are remapped accordingly. Plans (if the file has any) are merged by id, with
 * the same setup remap; existing plans are never removed or edited, and a file without plans changes nothing. */
export function applyMerge(b: BackupFile): ApplyResult {
  const cur = useJournal.getState();
  const ids = new Set(cur.trades.map((t) => t.id));
  const sigs = new Set(cur.trades.map(signature));

  const setups = [...cur.setups];
  const remap = new Map<string, string>();
  for (const s of b.data.setups) {
    const match = setups.find((x) => x.id === s.id) ?? setups.find((x) => x.name.toLowerCase() === s.name.trim().toLowerCase());
    if (match) remap.set(s.id, match.id);
    else { setups.push(s); remap.set(s.id, s.id); }
  }

  const added: Trade[] = [];
  let skipped = 0;
  for (const t of b.data.trades) {
    if (ids.has(t.id) || sigs.has(signature(t))) { skipped++; continue; }
    added.push(t.setupId && remap.has(t.setupId) ? { ...t, setupId: remap.get(t.setupId) } : t);
  }

  useJournal.setState({ trades: [...cur.trades, ...added], setups });

  let plans: ApplyResult["plans"];
  if (b.data.tradePlans) {
    const curPlans = useTradePlans.getState().plans;
    const m = mergePlans(curPlans, b.data.tradePlans.plans, remap);
    useTradePlans.setState({ plans: m.plans });
    plans = { before: curPlans.length, after: m.plans.length, added: m.added, skipped: m.skipped };
  }
  return { mode: "merge", before: cur.trades.length, after: cur.trades.length + added.length, added: added.length, skipped, plans };
}
