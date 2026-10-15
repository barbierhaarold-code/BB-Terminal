// Pure planning for "bring these trades/plans/setups into this account" and the
// runner that executes it through the adapter. Used by BOTH the explicit
// "Import my local journal" action and Backup → Import JSON (Merge) in server
// mode, so there is exactly one import path.

import { computeStats, type Setup, type Trade } from "@/lib/journal";
import type { TradePlan } from "@/lib/tradePlan";
import type { ImportBatch, UserDataAdapter, UserDataSnapshot } from "./adapter";

/** Two trades are the same fill if everything that identifies it matches. */
export function tradeSignature(t: Trade): string {
  return [t.symbol, t.direction, t.size, t.entryPrice, t.exitPrice, t.result, t.entryAt].join("|");
}

export interface ImportPlan {
  batch: ImportBatch;
  /** incoming rows that already exist in the account (by id, or by fill signature for trades) */
  skipped: { trades: number; plans: number; setups: number };
  incoming: { trades: number; plans: number; setups: number };
}

/** What would be written, without writing anything. Imported trades are compared only with the pre-existing ones. */
export function planImport(existing: Pick<UserDataSnapshot, "trades" | "setups" | "plans">, incoming: ImportBatch): ImportPlan {
  const setups: Setup[] = [...existing.setups];
  const remap = new Map<string, string>();
  const setupsToAdd: Setup[] = [];
  for (const s of incoming.setups) {
    const match = setups.find((x) => x.id === s.id) ?? setups.find((x) => x.name.toLowerCase() === s.name.trim().toLowerCase());
    if (match) remap.set(s.id, match.id);
    else { setups.push(s); setupsToAdd.push(s); remap.set(s.id, s.id); }
  }
  const mapSetup = <T extends { setupId?: string }>(x: T): T => (x.setupId && remap.has(x.setupId) ? { ...x, setupId: remap.get(x.setupId) } : x);

  const ids = new Set(existing.trades.map((t) => t.id));
  const sigs = new Set(existing.trades.map(tradeSignature));
  const trades: Trade[] = [];
  for (const t of incoming.trades) if (!ids.has(t.id) && !sigs.has(tradeSignature(t))) trades.push(mapSetup(t));

  const planIds = new Set(existing.plans.map((p) => p.id));
  const plans: TradePlan[] = [];
  for (const p of incoming.plans) if (!planIds.has(p.id)) plans.push(mapSetup(p));

  return {
    batch: { setups: setupsToAdd, trades, plans },
    skipped: {
      trades: incoming.trades.length - trades.length,
      plans: incoming.plans.length - plans.length,
      setups: incoming.setups.length - setupsToAdd.length,
    },
    incoming: { trades: incoming.trades.length, plans: incoming.plans.length, setups: incoming.setups.length },
  };
}

export interface ImportReport {
  plan: ImportPlan;
  inserted: { setups: number; trades: number; plans: number };
  baseCapital: { action: "set" | "kept-existing" | "not-requested"; value: number | null };
  /** re-read of the account after writing, compared with what was expected */
  check: {
    ok: boolean;
    expectedTrades: number; actualTrades: number;
    expectedNet: number; actualNet: number;
    expectedPlans: number; actualPlans: number;
    problems: string[];
  };
  after: UserDataSnapshot;
}

const net = (ts: Trade[]) => computeStats(ts, null).netProfit;

/**
 * Execute an import and then RE-CHECK the account: re-read everything and
 * compare trade count, net P&L and plan count with what the account held plus
 * what was added. Running it twice adds 0 rows (primary key + signature).
 * `baseCapital` is only written when the account has none (never overwrites).
 */
export async function runImport(
  adapter: UserDataAdapter,
  incoming: ImportBatch,
  opts: { copyBaseCapital?: number | null } = {},
): Promise<ImportReport> {
  const before = await adapter.loadAll();
  const plan = planImport(before, incoming);
  const inserted = await adapter.importMissing(plan.batch);

  let baseCapital: ImportReport["baseCapital"] = { action: "not-requested", value: before.baseCapital };
  if (opts.copyBaseCapital != null && opts.copyBaseCapital > 0) {
    if (before.baseCapital == null) {
      await adapter.saveBaseCapital(opts.copyBaseCapital);
      baseCapital = { action: "set", value: opts.copyBaseCapital };
    } else baseCapital = { action: "kept-existing", value: before.baseCapital };
  }

  const after = await adapter.loadAll();
  const expectedTrades = before.trades.length + plan.batch.trades.length;
  const expectedNet = net(before.trades) + net(plan.batch.trades);
  const expectedPlans = before.plans.length + plan.batch.plans.length;
  const actualNet = net(after.trades);
  const problems: string[] = [];
  if (after.trades.length !== expectedTrades) problems.push(`trade count is ${after.trades.length}, expected ${expectedTrades}`);
  if (Math.abs(actualNet - expectedNet) > 0.005) problems.push(`net P&L is ${actualNet.toFixed(2)}, expected ${expectedNet.toFixed(2)}`);
  if (after.plans.length !== expectedPlans) problems.push(`plan count is ${after.plans.length}, expected ${expectedPlans}`);
  if (inserted.trades !== plan.batch.trades.length) problems.push(`server inserted ${inserted.trades} trades, ${plan.batch.trades.length} were planned`);
  return {
    plan, inserted, baseCapital, after,
    check: { ok: problems.length === 0, expectedTrades, actualTrades: after.trades.length, expectedNet, actualNet,
      expectedPlans, actualPlans: after.plans.length, problems },
  };
}
