// Integration test of the REAL adapter + RLS over HTTP, against a THROWAWAY
// local PostgREST + Postgres (docker; never a Supabase project). Skipped unless
// PGREST_URL and PGREST_JWT_SECRET are set. See docs/user-data-design.md §Validation.
// The JWT secret is a random local-only value; tokens are minted here with
// node:crypto, so no key of any real project is involved.
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Trade } from "@/lib/journal";
import type { TradePlan } from "@/lib/tradePlan";
import { createSupabaseAdapter } from "./supabaseAdapter";
import { runImport } from "./importPlan";
import { hashData } from "./canonical";

const URL_ = process.env.PGREST_URL;
const SECRET = process.env.PGREST_JWT_SECRET;
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt(sub: string | null, role: string): string {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ ...(sub ? { sub } : {}), role, exp: Math.floor(Date.now() / 1000) + 600 });
  return `${head}.${body}.${createHmac("sha256", SECRET!).update(`${head}.${body}`).digest("base64url")}`;
}
function client(sub: string | null, role = "authenticated") {
  const token = jwt(sub, role);
  return createClient("http://placeholder.invalid", token, {
    auth: { persistSession: false, autoRefreshToken: false },
    // PostgREST is mounted at the root here; supabase-js adds /rest/v1.
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: (u, i) => fetch(String(u).replace("http://placeholder.invalid/rest/v1", URL_!), i) },
  });
}

const trade = (id: string, o: Partial<Trade> = {}): Trade => ({
  id, symbol: "XAUUSD", direction: "buy", size: 0.3, entryPrice: 4390.64, exitPrice: 4388.52, result: -54.93,
  entryAt: "2026-08-14T17:01:56", source: "import", createdAt: "2026-07-14T14:30:00.000Z", ...o,
});
const plan = (id: string, o: Partial<TradePlan> = {}): TradePlan => ({
  id, symbol: "XAUUSD", direction: "buy", thesisMacro: "é", thesisTechnical: "", timeframe: "M15", targets: [4020, 4030.5],
  catalysts: "", status: "active", createdAt: "2026-07-14T08:00:00.000Z", updatedAt: "2026-07-14T08:00:00.000Z",
  review: { lesson: "", followed: "partly", tradeId: "t000" }, entryLow: 3995, entryHigh: 4005, stop: 3990, ...o,
});
const fixture = Array.from({ length: 67 }, (_, i) => trade(`t${String(i).padStart(3, "0")}`, {
  result: i % 3 === 0 ? -50.5 : 120.25, entryAt: `2026-08-${String(1 + (i % 28)).padStart(2, "0")}T10:${String(i % 60).padStart(2, "0")}:00`,
  ...(i % 10 === 0 ? { entryPrice: 0, exitPrice: 0 } : {}), ...(i === 1 ? { setupId: "s1", notes: "x\ny" } : {}),
}));

describe.skipIf(!URL_ || !SECRET)("supabase adapter over PostgREST + RLS (throwaway)", () => {
  // lazy: the describe body still runs when the suite is skipped
  let a!: ReturnType<typeof createSupabaseAdapter>, b!: ReturnType<typeof createSupabaseAdapter>;
  beforeAll(() => { a = createSupabaseAdapter(client(A)); b = createSupabaseAdapter(client(B)); });
  const data = { setups: [{ id: "s1", name: "Breakout" }], trades: fixture, plans: [plan("p1"), plan("p2", { setupId: "s1" })] };

  it("imports idempotently, re-check matches, round trip hash identical", async () => {
    const r1 = await runImport(a, data, { copyBaseCapital: 43000 });
    expect(r1.check.ok).toBe(true);
    expect(r1.inserted).toEqual({ setups: 1, trades: 67, plans: 2 });
    expect(r1.baseCapital.action).toBe("set");
    const r2 = await runImport(a, data, { copyBaseCapital: 1 });
    expect(r2.inserted).toEqual({ setups: 0, trades: 0, plans: 0 });
    expect(r2.baseCapital.action).toBe("kept-existing");
    const snap = await a.loadAll();
    expect(snap.trades).toHaveLength(67);
    expect(snap.baseCapital).toBe(43000);
    const want = await hashData({ trades: fixture, setups: data.setups, baseCapital: 43000, plans: data.plans });
    expect(await hashData(snap)).toBe(want);
    expect(snap.trades.map((t) => t.id)).toEqual(fixture.map((t) => t.id)); // insertion order preserved
  });

  it("update / assign / delete / setup detach; missing rows are errors", async () => {
    await a.updateTrade("t002", { notes: "edited", result: 1.5 });
    await a.updateTrades(["t003", "t004"], { setupId: "s1" });
    await a.deleteSetup("s1");
    const s = await a.loadAll();
    expect(s.trades.find((t) => t.id === "t002")).toMatchObject({ notes: "edited", result: 1.5 });
    expect(s.trades.some((t) => t.setupId)).toBe(false);
    expect(s.setups).toEqual([]);
    await a.updatePlan({ ...plan("p1"), status: "closed", review: { lesson: "ok" } });
    expect((await a.loadAll()).plans.find((p) => p.id === "p1")).toMatchObject({ status: "closed", review: { lesson: "ok" } });
    await a.deleteTrade("t005");
    await expect(a.deleteTrade("t005")).rejects.toThrow(/0/);
    await expect(a.updateTrade("nope", { notes: "x" })).rejects.toThrow();
  });

  it("another user sees nothing and cannot touch these rows; ids may repeat across users", async () => {
    const s = await b.loadAll();
    expect(s.trades).toHaveLength(0);
    expect(s.plans).toHaveLength(0);
    expect(s.baseCapital).toBeNull();
    await expect(b.updateTrade("t002", { result: 999 })).rejects.toThrow();
    await expect(b.deleteTrade("t002")).rejects.toThrow();
    await expect(b.updatePlan(plan("p1"))).rejects.toThrow();
    await b.insertTrades([trade("t002", { result: 7 })]);
    expect((await a.loadAll()).trades.find((t) => t.id === "t002")?.result).toBe(1.5);
    expect((await b.loadAll()).trades).toHaveLength(1);
  });

  it("anonymous role cannot read or write", async () => {
    const anon = createSupabaseAdapter(client(null, "anon"));
    await expect(anon.loadAll()).rejects.toThrow();
    await expect(anon.insertTrades([trade("zz")])).rejects.toThrow();
  });

  it("reads more than one page (2 500 rows) without truncation", async () => {
    const big = Array.from({ length: 2500 }, (_, i) => trade(`b${String(i).padStart(5, "0")}`, { result: 1 }));
    await b.insertTrades(big);
    expect((await b.loadAll()).trades).toHaveLength(2501);
  });
});
