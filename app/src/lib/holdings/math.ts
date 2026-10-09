import type { ChangeStatus, HoldingRow, Position, PutCall } from "./types";

// Pure maths for HOLD: aggregation of filing rows, quarter-over-quarter classification and % of portfolio.
// No I/O, no clock reads. Nothing here scores or judges a position.

export interface RawRow { cusip: string; issuer: string; titleOfClass: string; putCall: string; sharesType: string; shares: number; value: number }

const normPutCall = (s: string): PutCall => (/^put$/i.test(s.trim()) ? "Put" : /^call$/i.test(s.trim()) ? "Call" : null);
export const positionKey = (p: Pick<Position, "cusip" | "putCall" | "sharesType">) => `${p.cusip}|${p.putCall ?? ""}|${p.sharesType}`;

/** Sums rows of one filing that describe the same position (same CUSIP, put/call flag and shares/principal type). Invalid rows are skipped, never repaired. */
export function aggregateRows(rows: RawRow[]): Position[] {
  const by = new Map<string, Position>();
  for (const r of rows) {
    if (!r.cusip || !Number.isFinite(r.shares) || !Number.isFinite(r.value)) continue;
    const sharesType = r.sharesType.trim().toUpperCase() === "PRN" ? "PRN" : "SH";
    const p: Position = { cusip: r.cusip.trim().toUpperCase(), issuer: r.issuer.trim(), titleOfClass: r.titleOfClass.trim(), putCall: normPutCall(r.putCall), sharesType, shares: r.shares, value: r.value };
    const k = positionKey(p);
    const cur = by.get(k);
    if (cur) { cur.shares += p.shares; cur.value += p.value; } else by.set(k, p);
  }
  return [...by.values()];
}

export const totalValue = (ps: Position[]) => ps.reduce((a, p) => a + p.value, 0);

export function classify(cur: number | null, prev: number | null): { status: ChangeStatus; pct: number | null } {
  if (prev == null) return { status: "unknown", pct: null };
  if (cur == null) return { status: "exited", pct: null };
  if (prev === 0) return { status: cur === 0 ? "unchanged" : "new", pct: null };
  if (cur === prev) return { status: "unchanged", pct: 0 };
  return { status: cur > prev ? "added" : "reduced", pct: ((cur - prev) / prev) * 100 };
}

export interface DiffResult { rows: HoldingRow[]; exited: HoldingRow[] }

/**
 * Current positions with their change versus the previous quarter. `previous` null (no earlier filing in the data)
 * marks every row "unknown" instead of "new". Rows sort by value, largest first. `exited` = previous positions absent now.
 */
export function diffPositions(current: Position[], previous: Position[] | null, tickerOf: (cusip: string) => string | null, maxRows: number, maxExited: number): DiffResult {
  const total = totalValue(current) || 0;
  const prevBy = new Map((previous ?? []).map((p) => [positionKey(p), p]));
  const toRow = (p: Position, status: ChangeStatus, prevShares: number | null, pct: number | null, share: number): HoldingRow =>
    ({ ...p, ticker: tickerOf(p.cusip), pct: share, status, prevShares, sharesChangePct: pct });
  const rows = [...current].sort((a, b) => b.value - a.value || a.cusip.localeCompare(b.cusip)).slice(0, maxRows).map((p) => {
    const prev = prevBy.get(positionKey(p));
    if (previous == null) return toRow(p, "unknown", null, null, total ? (p.value / total) * 100 : 0);
    if (!prev) return toRow(p, "new", null, null, total ? (p.value / total) * 100 : 0);
    const c = classify(p.shares, prev.shares);
    return toRow(p, c.status, prev.shares, c.pct, total ? (p.value / total) * 100 : 0);
  });
  const curKeys = new Set(current.map(positionKey));
  const exited = previous == null ? [] : previous.filter((p) => !curKeys.has(positionKey(p)))
    .sort((a, b) => b.value - a.value || a.cusip.localeCompare(b.cusip)).slice(0, maxExited)
    .map((p) => toRow({ ...p, shares: 0, value: 0 }, "exited", p.shares, null, 0));
  return { rows, exited };
}

/** Whole-dollar amounts for display: "$1.23B", "$845.6M", "$12.3K". */
export function fmtUsd(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

/** The SEC's "DD-MON-YYYY" date as ISO "YYYY-MM-DD". Null if unreadable. */
export function secDateToIso(s: string): string | null {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/i.exec(s.trim());
  if (!m) return null;
  const mo = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(m[2].toUpperCase());
  return mo < 0 ? null : `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[1]}`;
}

/** Quarter-end one quarter before `iso` (a quarter-end date). */
export function previousQuarterEnd(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  let y = +m[1], mo = +m[2] - 3;
  if (mo < 1) { mo += 12; y -= 1; }
  const day = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Display ticker as the terminal writes class shares ("BRK/B" → "BRK.B"). */
export const displayTicker = (t: string) => t.replace(/[/-]/g, ".");

/** Name tokens used for the "same company" sanity check of a CUSIP→ticker match. */
export function nameKey(name: string): string {
  return name.toUpperCase().replace(/^THE\s+/, "").replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean)[0] ?? "";
}
