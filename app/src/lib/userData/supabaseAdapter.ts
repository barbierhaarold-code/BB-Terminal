// UserDataAdapter over Supabase PostgREST. Uses ONLY the supabase-js client the
// app already has: publishable key + the signed-in user's JWT (attached by the
// client). Row-level security does the isolation; this file never sends a
// user_id (the column defaults to auth.uid()). No service_role anywhere.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Setup, Trade } from "@/lib/journal";
import type { TradePlan } from "@/lib/tradePlan";
import type { ImportBatch, ImportCounts, UserDataAdapter, UserDataSnapshot } from "./adapter";
import {
  planToRow, rowToPlan, rowToSetup, rowToTrade, setupToRow, tradePatchToRow, tradeToRow,
  SETTINGS_SCHEMA_VERSION, type PlanRow, type SetupRow, type TradeRow,
} from "./mapping";

const PAGE = 1000;   // PostgREST caps a response; read in pages so nothing is silently truncated
const CHUNK = 200;   // rows per write request

type Db = Pick<SupabaseClient, "from">;

function fail(what: string, err: { message: string } | null | undefined): never {
  throw new Error(`${what}: ${err?.message ?? "unknown error"}`);
}

export function createSupabaseAdapter(db: Db): UserDataAdapter {
  async function readAll<T>(table: string, order: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db.from(table).select("*").order(order, { ascending: true }).range(from, from + PAGE - 1);
      if (error) fail(`Could not load ${table}`, error);
      const rows = (data ?? []) as T[];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }
  const chunks = <T,>(a: T[]): T[][] => Array.from({ length: Math.ceil(a.length / CHUNK) }, (_, i) => a.slice(i * CHUNK, (i + 1) * CHUNK));

  async function mutateOne(what: string, q: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, expected = 1) {
    const { data, error } = await q;
    if (error) fail(what, error);
    // RLS hides other users' rows, so "nothing matched" must surface as an error, never as success.
    if ((data?.length ?? 0) !== expected) throw new Error(`${what}: expected ${expected} row(s) affected in your account, got ${data?.length ?? 0}.`);
  }

  async function importTable(table: string, rows: object[]): Promise<number> {
    let n = 0;
    for (const part of chunks(rows)) {
      const { data, error } = await db.from(table).upsert(part, { onConflict: "user_id,id", ignoreDuplicates: true }).select("id");
      if (error) fail(`Import into ${table} failed`, error);
      n += data?.length ?? 0;
    }
    return n;
  }

  return {
    async loadAll(): Promise<UserDataSnapshot> {
      const [trades, setups, plans, settings] = await Promise.all([
        readAll<TradeRow>("trades", "seq"), readAll<SetupRow>("setups", "id"), readAll<PlanRow>("trade_plans", "seq"),
        db.from("user_settings").select("base_capital").maybeSingle(),
      ]);
      if (settings.error) fail("Could not load settings", settings.error);
      const cap = (settings.data as { base_capital: number | null } | null)?.base_capital;
      return {
        trades: trades.map(rowToTrade), setups: setups.map(rowToSetup), plans: plans.map(rowToPlan),
        baseCapital: typeof cap === "number" ? cap : null,
      };
    },

    async insertTrades(ts: Trade[]) {
      for (const part of chunks(ts)) {
        const { error } = await db.from("trades").insert(part.map(tradeToRow));
        if (error) fail("Could not save trade(s)", error);
      }
    },
    updateTrade(id, patch) { return this.updateTrades([id], patch); },
    async updateTrades(ids: string[], patch: Partial<Trade>) {
      if (ids.length === 0) return;
      for (const part of chunks(ids)) {
        await mutateOne("Could not update trade(s)", db.from("trades").update(tradePatchToRow(patch)).in("id", part).select("id"), part.length);
      }
    },
    async deleteTrade(id: string) {
      await mutateOne("Could not delete trade", db.from("trades").delete().eq("id", id).select("id"));
    },

    async insertSetup(s: Setup) {
      const { error } = await db.from("setups").insert(setupToRow(s));
      if (error) fail("Could not save setup", error);
    },
    async renameSetup(id: string, name: string) {
      await mutateOne("Could not rename setup", db.from("setups").update({ name }).eq("id", id).select("id"));
    },
    async deleteSetup(id: string) {
      const { error } = await db.from("trades").update({ setup_id: null }).eq("setup_id", id);
      if (error) fail("Could not detach setup from trades", error);
      await mutateOne("Could not delete setup", db.from("setups").delete().eq("id", id).select("id"));
    },

    async insertPlan(p: TradePlan) {
      const { error } = await db.from("trade_plans").insert(planToRow(p));
      if (error) fail("Could not save plan", error);
    },
    async updatePlan(p: TradePlan) {
      const { id: _id, created_at: _c, ...cols } = planToRow(p);
      await mutateOne("Could not update plan", db.from("trade_plans").update(cols).eq("id", p.id).select("id"));
    },
    async deletePlan(id: string) {
      await mutateOne("Could not delete plan", db.from("trade_plans").delete().eq("id", id).select("id"));
    },

    async saveBaseCapital(n: number) {
      const { error } = await db.from("user_settings").upsert({ base_capital: n, schema_version: SETTINGS_SCHEMA_VERSION }, { onConflict: "user_id" });
      if (error) fail("Could not save base capital", error);
    },

    async importMissing(b: ImportBatch): Promise<ImportCounts> {
      // order matters only for readability of partial failures; the rows have no FK between them
      const setups = await importTable("setups", b.setups.map(setupToRow));
      const trades = await importTable("trades", b.trades.map(tradeToRow));
      const plans = await importTable("trade_plans", b.plans.map(planToRow));
      return { setups, trades, plans };
    },
  };
}
