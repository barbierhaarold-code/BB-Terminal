import { describe, expect, it } from "vitest";
import { aggregateRows, classify, diffPositions, displayTicker, fmtUsd, nameKey, previousQuarterEnd, secDateToIso, totalValue, type RawRow } from "./math";
import { MANAGERS } from "./config";

const row = (cusip: string, shares: number, value: number, o: Partial<RawRow> = {}): RawRow => ({ cusip, issuer: `ISSUER ${cusip}`, titleOfClass: "COM", putCall: "", sharesType: "SH", shares, value, ...o });

describe("aggregateRows", () => {
  it("sums rows of the same position (several managers / discretion lines) and keeps puts, calls and principal separate", () => {
    const ps = aggregateRows([row("A", 10, 100), row("a", 5, 50), row("A", 3, 30, { putCall: "Call" }), row("A", 2, 20, { putCall: "put" }), row("A", 7, 70, { sharesType: "PRN" })]);
    const get = (f: (p: (typeof ps)[number]) => boolean) => ps.find(f)!;
    expect(ps).toHaveLength(4);
    expect(get((p) => !p.putCall && p.sharesType === "SH")).toMatchObject({ cusip: "A", shares: 15, value: 150 });
    expect(get((p) => p.putCall === "Call").shares).toBe(3);
    expect(get((p) => p.putCall === "Put").shares).toBe(2);
    expect(get((p) => p.sharesType === "PRN").shares).toBe(7);
  });
  it("skips unreadable rows instead of repairing them", () => {
    expect(aggregateRows([row("A", NaN, 1), row("", 1, 1), row("B", 1, Infinity), row("C", 1, 1)]).map((p) => p.cusip)).toEqual(["C"]);
  });
});

describe("classify", () => {
  it("compares shares, not value (price moves are not trades)", () => {
    expect(classify(150, 100)).toEqual({ status: "added", pct: 50 });
    expect(classify(40, 100)).toEqual({ status: "reduced", pct: -60 });
    expect(classify(100, 100)).toEqual({ status: "unchanged", pct: 0 });
    expect(classify(null, 100)).toEqual({ status: "exited", pct: null });
    expect(classify(10, null)).toEqual({ status: "unknown", pct: null });
    expect(classify(10, 0)).toEqual({ status: "new", pct: null });
  });
});

describe("diffPositions", () => {
  const cur = aggregateRows([row("A", 150, 600), row("B", 100, 300), row("C", 10, 100)]);
  const prev = aggregateRows([row("A", 100, 400), row("B", 100, 280), row("D", 50, 90), row("E", 5, 10)]);
  it("labels new / added / unchanged, computes % of portfolio and lists exited positions by previous value", () => {
    const d = diffPositions(cur, prev, (c) => (c === "A" ? "AAA" : null), 10, 10);
    expect(totalValue(cur)).toBe(1000);
    expect(d.rows.map((r) => [r.cusip, r.status, r.pct])).toEqual([["A", "added", 60], ["B", "unchanged", 30], ["C", "new", 10]]);
    expect(d.rows[0]).toMatchObject({ ticker: "AAA", prevShares: 100, sharesChangePct: 50 });
    expect(d.rows[1].ticker).toBeNull();
    expect(d.exited.map((r) => [r.cusip, r.status, r.prevShares])).toEqual([["D", "exited", 50], ["E", "exited", 5]]);
  });
  it("without a previous filing every row is 'unknown' (never 'new') and nothing is called exited", () => {
    const d = diffPositions(cur, null, () => null, 10, 10);
    expect(d.rows.every((r) => r.status === "unknown")).toBe(true);
    expect(d.exited).toEqual([]);
  });
  it("caps rows but keeps % of the FULL portfolio", () => {
    const d = diffPositions(cur, prev, () => null, 1, 1);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0].pct).toBe(60);
    expect(d.exited).toHaveLength(1);
  });
  it("an empty portfolio does not divide by zero", () => {
    expect(diffPositions([], [], () => null, 5, 5)).toEqual({ rows: [], exited: [] });
  });
});

describe("dates, names, formatting", () => {
  it("reads the SEC DD-MON-YYYY format and refuses anything else", () => {
    expect(secDateToIso("14-AUG-2026")).toBe("2026-08-14");
    expect(secDateToIso("30-jun-2026")).toBe("2026-06-30");
    expect(secDateToIso("2026-08-14")).toBeNull();
    expect(secDateToIso("14-XXX-2026")).toBeNull();
  });
  it("previous quarter-end", () => {
    expect(previousQuarterEnd("2026-06-30")).toBe("2026-03-31");
    expect(previousQuarterEnd("2026-03-31")).toBe("2025-12-31");
    expect(previousQuarterEnd("2026-12-31")).toBe("2026-09-30");
    expect(previousQuarterEnd("junk")).toBeNull();
  });
  it("display ticker and name key for the CUSIP sanity check", () => {
    expect(displayTicker("BRK/B")).toBe("BRK.B");
    expect(displayTicker("BF-B")).toBe("BF.B");
    expect(nameKey("NVIDIA CORPORATION")).toBe(nameKey("NVIDIA CORP"));
    expect(nameKey("The Coca-Cola Co")).toBe("COCA");
    expect(nameKey("APPLE INC")).not.toBe(nameKey("APPLIED MATERIALS"));
  });
  it("formats whole-dollar amounts", () => {
    expect(fmtUsd(299253556246)).toBe("$299.25B");
    expect(fmtUsd(845_600_000)).toBe("$845.6M");
    expect(fmtUsd(12_300)).toBe("$12.3K");
    expect(fmtUsd(7)).toBe("$7");
  });
});

describe("curated managers", () => {
  it("has about 30 unique, zero-padded CIKs", () => {
    expect(MANAGERS.length).toBe(30);
    expect(new Set(MANAGERS.map((m) => m.cik)).size).toBe(30);
    expect(MANAGERS.every((m) => /^\d{10}$/.test(m.cik))).toBe(true);
  });
});
