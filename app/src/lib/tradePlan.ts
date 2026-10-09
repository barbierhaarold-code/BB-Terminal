// ────────────────────────────────────────────────────────────
// Trade Plan — pure maths and validation (no React, no store, no I/O).
// A plan is a documented pre-trade intention that is later compared with what
// actually happened. Plans live in their OWN store (`bbterminal-trade-plans`)
// and point to a journal trade by id; a trade never points back, and nothing
// here ever writes to or reads a trade as anything but input.
// ────────────────────────────────────────────────────────────

import type { Direction, Trade } from "@/lib/journal";

export const PLAN_SCHEMA_VERSION = 1;

export const PLAN_STATUSES = ["draft", "active", "triggered", "invalidated", "closed", "cancelled"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export type Followed = "yes" | "partly" | "no";
export const FOLLOWED_VALUES: Followed[] = ["yes", "partly", "no"];

/** Frozen facts copied from Market Context and COT at one moment. Never a forecast. */
export interface ContextSnapshot {
  takenAt: string; // ISO
  symbol: string;
  market:
    | {
        available: true;
        instrumentId: string;
        backdrop: string;
        backdropName: string;
        composite: number | null;
        driverAgreement: number | null;
        /** date of the instrument's last daily bar used */
        asOf: string | null;
        drivers: { id: string; label: string; direction: string; score: number | null; weight: number }[];
        warnings: string[];
      }
    | { available: false; reason: string };
  cot:
    | {
        available: true;
        contractKey: string;
        contractName: string;
        groupLabel: string;
        /** Tuesday the positions are as of */
        positionsAsOf: string;
        net: number;
        changeNet: number | null;
        pct3y: number | null;
        pct5y: number | null;
        source: string;
      }
    | { available: false; reason: string };
  note: string;
}

export interface PlanReview {
  /** id of a journal trade (the plan points to the trade, never the reverse) */
  tradeId?: string;
  followed?: Followed;
  lesson: string;
}

export interface TradePlan {
  id: string;
  /** optional short label shown in the list */
  title?: string;
  symbol: string;
  direction: Direction;
  thesisMacro: string;
  thesisTechnical: string;
  /** id of a journal setup */
  setupId?: string;
  timeframe: string;
  entryLow?: number;
  entryHigh?: number;
  stop?: number;
  targets: number[];
  /** planned risk as % of the journal base capital */
  riskPct?: number;
  catalysts: string;
  /** self-rated 1..5, user input only */
  conviction?: number;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
  context?: ContextSnapshot;
  review: PlanReview;
}

// ── Helpers ─────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isIso = (v: unknown): v is string => typeof v === "string" && v.length > 0 && !Number.isNaN(Date.parse(v));

/** Reference entry used for the planned risk: midpoint of the zone, or the single price given. */
export function entryReference(p: Pick<TradePlan, "entryLow" | "entryHigh">): number | undefined {
  const { entryLow: lo, entryHigh: hi } = p;
  if (isNum(lo) && isNum(hi)) return (lo + hi) / 2;
  if (isNum(lo)) return lo;
  if (isNum(hi)) return hi;
  return undefined;
}

/** Planned risk in dollars = risk% × base capital. Undefined when either is missing/invalid. */
export function plannedRiskDollars(riskPct: number | undefined, baseCapital: number): number | undefined {
  if (!isNum(riskPct) || riskPct < 0 || !isNum(baseCapital) || baseCapital <= 0) return undefined;
  return (riskPct / 100) * baseCapital;
}

/** Plan-level sanity problems (stop on the wrong side, zone reversed…). Empty = fine. */
export function planProblems(p: TradePlan): string[] {
  const out: string[] = [];
  if (isNum(p.entryLow) && isNum(p.entryHigh) && p.entryLow > p.entryHigh) out.push("Entry zone low is above its high.");
  const ref = entryReference(p);
  if (isNum(p.stop) && ref != null) {
    if (p.stop === ref) out.push("Stop equals the entry reference.");
    else if (p.direction === "buy" && p.stop > ref) out.push("For a buy, the stop should be below the entry.");
    else if (p.direction === "sell" && p.stop < ref) out.push("For a sell, the stop should be above the entry.");
  }
  if (isNum(p.riskPct) && (p.riskPct <= 0 || p.riskPct > 100)) out.push("Planned risk % should be between 0 and 100.");
  return out;
}

// ── Realized R ──────────────────────────────────────────────

export type RealizedR =
  | { ok: true; r: number; plannedRiskPerUnit: number; moneyPerPoint: number; plannedRiskMoney: number }
  | { ok: false; reason: string };

const na = (reason: string): RealizedR => ({ ok: false, reason });

/** Shown on the page and in the ABOUT text next to every R figure. */
export const R_NOTE = "R is price-based: fees, swap and spread are not separated out.";

/**
 * Realized R = trade result ÷ initial risk in money, where the initial risk uses the linked trade's ACTUAL entry.
 *
 *  - risk per unit      = |trade entry price − plan stop|
 *  - money per point (per 1.0 of size) is NOT guessed from an instrument table: it is read off the linked
 *    trade itself as result ÷ (signed price move × size), because contract sizes differ per instrument.
 *  - initial risk money = risk per unit × trade size × money per point
 *
 * It is only computed when every input is valid; otherwise it returns `n/a (reason)` and never a number.
 * A trade with entry/exit price 0 (or any non-positive/non-finite input) therefore never yields an R.
 * Price-based: fees, swap and spread are not separated out (R_NOTE).
 */
export function computeRealizedR(plan: TradePlan, trade: Trade): RealizedR {
  if (!isNum(plan.stop)) return na("plan has no stop");
  if (!(plan.stop > 0)) return na("plan stop must be positive");

  if (trade.direction !== plan.direction) return na("plan and trade directions differ");
  if (!isNum(trade.size) || trade.size <= 0) return na("trade size is missing or not positive");
  if (!isNum(trade.entryPrice) || trade.entryPrice <= 0) return na("trade entry price is 0 or invalid");
  if (!isNum(trade.exitPrice) || trade.exitPrice <= 0) return na("trade exit price is 0 or invalid");
  if (!isNum(trade.result)) return na("trade result is missing");

  const perUnit = Math.abs(trade.entryPrice - plan.stop);
  if (!(perUnit > 0)) return na("plan stop equals the trade's entry");
  if (plan.direction === "buy" ? plan.stop > trade.entryPrice : plan.stop < trade.entryPrice) {
    return na(`plan stop is on the wrong side of the trade's entry for a ${plan.direction}`);
  }

  const move = (trade.exitPrice - trade.entryPrice) * (trade.direction === "buy" ? 1 : -1);
  if (move === 0) return na("trade entry equals exit, so money per point cannot be derived");
  const moneyPerPoint = trade.result / (move * trade.size);
  if (!(moneyPerPoint > 0)) return na("trade result and price move disagree in sign (fees or data error)");

  const plannedRiskMoney = perUnit * trade.size * moneyPerPoint;
  if (!(plannedRiskMoney > 0) || !Number.isFinite(plannedRiskMoney)) return na("initial risk in money is not computable");
  return { ok: true, r: trade.result / plannedRiskMoney, plannedRiskPerUnit: perUnit, moneyPerPoint, plannedRiskMoney };
}

/**
 * The plan's OWN reward-to-risk per target, from the entry-zone midpoint: |target − reference| ÷ |reference − stop|.
 * Targets on the wrong side of the entry, or a plan without a valid zone/stop, give null for that target.
 */
export function plannedRMultiples(plan: TradePlan): (number | null)[] {
  const ref = entryReference(plan);
  if (ref == null || !isNum(plan.stop) || !(ref > 0) || !(plan.stop > 0)) return plan.targets.map(() => null);
  const risk = Math.abs(ref - plan.stop);
  const stopOk = plan.direction === "buy" ? plan.stop < ref : plan.stop > ref;
  if (!(risk > 0) || !stopOk) return plan.targets.map(() => null);
  return plan.targets.map((t) => {
    const reward = (plan.direction === "buy" ? t - ref : ref - t);
    return Number.isFinite(reward) && reward > 0 ? reward / risk : null;
  });
}

// ── Adherence ───────────────────────────────────────────────

export const SMALL_SAMPLE_N = 30;

export interface AdherenceGroup {
  followed: Followed;
  /** reviewed plans in this group */
  n: number;
  /** of those, plans whose linked trade exists */
  linked: number;
  /** sum of linked trades' net result (USD) */
  net: number;
  /** plans in this group with a valid realized R */
  rCount: number;
  /** mean realized R over rCount plans, null when rCount is 0 */
  avgR: number | null;
}

export interface AdherenceStats {
  reviewed: number;
  counts: Record<Followed, number>;
  /** share of reviewed plans per answer, null when nothing reviewed */
  shares: Record<Followed, number> | null;
  groups: AdherenceGroup[];
  smallSample: boolean;
  note: string;
}

export function adherenceStats(plans: TradePlan[], trades: Trade[]): AdherenceStats {
  const byId = new Map(trades.map((t) => [t.id, t]));
  const reviewed = plans.filter((p) => p.review.followed != null);
  const counts: Record<Followed, number> = { yes: 0, partly: 0, no: 0 };
  const groups: AdherenceGroup[] = FOLLOWED_VALUES.map((f) => {
    const ps = reviewed.filter((p) => p.review.followed === f);
    counts[f] = ps.length;
    let linked = 0, net = 0;
    const rs: number[] = [];
    for (const p of ps) {
      const t = p.review.tradeId ? byId.get(p.review.tradeId) : undefined;
      if (!t) continue;
      linked++;
      net += t.result;
      const r = computeRealizedR(p, t);
      if (r.ok) rs.push(r.r);
    }
    return { followed: f, n: ps.length, linked, net, rCount: rs.length, avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null };
  });
  const n = reviewed.length;
  const shares = n ? { yes: counts.yes / n, partly: counts.partly / n, no: counts.no / n } : null;
  const smallSample = n < SMALL_SAMPLE_N;
  const note = n === 0
    ? "No reviewed plans yet."
    : smallSample
      ? `Small sample (n = ${n} reviewed plans, fewer than ${SMALL_SAMPLE_N}): these figures are descriptive only and can change a lot with a few more plans.`
      : `n = ${n} reviewed plans. Descriptive figures, not a conclusion.`;
  return { reviewed: n, counts, shares, groups, smallSample, note };
}

export function statusCounts(plans: TradePlan[]): Record<PlanStatus, number> {
  const c = Object.fromEntries(PLAN_STATUSES.map((s) => [s, 0])) as Record<PlanStatus, number>;
  for (const p of plans) c[p.status] = (c[p.status] ?? 0) + 1;
  return c;
}

// ── Symbol → Market Context instrument ──────────────────────

/** "XAU/USD", "xauusd", "EUR-USD" → "XAUUSD"; the caller matches it against its instrument list. */
export function normalizeSymbol(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// ── Validation (storage + backup) ───────────────────────────

function optNum(v: unknown): number | undefined { return isNum(v) ? v : undefined; }
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Strict validation of one plan from untrusted JSON. Unknown extra fields are kept (forward-compat). */
export function validatePlan(raw: unknown, i = 0): { plan?: TradePlan; error?: string } {
  const at = `plan #${i + 1}`;
  if (!isObj(raw)) return { error: `${at} is not an object` };
  if (typeof raw.id !== "string" || !raw.id) return { error: `${at}: missing "id"` };
  if (typeof raw.symbol !== "string" || !raw.symbol.trim()) return { error: `${at}: missing "symbol"` };
  if (raw.direction !== "buy" && raw.direction !== "sell") return { error: `${at}: "direction" must be "buy" or "sell"` };
  if (!PLAN_STATUSES.includes(raw.status as PlanStatus)) return { error: `${at}: unknown "status"` };
  if (!isIso(raw.createdAt)) return { error: `${at}: "createdAt" is not a valid date` };
  if (!isIso(raw.updatedAt)) return { error: `${at}: "updatedAt" is not a valid date` };
  if (!Array.isArray(raw.targets) || !raw.targets.every(isNum)) return { error: `${at}: "targets" must be an array of numbers` };
  for (const k of ["entryLow", "entryHigh", "stop", "riskPct", "conviction"] as const) {
    if (raw[k] !== undefined && !isNum(raw[k])) return { error: `${at}: "${k}" must be a number` };
  }
  const rv = raw.review;
  if (rv !== undefined && !isObj(rv)) return { error: `${at}: "review" must be an object` };
  const review = (rv ?? {}) as Record<string, unknown>;
  if (review.followed !== undefined && !FOLLOWED_VALUES.includes(review.followed as Followed)) return { error: `${at}: review.followed must be yes/partly/no` };
  if (review.tradeId !== undefined && typeof review.tradeId !== "string") return { error: `${at}: review.tradeId must be a string` };
  const plan: TradePlan = {
    ...(raw as object),
    id: raw.id,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : undefined,
    symbol: raw.symbol.trim(),
    direction: raw.direction,
    thesisMacro: str(raw.thesisMacro),
    thesisTechnical: str(raw.thesisTechnical),
    setupId: typeof raw.setupId === "string" && raw.setupId ? raw.setupId : undefined,
    timeframe: str(raw.timeframe),
    entryLow: optNum(raw.entryLow),
    entryHigh: optNum(raw.entryHigh),
    stop: optNum(raw.stop),
    targets: raw.targets as number[],
    riskPct: optNum(raw.riskPct),
    catalysts: str(raw.catalysts),
    conviction: optNum(raw.conviction),
    status: raw.status as PlanStatus,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    context: isObj(raw.context) ? (raw.context as unknown as ContextSnapshot) : undefined,
    review: {
      tradeId: review.tradeId as string | undefined,
      followed: review.followed as Followed | undefined,
      lesson: str(review.lesson),
    },
  };
  return { plan };
}

/** Persisted/exported container. `schemaVersion` lets later versions migrate without touching trades. */
export interface PlansBlob { schemaVersion: number; plans: TradePlan[] }

export type ParsePlans = { ok: true; blob: PlansBlob } | { ok: false; error: string };

export function parsePlansBlob(raw: unknown): ParsePlans {
  if (!isObj(raw)) return { ok: false, error: 'Malformed "tradePlans": expected an object.' };
  if (!isNum(raw.schemaVersion) || raw.schemaVersion < 1) return { ok: false, error: 'Malformed "tradePlans": missing schemaVersion.' };
  if (raw.schemaVersion > PLAN_SCHEMA_VERSION) {
    return { ok: false, error: `Trade plans use schema ${raw.schemaVersion}; this app reads up to ${PLAN_SCHEMA_VERSION}.` };
  }
  if (!Array.isArray(raw.plans)) return { ok: false, error: 'Malformed "tradePlans": "plans" must be an array.' };
  const plans: TradePlan[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.plans.length; i++) {
    const r = validatePlan(raw.plans[i], i);
    if (r.error) return { ok: false, error: `Malformed "tradePlans": ${r.error}.` };
    if (seen.has(r.plan!.id)) return { ok: false, error: `Malformed "tradePlans": duplicate plan id "${r.plan!.id}".` };
    seen.add(r.plan!.id);
    plans.push(r.plan!);
  }
  return { ok: true, blob: { schemaVersion: raw.schemaVersion, plans } };
}

/** Merge: add plans whose id is not already present; NEVER removes or edits an existing plan. */
export function mergePlans(current: TradePlan[], incoming: TradePlan[], setupRemap?: Map<string, string>): { plans: TradePlan[]; added: number; skipped: number } {
  const ids = new Set(current.map((p) => p.id));
  const added: TradePlan[] = [];
  let skipped = 0;
  for (const p of incoming) {
    if (ids.has(p.id)) { skipped++; continue; }
    added.push(p.setupId && setupRemap?.has(p.setupId) ? { ...p, setupId: setupRemap.get(p.setupId) } : p);
  }
  return { plans: [...current, ...added], added: added.length, skipped };
}
