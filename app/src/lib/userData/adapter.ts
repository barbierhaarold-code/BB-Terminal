import type { Setup, Trade } from "@/lib/journal";
import type { TradePlan } from "@/lib/tradePlan";

/** Everything one signed-in user owns on the server. */
export interface UserDataSnapshot {
  trades: Trade[];
  setups: Setup[];
  plans: TradePlan[];
  /** null = the account has not set one yet (new accounts start with none) */
  baseCapital: number | null;
}

export interface ImportBatch { setups: Setup[]; trades: Trade[]; plans: TradePlan[] }
export interface ImportCounts { setups: number; trades: number; plans: number }

/**
 * The only door between the stores and the server. Every method throws a real
 * Error on failure (never resolves silently), and `update*`/`delete*` throw when
 * the row does not exist or is not the caller's (RLS hides other users' rows,
 * so "0 rows affected" must be an error, not a success).
 */
export interface UserDataAdapter {
  loadAll(): Promise<UserDataSnapshot>;

  insertTrades(ts: Trade[]): Promise<void>;
  updateTrade(id: string, patch: Partial<Trade>): Promise<void>;
  /** one UPDATE … WHERE id IN (…): used by "assign setup" */
  updateTrades(ids: string[], patch: Partial<Trade>): Promise<void>;
  deleteTrade(id: string): Promise<void>;

  insertSetup(s: Setup): Promise<void>;
  renameSetup(id: string, name: string): Promise<void>;
  /** clears setup_id on the user's trades that use it, then deletes the setup */
  deleteSetup(id: string): Promise<void>;

  insertPlan(p: TradePlan): Promise<void>;
  /** writes every mutable column of the plan (id/createdAt are never changed) */
  updatePlan(p: TradePlan): Promise<void>;
  deletePlan(id: string): Promise<void>;

  /** upsert of the single user_settings row */
  saveBaseCapital(n: number): Promise<void>;

  /**
   * Idempotent bulk insert: rows whose (user, id) already exist are skipped by
   * the primary key (ON CONFLICT DO NOTHING), never overwritten. Order:
   * setups → trades → plans, one request each. Returns how many rows were
   * actually inserted.
   */
  importMissing(batch: ImportBatch): Promise<ImportCounts>;
}
