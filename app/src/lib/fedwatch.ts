import { fetchEffr, fetchFedFundsContractHistory, fetchFedFundsCurve, type FuturesCurvePoint } from "@/lib/api";

/** 2026 FOMC meeting dates, per federalreserve.gov/monetarypolicy/fomccalendars.htm
 * (each is "tentative until confirmed at the meeting immediately preceding it" —
 * the Fed's own caveat, not a gap in this app). Rate changes take effect the
 * business day after the second day. Update this list at the start of each year. */
export interface FomcMeeting { start: string; end: string; effective: string }
export const FOMC_MEETINGS_2026: FomcMeeting[] = [
  { start: "2026-01-27", end: "2026-01-28", effective: "2026-01-29" },
  { start: "2026-03-17", end: "2026-03-18", effective: "2026-03-19" },
  { start: "2026-04-28", end: "2026-04-29", effective: "2026-04-30" },
  { start: "2026-06-16", end: "2026-06-17", effective: "2026-06-18" },
  { start: "2026-07-28", end: "2026-07-29", effective: "2026-07-30" },
  { start: "2026-09-15", end: "2026-09-16", effective: "2026-09-17" },
  { start: "2026-10-27", end: "2026-10-28", effective: "2026-10-29" },
  { start: "2026-12-08", end: "2026-12-09", effective: "2026-12-10" },
];

export function nextMeeting(now = new Date()): FomcMeeting | undefined {
  return FOMC_MEETINGS_2026.find((m) => new Date(m.end + "T23:59:59") >= now);
}
export function previousMeeting(next: FomcMeeting, now = new Date()): FomcMeeting | undefined {
  const idx = FOMC_MEETINGS_2026.indexOf(next);
  return idx > 0 ? FOMC_MEETINGS_2026[idx - 1] : undefined;
}

function daysInMonth(yyyyMm: string): number {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * Solve for the market-implied post-meeting rate from one ZQ contract's
 * price, given the rate that held for the days before the meeting.
 * R_avg = (d/N)*R_before + ((N-d)/N)*R_after  ->  R_after = (R_avg*N - R_before*d) / (N-d)
 * where R_avg = 100 - price, N = days in the contract month, d = the day of
 * month the new rate takes effect on. This is the same algebra CME's
 * FedWatch tool runs on the CBOT 30-Day Fed Funds future — a simplified
 * single-meeting-per-month case, which every 2026 FOMC month satisfies.
 */
function impliedPostMeetingRate(contractPrice: number, rBeforePct: number, meeting: FomcMeeting): number {
  const month = meeting.effective.slice(0, 7);
  const n = daysInMonth(month);
  const d = Number(meeting.effective.slice(8, 10));
  const rAvg = 100 - contractPrice;
  return (rAvg * n - rBeforePct * d) / (n - d);
}

const STEP = 0.25; // Fed's standard move size, in percentage points

/** Distributes the implied delta (vs current target) across the nearest
 * bracketing 25bp outcomes by linear interpolation — a simplified stand-in
 * for CME's full discrete-outcome distribution, not an exact reproduction
 * of it. Returned probabilities always sum to 1. */
export interface RateOdds {
  impliedRate: number; deltaBps: number;
  outcomes: { label: string; bps: number; probability: number }[];
}
export function distributeOdds(rBefore: number, rAfter: number): RateOdds {
  const deltaBps = (rAfter - rBefore) * 100;
  const lower = Math.floor(deltaBps / (STEP * 100)) * STEP * 100;
  const upper = lower + STEP * 100;
  const frac = (deltaBps - lower) / (STEP * 100);
  const label = (bps: number) => (bps === 0 ? "HOLD" : bps > 0 ? `HIKE ${bps}BP` : `CUT ${Math.abs(bps)}BP`);
  const outcomes = lower === upper
    ? [{ label: label(lower), bps: lower, probability: 1 }]
    : [
        { label: label(lower), bps: lower, probability: 1 - frac },
        { label: label(upper), bps: upper, probability: frac },
      ].sort((a, b) => b.probability - a.probability);
  return { impliedRate: rAfter, deltaBps, outcomes };
}

export interface FedWatchSnapshot {
  meeting: FomcMeeting;
  currentTarget: { upper: number; lower: number; midpoint: number };
  current: RateOdds;
  sinceLastMeeting?: RateOdds;
}

/** Pulls EFFR + the ZQ curve, derives odds for the next FOMC meeting, and
 * (when a previous meeting exists) re-derives what those same odds looked
 * like the day after the last meeting, so the panel can show the shift. */
export async function loadFedWatch(now = new Date()): Promise<FedWatchSnapshot> {
  const meeting = nextMeeting(now);
  if (!meeting) throw new Error("No FOMC meeting date on file for this period — update FOMC_MEETINGS_2026.");

  const [effr, curve] = await Promise.all([
    fetchEffr(new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10)),
    fetchFedFundsCurve(),
  ]);
  const latestEffr = effr[effr.length - 1];
  if (!latestEffr) throw new Error("No EFFR data returned.");
  // The API returns rate/target_range_* as fractions (0.0363 == 3.63%), like
  // every other rate field in this codebase's fixedincome fetchers.
  const rBefore = latestEffr.rate * 100;
  const upper = (latestEffr.target_range_upper ?? latestEffr.rate) * 100;
  const lower = (latestEffr.target_range_lower ?? latestEffr.rate) * 100;

  const month = meeting.effective.slice(0, 7);
  const contract = curve.find((c: FuturesCurvePoint) => c.expiration === month);
  if (!contract) throw new Error(`No ZQ ${month} contract in the futures curve.`);
  const rAfter = impliedPostMeetingRate(contract.price, rBefore, meeting);
  const current = distributeOdds(rBefore, rAfter);

  const prev = previousMeeting(meeting, now);
  let sinceLastMeeting: RateOdds | undefined;
  if (prev) {
    try {
      const asOf = new Date(new Date(prev.effective).getTime() + 864e5).toISOString().slice(0, 10);
      const hist = await fetchFedFundsContractHistory(month, prev.effective, asOf);
      const histPrice = hist[0]?.close;
      if (histPrice != null) {
        const rAfterThen = impliedPostMeetingRate(histPrice, rBefore, meeting);
        sinceLastMeeting = distributeOdds(rBefore, rAfterThen);
      }
    } catch {
      // Optional enrichment — the "since last meeting" comparison is a nice-to-have,
      // not load-bearing for the panel's main countdown/odds display.
    }
  }

  return { meeting, currentTarget: { upper, lower, midpoint: (upper + lower) / 2 }, current, sinceLastMeeting };
}
