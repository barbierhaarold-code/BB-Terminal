// ────────────────────────────────────────────────────────────
// Pure mapping between the app's objects and the database rows
// (supabase/migrations/…_user_data_foundation.sql). No I/O, no React.
//
// Contract: rowToX(xToRow(x)) deep-equals x. Client-origin timestamps are kept
// as the exact strings the app wrote (text columns); optional fields map
// undefined ⇄ null; fields this version does not know are kept in `extra`.
// Rows built here never carry user_id (the DB defaults it to auth.uid()), seq
// or row_* bookkeeping columns.
// ────────────────────────────────────────────────────────────

import type { Setup, Trade } from "@/lib/journal";
import { PLAN_SCHEMA_VERSION, type ContextSnapshot, type TradePlan } from "@/lib/tradePlan";

export const TRADE_SCHEMA_VERSION = 1;
export const SETUP_SCHEMA_VERSION = 1;
export const SETTINGS_SCHEMA_VERSION = 1;

export interface TradeRow {
  id: string; symbol: string; direction: string; size: number; entry_price: number; exit_price: number; result: number;
  entry_at: string; exit_at: string | null; setup_id: string | null;
  macro_bias: string | null; conviction: string | null; news_event: string | null; feeling: string | null; notes: string | null;
  source: string; created_at: string; extra: Record<string, unknown>; schema_version: number;
}

export interface PlanRow {
  id: string; title: string | null; symbol: string; direction: string; thesis_macro: string; thesis_technical: string;
  setup_id: string | null; timeframe: string; entry_low: number | null; entry_high: number | null; stop: number | null;
  targets: number[]; risk_pct: number | null; catalysts: string; conviction: number | null; status: string;
  created_at: string; updated_at: string; context: ContextSnapshot | null;
  review_trade_id: string | null; review_followed: string | null; review_lesson: string;
  extra: Record<string, unknown>; schema_version: number;
}

export interface SetupRow { id: string; name: string; schema_version: number }
export interface SettingsRow { base_capital: number | null; schema_version: number }

const nul = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);
const und = <T,>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v);

function pickExtra(o: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const k of Object.keys(o)) if (!known.includes(k) && o[k] !== undefined) extra[k] = o[k];
  return extra;
}

const TRADE_KEYS = ["id", "symbol", "direction", "size", "entryPrice", "exitPrice", "result", "entryAt", "exitAt", "setupId",
  "macroBias", "conviction", "newsEvent", "feeling", "notes", "source", "createdAt"] as const;

export function tradeToRow(t: Trade): TradeRow {
  return {
    id: t.id, symbol: t.symbol, direction: t.direction, size: t.size, entry_price: t.entryPrice, exit_price: t.exitPrice,
    result: t.result, entry_at: t.entryAt, exit_at: nul(t.exitAt), setup_id: nul(t.setupId),
    macro_bias: nul(t.macroBias), conviction: nul(t.conviction), news_event: nul(t.newsEvent), feeling: nul(t.feeling), notes: nul(t.notes),
    source: t.source, created_at: t.createdAt,
    extra: pickExtra(t as unknown as Record<string, unknown>, TRADE_KEYS), schema_version: TRADE_SCHEMA_VERSION,
  };
}

export function rowToTrade(r: TradeRow): Trade {
  const t: Record<string, unknown> = {
    id: r.id, symbol: r.symbol, direction: r.direction, size: r.size, entryPrice: r.entry_price, exitPrice: r.exit_price,
    result: r.result, entryAt: r.entry_at,
  };
  const opt: [string, unknown][] = [["exitAt", und(r.exit_at)], ["setupId", und(r.setup_id)], ["macroBias", und(r.macro_bias)],
    ["conviction", und(r.conviction)], ["newsEvent", und(r.news_event)], ["feeling", und(r.feeling)], ["notes", und(r.notes)]];
  for (const [k, v] of opt) if (v !== undefined) t[k] = v;
  t.source = r.source;
  t.createdAt = r.created_at;
  return { ...(r.extra ?? {}), ...t } as unknown as Trade;
}

