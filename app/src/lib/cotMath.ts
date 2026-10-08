// ────────────────────────────────────────────────────────────
// COT pure maths: percentile rank + report-freshness calendar.
// No I/O, no Date.now() inside — callers pass `nowMs` — so it is unit-testable
// and shared verbatim by the server proxy and the browser.
// ────────────────────────────────────────────────────────────

/**
 * Percentile rank of the LATEST value within the last `window` observations
 * (the window includes the latest value itself):
 *
 *   rank = 100 × (number of observations in the window that are ≤ latest) / window
 *
 * 100 means the highest net position in the window, a value near 0 means the
 * lowest. `series` is chronological (oldest → newest). Returns null when there
 * are fewer than `window` observations: a short history must never masquerade
 * as a 3- or 5-year rank.
 */
export function percentileRank(series: number[], window: number): number | null {
  if (series.length < window || window <= 0) return null;
  const win = series.slice(series.length - window);
  const latest = win[win.length - 1];
  let le = 0;
  for (const v of win) if (v <= latest) le++;
  return (le / win.length) * 100;
}

// ───────────── freshness ─────────────

export const COT_TZ = "America/New_York";
/** CFTC releases at 3:30 pm US Eastern on Friday for the preceding Tuesday. */
const RELEASE_HOUR = 15;
const RELEASE_MIN = 30;
/** How long after the scheduled release we wait before calling a report late. */
export const LATE_GRACE_MS = 3 * 60 * 60_000;
const DAY_MS = 86_400_000;

interface EtParts { y: number; m: number; d: number; h: number; min: number; dow: number }

const etFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: COT_TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
});
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function etParts(ms: number): EtParts {
  const p: Record<string, string> = {};
  for (const part of etFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, dow: DOW[p.weekday] };
}

/** UTC ms of a wall-clock time in America/New_York (DST-safe: refines the offset twice). */
function etWallToMs(y: number, m: number, d: number, h: number, min: number): number {
  const target = Date.UTC(y, m - 1, d, h, min);
  let t = target;
  for (let i = 0; i < 2; i++) {
    const p = etParts(t);
    t += target - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  }
  return t;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymdOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
function parseYmd(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split("-").map(Number);
  return [y, m, d];
}
function addDays(ymd: string, days: number): string {
  const [y, m, d] = parseYmd(ymd);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return ymdOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Scheduled release instant (UTC ms) of the report whose positions are as of `asOfYmd` (a Tuesday): that Friday, 3:30 pm ET. */
export function scheduledReleaseMs(asOfYmd: string): number {
  const [y, m, d] = parseYmd(addDays(asOfYmd, 3));
  return etWallToMs(y, m, d, RELEASE_HOUR, RELEASE_MIN);
}

/** The Friday (YYYY-MM-DD, ET) on which the report for `asOfYmd` is scheduled. */
export function scheduledReleaseDate(asOfYmd: string): string {
  return addDays(asOfYmd, 3);
}

export interface CotFreshness {
  /** Tuesday the newest published positions are as of */
  asOf: string;
  /** Friday the report was published (dataset timestamp when it falls in the expected week, else the schedule) */
  published: string;
  publishedBasis: "dataset-timestamp" | "scheduled";
  /** newest Tuesday whose scheduled release (+ grace) has already passed — what should be out by now */
  expectedAsOf: string;
  /** true when newer positions should already be published but are not in the data */
  late: boolean;
  /** hours since the scheduled release of `expectedAsOf` (only when late) */
  lateByHours: number | null;
  /** Tuesday + scheduled release instant of the next report */
  nextAsOf: string;
  nextReleaseAt: string;
}

/** Newest Tuesday (YYYY-MM-DD) whose scheduled release + grace is ≤ now. */
export function expectedAsOfTuesday(nowMs: number): string {
  const p = etParts(nowMs);
  let ymd = ymdOf(p.y, p.m, p.d);
  const back = (p.dow - 2 + 7) % 7; // days since the most recent Tuesday (0 on a Tuesday)
  ymd = addDays(ymd, -back);
  for (let i = 0; i < 60; i++) {
    if (scheduledReleaseMs(ymd) + LATE_GRACE_MS <= nowMs) return ymd;
    ymd = addDays(ymd, -7);
  }
  return ymd;
}

export function computeFreshness(asOf: string, nowMs: number, datasetUpdatedMs?: number | null): CotFreshness {
  const expectedAsOf = expectedAsOfTuesday(nowMs);
  const late = asOf < expectedAsOf;
  const sched = scheduledReleaseDate(asOf);

  let published = sched;
  let publishedBasis: CotFreshness["publishedBasis"] = "scheduled";
  if (datasetUpdatedMs != null && Number.isFinite(datasetUpdatedMs)) {
    const p = etParts(datasetUpdatedMs);
    const upd = ymdOf(p.y, p.m, p.d);
    // Only trust the timestamp if it falls in the 7 days after the Tuesday (i.e. it IS this report's release, not a later correction).
    if (upd > asOf && upd <= addDays(asOf, 7)) { published = upd; publishedBasis = "dataset-timestamp"; }
  }

  const nextAsOf = addDays(asOf, 7);
  return {
    asOf, published, publishedBasis, expectedAsOf, late,
    lateByHours: late ? Math.max(0, Math.round((nowMs - scheduledReleaseMs(expectedAsOf)) / 3_600_000)) : null,
    nextAsOf,
    nextReleaseAt: new Date(scheduledReleaseMs(nextAsOf)).toISOString(),
  };
}

// ───────────── display helpers (shared so every consumer words freshness the same way) ─────────────

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Tue 29 Sep 2026" from a YYYY-MM-DD string, timezone-independent. */
export function fmtCotDate(ymd: string): string {
  const [y, m, d] = parseYmd(ymd);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[dow]} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function freshnessLine(f: CotFreshness): string {
  return `Positions as of ${fmtCotDate(f.asOf)} · published ${fmtCotDate(f.published)}`;
}

export function lateMessage(f: CotFreshness): string {
  return `LATE — the report for positions as of ${fmtCotDate(f.expectedAsOf)} was due ${fmtCotDate(scheduledReleaseDate(f.expectedAsOf))} 3:30 pm ET `
    + `(${f.lateByHours ?? 0}h ago) and is not in the CFTC data yet. Holiday delays are possible. Showing the previous report.`;
}
