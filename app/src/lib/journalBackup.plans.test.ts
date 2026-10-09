import { beforeEach, describe, expect, it, vi } from "vitest";

// zustand `persist` needs a localStorage; give node an in-memory one before the stores load.
vi.hoisted(() => {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, get length() { return m.size; },
  } as Storage;
});

import { useJournal } from "@/store/journalStore";
import { useTradePlans } from "@/store/tradePlanStore";
import { applyMerge, applyReplace, buildBackup, parseBackup, BACKUP_FORMAT_VERSION } from "./journalBackup";
import type { Trade } from "./journal";
import type { TradePlan } from "./tradePlan";

const trade = (id: string, o: Partial<Trade> = {}): Trade => ({
  id, symbol: "XAUUSD", direction: "buy", size: 0.1, entryPrice: 4000, exitPrice: 4010, result: 100,
  entryAt: "2026-07-14T14:20:00", source: "manual", createdAt: "2026-07-14T14:30:00.000Z", ...o,
});
const plan = (id: string, tradeId?: string): TradePlan => ({
  id, symbol: "XAUUSD", direction: "buy", thesisMacro: "m", thesisTechnical: "t", timeframe: "M15", entryLow: 3995, entryHigh: 4005,
  stop: 3990, targets: [4020], riskPct: 0.5, catalysts: "", status: "active", createdAt: "2026-07-14T08:00:00.000Z",
  updatedAt: "2026-07-14T08:00:00.000Z", review: { tradeId, lesson: "" },
});
/** A file exactly as the pre-feature app wrote it (formatVersion 1, no plans key, no planCount). */
const oldFile = (trades: Trade[]) => JSON.stringify({
  header: { format: "abdel-khader-track-record", formatVersion: 1, exportedAt: "2026-10-01T00:00:00.000Z", appVersion: "0.1.0", tradeCount: trades.length, totalNetPnl: trades.reduce((s, t) => s + t.result, 0) },
  data: { trades, setups: [], baseCapital: 43_000, pricesHidden: true },
});

const ORIG = [trade("t1"), trade("t2", { entryPrice: 0, exitPrice: 0, result: 3132.4, source: "import" })];

beforeEach(() => {
  useJournal.setState({ trades: ORIG, setups: [], baseCapital: 43_000, pricesHidden: true });
  useTradePlans.setState({ plans: [plan("p1", "t1"), plan("p2")], loadError: null });
});

describe("backup format v2", () => {
  it("exports formatVersion 2 with plans under data.tradePlans, trades untouched", () => {
    const b = buildBackup();
    expect(BACKUP_FORMAT_VERSION).toBe(2);
    expect(b.header.formatVersion).toBe(2);
    expect(b.header.planCount).toBe(2);
    expect(b.data.tradePlans).toEqual({ schemaVersion: 1, plans: useTradePlans.getState().plans });
    expect(b.data.trades).toEqual(ORIG);
  });

  it("round trip: export → Replace on empty stores restores trades and plans identically", () => {
    const text = JSON.stringify(buildBackup());
    useJournal.setState({ trades: [], setups: [] });
    useTradePlans.setState({ plans: [] });
    const p = parseBackup(text);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = applyReplace(p.backup);
    expect(r.plans).toMatchObject({ before: 0, after: 2 });
    expect(useJournal.getState().trades).toEqual(ORIG);
    expect(useTradePlans.getState().plans.map((x) => x.id)).toEqual(["p1", "p2"]);
  });

  it("round trip: Merge of its own export adds nothing and skips everything", () => {
    const p = parseBackup(JSON.stringify(buildBackup()));
    if (!p.ok) throw new Error(p.error);
    const r = applyMerge(p.backup);
    expect(r).toMatchObject({ added: 0, skipped: 2, plans: { before: 2, after: 2, added: 0, skipped: 2 } });
  });

  it("OLD v1 file: parses, trades load as before, plans key absent", () => {
    const p = parseBackup(oldFile(ORIG));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.backup.header.formatVersion).toBe(1);
    expect(p.backup.data.tradePlans).toBeUndefined();
    expect(p.warnings).toEqual([]);
  });

  it("OLD v1 file with Merge keeps every plan and the existing trades", () => {
    const p = parseBackup(oldFile([...ORIG, trade("t3", { entryPrice: 4100, exitPrice: 4110, entryAt: "2026-07-15T10:00:00" })]));
    if (!p.ok) throw new Error(p.error);
    const r = applyMerge(p.backup);
    expect(r.plans).toBeUndefined();
    expect(r).toMatchObject({ added: 1, skipped: 2 });
    expect(useTradePlans.getState().plans.map((x) => x.id)).toEqual(["p1", "p2"]);
  });

  it("OLD v1 file with Replace replaces trades exactly as before and leaves plans untouched", () => {
    const p = parseBackup(oldFile([trade("only")]));
    if (!p.ok) throw new Error(p.error);
    const r = applyReplace(p.backup);
    expect(r.plans).toBeUndefined();
    expect(useJournal.getState().trades.map((t) => t.id)).toEqual(["only"]);
    expect(useTradePlans.getState().plans.map((x) => x.id)).toEqual(["p1", "p2"]);
  });

  it("rejects a future format and a malformed plans block with the real reason", () => {
    const f = JSON.parse(oldFile(ORIG));
    f.header.formatVersion = 3;
    expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: false, error: expect.stringMatching(/Unsupported backup version/) });
    const g = JSON.parse(oldFile(ORIG));
    g.header.formatVersion = 2;
    g.data.tradePlans = { schemaVersion: 1, plans: [{ id: "x" }] };
    expect(parseBackup(JSON.stringify(g))).toMatchObject({ ok: false, error: expect.stringMatching(/tradePlans/) });
  });
});