const PLAN_KEYS = ["id", "title", "symbol", "direction", "thesisMacro", "thesisTechnical", "setupId", "timeframe", "entryLow", "entryHigh",
  "stop", "targets", "riskPct", "catalysts", "conviction", "status", "createdAt", "updatedAt", "context", "review"] as const;

export function planToRow(p: TradePlan): PlanRow {
  return {
    id: p.id, title: nul(p.title), symbol: p.symbol, direction: p.direction, thesis_macro: p.thesisMacro ?? "",
    thesis_technical: p.thesisTechnical ?? "", setup_id: nul(p.setupId), timeframe: p.timeframe ?? "",
    entry_low: nul(p.entryLow), entry_high: nul(p.entryHigh), stop: nul(p.stop), targets: p.targets ?? [],
    risk_pct: nul(p.riskPct), catalysts: p.catalysts ?? "", conviction: nul(p.conviction), status: p.status,
    created_at: p.createdAt, updated_at: p.updatedAt, context: nul(p.context),
    review_trade_id: nul(p.review?.tradeId), review_followed: nul(p.review?.followed), review_lesson: p.review?.lesson ?? "",
    extra: pickExtra(p as unknown as Record<string, unknown>, PLAN_KEYS), schema_version: PLAN_SCHEMA_VERSION,
  };
}

export function rowToPlan(r: PlanRow): TradePlan {
  const p: Record<string, unknown> = { id: r.id };
  if (r.title !== null && r.title !== undefined) p.title = r.title;
  p.symbol = r.symbol; p.direction = r.direction; p.thesisMacro = r.thesis_macro; p.thesisTechnical = r.thesis_technical;
  if (r.setup_id != null) p.setupId = r.setup_id;
  p.timeframe = r.timeframe;
  if (r.entry_low != null) p.entryLow = r.entry_low;
  if (r.entry_high != null) p.entryHigh = r.entry_high;
  if (r.stop != null) p.stop = r.stop;
  p.targets = r.targets ?? [];
  if (r.risk_pct != null) p.riskPct = r.risk_pct;
  p.catalysts = r.catalysts;
  if (r.conviction != null) p.conviction = r.conviction;
  p.status = r.status; p.createdAt = r.created_at; p.updatedAt = r.updated_at;
  if (r.context != null) p.context = r.context;
  const review: Record<string, unknown> = {};
  if (r.review_trade_id != null) review.tradeId = r.review_trade_id;
  if (r.review_followed != null) review.followed = r.review_followed;
  review.lesson = r.review_lesson;
  p.review = review;
  return { ...(r.extra ?? {}), ...p } as unknown as TradePlan;
}

export const setupToRow = (s: Setup): SetupRow => ({ id: s.id, name: s.name, schema_version: SETUP_SCHEMA_VERSION });
export const rowToSetup = (r: SetupRow): Setup => ({ id: r.id, name: r.name });

/** Patch → partial row, for UPDATE. Only keys present in the patch are sent. */
export function tradePatchToRow(patch: Partial<Trade>): Partial<TradeRow> {
  const full = tradeToRow({ id: "", symbol: "", direction: "buy", size: 0, entryPrice: 0, exitPrice: 0, result: 0, entryAt: "", source: "manual", createdAt: "", ...patch } as Trade);
  const out: Record<string, unknown> = {};
  const map: Record<string, keyof TradeRow> = { symbol: "symbol", direction: "direction", size: "size", entryPrice: "entry_price",
    exitPrice: "exit_price", result: "result", entryAt: "entry_at", exitAt: "exit_at", setupId: "setup_id", macroBias: "macro_bias",
    conviction: "conviction", newsEvent: "news_event", feeling: "feeling", notes: "notes", source: "source", createdAt: "created_at" };
  for (const k of Object.keys(patch)) {
    if (map[k]) out[map[k]] = full[map[k]];
  }
  return out as Partial<TradeRow>;
}
