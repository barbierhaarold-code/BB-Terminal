// In-memory UserDataAdapter that behaves like the real table under RLS for ONE
// user: primary key on id, "0 rows affected" is an error, ignore-duplicates
// import. Used by tests (and nothing else) to prove store/import behaviour
// without a network. Records every call so tests can assert server writes.

import type { Setup, Trade } from "@/lib/journal";
import type { TradePlan } from "@/lib/tradePlan";
import type { ImportBatch, ImportCounts, UserDataAdapter, UserDataSnapshot } from "./adapter";
import { planToRow, rowToPlan, rowToTrade, tradePatchToRow, tradeToRow } from "./mapping";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class MemoryAdapter implements UserDataAdapter {
  trades: Trade[] = [];
  setups: Setup[] = [];
  plans: TradePlan[] = [];
  baseCapital: number | null = null;
  calls: { op: string; args: unknown[] }[] = [];
  /** op names that should reject once (set to test rollback/retry) */
  failNext = new Set<string>();
  /** when set, every call rejects with this (offline simulation) */
  down: string | null = null;

  constructor(seed?: Partial<UserDataSnapshot>) {
    if (seed?.trades) this.trades = seed.trades.map((t) => clone(t));
    if (seed?.setups) this.setups = clone(seed.setups);
    if (seed?.plans) this.plans = seed.plans.map((p) => clone(p));
    this.baseCapital = seed?.baseCapital ?? null;
  }

  private async enter(op: string, ...args: unknown[]) {
    this.calls.push({ op, args });
    await Promise.resolve();
    if (this.down) throw new Error(this.down);
    if (this.failNext.delete(op)) throw new Error(`simulated failure in ${op}`);
  }
  writes() { return this.calls.filter((c) => c.op !== "loadAll"); }

  async loadAll(): Promise<UserDataSnapshot> {
    await this.enter("loadAll");
    // through the row mapping, exactly like the real adapter
    return {
      trades: this.trades.map((t) => rowToTrade(tradeToRow(t))), setups: clone(this.setups),
      plans: this.plans.map((p) => rowToPlan(planToRow(p))), baseCapital: this.baseCapital,
    };
  }
  async insertTrades(ts: Trade[]) {
    await this.enter("insertTrades", ts);
    for (const t of ts) if (this.trades.some((x) => x.id === t.id)) throw new Error(`duplicate trade id ${t.id}`);
    this.trades.push(...ts.map((t) => rowToTrade(tradeToRow(t))));
  }
  async updateTrade(id: string, patch: Partial<Trade>) { await this.updateTrades([id], patch, "updateTrade"); }
  async updateTrades(ids: string[], patch: Partial<Trade>, op = "updateTrades") {
    await this.enter(op, ids, patch);
    const cols = tradePatchToRow(patch);
    const hit = this.trades.filter((t) => ids.includes(t.id));
    if (hit.length !== ids.length) throw new Error(`${ids.length - hit.length} trade(s) not found in this account`);
    this.trades = this.trades.map((t) => {
      if (!ids.includes(t.id)) return t;
      const row = { ...tradeToRow(t), ...cols };
      return rowToTrade(row as ReturnType<typeof tradeToRow>);
    });
  }
  async deleteTrade(id: string) {
    await this.enter("deleteTrade", id);
    if (!this.trades.some((t) => t.id === id)) throw new Error("trade not found in this account");
    this.trades = this.trades.filter((t) => t.id !== id);
  }
  async insertSetup(s: Setup) {
    await this.enter("insertSetup", s);
    if (this.setups.some((x) => x.id === s.id)) throw new Error(`duplicate setup id ${s.id}`);
    this.setups.push({ ...s });
  }
  async renameSetup(id: string, name: string) {
    await this.enter("renameSetup", id, name);
    if (!this.setups.some((s) => s.id === id)) throw new Error("setup not found in this account");
    this.setups = this.setups.map((s) => (s.id === id ? { ...s, name } : s));
  }
  async deleteSetup(id: string) {
    await this.enter("deleteSetup", id);
    this.trades = this.trades.map((t) => { if (t.setupId !== id) return t; const { setupId: _s, ...rest } = t; return rest as Trade; });
    this.setups = this.setups.filter((s) => s.id !== id);
  }
  async insertPlan(p: TradePlan) {
    await this.enter("insertPlan", p);
    if (this.plans.some((x) => x.id === p.id)) throw new Error(`duplicate plan id ${p.id}`);
    this.plans.push(rowToPlan(planToRow(p)));
  }
  async updatePlan(p: TradePlan) {
    await this.enter("updatePlan", p);
    if (!this.plans.some((x) => x.id === p.id)) throw new Error("plan not found in this account");
    this.plans = this.plans.map((x) => (x.id === p.id ? rowToPlan(planToRow({ ...p, createdAt: x.createdAt })) : x));
  }
  async deletePlan(id: string) {
    await this.enter("deletePlan", id);
    if (!this.plans.some((p) => p.id === id)) throw new Error("plan not found in this account");
    this.plans = this.plans.filter((p) => p.id !== id);
  }
  async saveBaseCapital(n: number) {
    await this.enter("saveBaseCapital", n);
    if (!(n > 0)) throw new Error("base capital must be > 0");
    this.baseCapital = n;
  }
  async importMissing(b: ImportBatch): Promise<ImportCounts> {
    await this.enter("importMissing", b);
    const c: ImportCounts = { setups: 0, trades: 0, plans: 0 };
    for (const s of b.setups) if (!this.setups.some((x) => x.id === s.id)) { this.setups.push({ ...s }); c.setups++; }
    for (const t of b.trades) if (!this.trades.some((x) => x.id === t.id)) { this.trades.push(rowToTrade(tradeToRow(t))); c.trades++; }
    for (const p of b.plans) if (!this.plans.some((x) => x.id === p.id)) { this.plans.push(rowToPlan(planToRow(p))); c.plans++; }
    return c;
  }
}
