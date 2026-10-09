// Walk-forward honesty test for Market Lean. Run: npm run lean:backtest
//
// For every trading day t of each instrument (2012 → today) it builds the lean using ONLY data
// available at t (computeLean slices every series itself; COT reports count only from the Friday
// after their Tuesday, strictly before t), then compares the lean direction with the realised
// 5- and 20-bar move AFTER t. Nothing is fitted on the test period.
//
// Data: Yahoo daily bars via the local OpenBB API (:6900), Fed H.15 yields via the same API,
// CFTC official Socrata API for COT. Raw downloads are cached in app/.lean-cache.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { INSTRUMENTS, SERIES, WALK_FORWARD_MULT, BASE_WEIGHTS, allSeriesIds, NEUTRAL_BAND, LEAN_THRESHOLD } from "../src/lib/lean/config";
import { computeLean } from "../src/lib/lean/score";
import type { Bar, CotReading, DriverId, LeanResult } from "../src/lib/lean/types";
import { COT_CATEGORIES, COT_CONTRACTS, COT_DATASETS, COT_SOCRATA_HOST, COT_LOOKBACKS } from "../src/lib/cotContracts";
import { percentileRank } from "../src/lib/cotMath";

const API = "http://127.0.0.1:6900/api/v1";
const CACHE = ".lean-cache";
const FETCH_FROM = "2008-01-01";
const START = "2012-01-01";
const SPLIT = "2020-01-01"; // train < SPLIT <= test
const HORIZONS = [5, 20] as const;
mkdirSync(CACHE, { recursive: true });

async function cached<T>(name: string, load: () => Promise<T>): Promise<T> {
  const f = `${CACHE}/${name.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")) as T;
  let v!: T;
  for (let attempt = 1; ; attempt++) {
    try { v = await load(); break; }
    catch (e) { if (attempt >= 4) throw e; console.log(`  retry ${name} (${attempt}): ${(e as Error).message}`); await new Promise((r) => setTimeout(r, 2000 * attempt)); }
  }
  writeFileSync(f, JSON.stringify(v));
  return v;
}

async function yahoo(sym: string): Promise<Bar[]> {
  return cached(`yahoo_${sym}`, async () => {
    const url = `${API}/equity/price/historical?symbol=${encodeURIComponent(sym)}&provider=yfinance&interval=1d&start_date=${FETCH_FROM}`;
    const res = await fetch(url);
    const body = (await res.json()) as { results?: { date: string; close: number }[] };
    if (!res.ok || !Array.isArray(body.results) || body.results.length === 0) throw new Error(`Yahoo ${sym}: HTTP ${res.status}, no rows`);
    return body.results.filter((r) => r.close != null).map((r) => ({ date: r.date.slice(0, 10), close: r.close }));
  });
}

async function fedYields(): Promise<{ UST10: Bar[]; UST2: Bar[] }> {
  return cached("fed_yields", async () => {
    const res = await fetch(`${API}/fixedincome/government/treasury_rates?provider=federal_reserve&start_date=${FETCH_FROM}`);
    const body = (await res.json()) as { results?: Record<string, number | string>[] };
    if (!res.ok || !Array.isArray(body.results)) throw new Error(`Fed yields: HTTP ${res.status}`);
    const mk = (k: string): Bar[] => body.results!.filter((r) => r[k] != null).map((r) => ({ date: String(r.date).slice(0, 10), close: Number(r[k]) * 100 }));
    return { UST10: mk("year_10"), UST2: mk("year_2") };
  });
}

interface CotWeek { date: string; nets: Record<string, number> }
async function cotHistory(): Promise<Record<string, CotWeek[]>> {
  return cached("cot_history", async () => {
    const out: Record<string, CotWeek[]> = {};
    for (const report of ["tff", "disagg"] as const) {
      const cats = COT_CATEGORIES[report];
      const defs = COT_CONTRACTS.filter((c) => c.report === report);
      const fields = new Set(["report_date_as_yyyy_mm_dd", "cftc_contract_market_code"]);
      cats.forEach((c) => { fields.add(c.longField); fields.add(c.shortField); });
      const params = new URLSearchParams({
        $select: [...fields].join(","),
        $where: `cftc_contract_market_code in (${defs.map((d) => `'${d.code}'`).join(",")}) AND report_date_as_yyyy_mm_dd >= '${FETCH_FROM}T00:00:00.000'`,
        $order: "report_date_as_yyyy_mm_dd ASC", $limit: "50000",
      });
      const res = await fetch(`${COT_SOCRATA_HOST}/resource/${COT_DATASETS[report].id}.json?${params}`, { headers: { accept: "application/json", "user-agent": "lean-walk-forward" } });
      if (!res.ok) throw new Error(`CFTC ${report}: HTTP ${res.status}`);
      const rows = (await res.json()) as Record<string, string>[];
      for (const d of defs) {
        out[d.key] = rows.filter((r) => r.cftc_contract_market_code === d.code).flatMap((r) => {
          const nets: Record<string, number> = {};
          for (const c of cats) {
            const l = Number(r[c.longField]), s = Number(r[c.shortField]);
            if (r[c.longField] == null || r[c.shortField] == null || !Number.isFinite(l) || !Number.isFinite(s)) return [];
            nets[c.id] = l - s;
          }
          return [{ date: r.report_date_as_yyyy_mm_dd.slice(0, 10), nets }];
        });
      }
    }
    return out;
  });
}

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + "T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** Point-in-time COT reading: latest report whose Friday release (Tuesday + 3 days) is strictly before the bar date. */
function cotAt(weeks: CotWeek[], groupId: string, groupLabel: string, contractKey: string, contractName: string, t: string): CotReading | null {
  let lo = 0, hi = weeks.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (addDays(weeks[m].date, 3) < t) lo = m + 1; else hi = m; }
  if (lo === 0) return null;
  const upto = weeks.slice(0, lo);
  const series = upto.map((w) => w.nets[groupId]);
  const last = upto[upto.length - 1];
  return {
    contractKey, contractName, groupId, groupLabel, asOf: last.date, net: series[series.length - 1],
    changeNet: series.length > 1 ? series[series.length - 1] - series[series.length - 2] : null,
    pct3y: percentileRank(series, COT_LOOKBACKS.y3), pct5y: percentileRank(series, COT_LOOKBACKS.y5),
  };
}

// ───────────── statistics ─────────────

interface Ci { hitLo: number; hitHi: number; edgeLo: number; edgeHi: number; significant: "edge" | "worse" | "none" }
interface Stat { n: number; hits: number; hitRate: number | null; baseUp: number | null; expected: number | null; edge: number | null; nEff: number; z: number | null; ci?: Ci }

// ── uncertainty: moving-block bootstrap over DATES ──
// All instruments that share a date are resampled together (keeps the cross-instrument dependence), and blocks of
// 2h consecutive dates (40 for 20-day, 10 for 5-day) keep the serial dependence from overlapping forward windows.
// 2000 resamples, seeded (deterministic); 95% percentile interval for the hit rate and for the edge over chance.
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const BOOT = 2000;
function bootstrapCi(pairs: { t: string; sig: number; ret: number }[], h: number, dates: string[]): Ci | undefined {
  const D = dates.length, L = 2 * h;
  if (pairs.length === 0 || D < L * 3) return undefined;
  const idx = new Map(dates.map((d, i) => [d, i]));
  const mk = () => new Float64Array(D + 1);
  const [N, H, S, U] = [mk(), mk(), mk(), mk()];
  const cnt = [new Float64Array(D), new Float64Array(D), new Float64Array(D), new Float64Array(D)];
  for (const p of pairs) {
    const i = idx.get(p.t); if (i == null) continue;
    cnt[0][i]++; if (Math.sign(p.sig) === Math.sign(p.ret)) cnt[1][i]++; if (p.sig > 0) cnt[2][i]++; if (p.ret > 0) cnt[3][i]++;
  }
  for (let i = 0; i < D; i++) { N[i + 1] = N[i] + cnt[0][i]; H[i + 1] = H[i] + cnt[1][i]; S[i + 1] = S[i] + cnt[2][i]; U[i + 1] = U[i] + cnt[3][i]; }
  const rng = mulberry32(20261008 + h);
  const nb = Math.ceil(D / L);
  const hits: number[] = [], edges: number[] = [];
  for (let it = 0; it < BOOT; it++) {
    let n = 0, hh = 0, s = 0, u = 0;
    for (let b = 0; b < nb; b++) {
      const a = Math.floor(rng() * (D - L + 1)), e = a + L;
      n += N[e] - N[a]; hh += H[e] - H[a]; s += S[e] - S[a]; u += U[e] - U[a];
    }
    if (n === 0) continue;
    const hr = hh / n, exp = (s / n) * (u / n) + (1 - s / n) * (1 - u / n);
    hits.push(hr); edges.push(hr - exp);
  }
  hits.sort((x, y) => x - y); edges.sort((x, y) => x - y);
  const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.max(0, Math.floor(p * a.length)))];
  const edgeLo = q(edges, 0.025), edgeHi = q(edges, 0.975);
  return { hitLo: q(hits, 0.025), hitHi: q(hits, 0.975), edgeLo, edgeHi, significant: edgeLo > 0 ? "edge" : edgeHi < 0 ? "worse" : "none" };
}

function stat(pairs: { t: string; sig: number; ret: number }[], h: number, dates?: string[]): Stat {
  const n = pairs.length;
  if (n === 0) return { n: 0, hits: 0, hitRate: null, baseUp: null, expected: null, edge: null, nEff: 0, z: null };
  const hits = pairs.filter((p) => Math.sign(p.sig) === Math.sign(p.ret)).length;
  const up = pairs.filter((p) => p.ret > 0).length / n;
  const sigUp = pairs.filter((p) => p.sig > 0).length / n;
  // chance level for a signal with this direction mix against these outcomes
  const expected = sigUp * up + (1 - sigUp) * (1 - up);
  const nEff = n / h; // overlapping h-day windows are not independent
  const se = Math.sqrt(expected * (1 - expected) / nEff);
  const hitRate = hits / n;
  return { n, hits, hitRate, baseUp: up, expected, edge: hitRate - expected, nEff, z: se > 0 ? (hitRate - expected) / se : null, ci: dates ? bootstrapCi(pairs, h, dates) : undefined };
}

interface Sample { id: string; t: string; ret: Record<number, number | null>; res: LeanResult }

async function main() {
  console.log("Downloading / loading cached history…");
  const ids = allSeriesIds().filter((s) => SERIES[s].kind !== "yield");
  const series: Record<string, Bar[]> = {};
  for (let i = 0; i < ids.length; i += 2) {
    await Promise.all(ids.slice(i, i + 2).map(async (id) => { series[id] = await yahoo(SERIES[id].yahoo!); }));
  }
  Object.assign(series, await fedYields());
  const cot = await cotHistory();
  console.log(`  ${Object.keys(series).length} series, ${Object.keys(cot).length} COT contracts`);
  const lastDate = series.SPX[series.SPX.length - 1].date;

  const collect = (): Sample[] => {
    const samples: Sample[] = [];
    for (const inst of INSTRUMENTS) {
      const own = series[inst.series];
      const weeks = inst.cot ? cot[inst.cot.contractKey] ?? [] : [];
      const catLabel = inst.cot ? (COT_CATEGORIES[COT_CONTRACTS.find((c) => c.key === inst.cot!.contractKey)!.report].find((c) => c.id === inst.cot!.groupId)?.label ?? inst.cot.groupId) : "";
      const cname = inst.cot ? COT_CONTRACTS.find((c) => c.key === inst.cot!.contractKey)!.name : "";
      for (let i = 0; i < own.length; i++) {
        const t = own[i].date;
        if (t < START) continue;
        const ret: Record<number, number | null> = {};
        for (const h of HORIZONS) ret[h] = i + h < own.length ? own[i + h].close / own[i].close - 1 : null;
        const c = inst.cot ? cotAt(weeks, inst.cot.groupId, catLabel, inst.cot.contractKey, cname, t) : null;
        samples.push({ id: inst.id, t, ret, res: computeLean({ instrumentId: inst.id, asOf: t, series, cot: c }) });
      }
    }
    return samples;
  };

  const DRIVERS5: DriverId[] = ["trend", "positioning", "dollarRates", "risk", "cross"];
  for (const d of DRIVERS5) WALK_FORWARD_MULT[d] = 1; // pass 1 uses the a-priori weights only
  console.log("Pass 1: base weights, scoring every day…");
  const s1 = collect();
  console.log(`  ${s1.length} instrument-days`);

  const driverIds: DriverId[] = ["trend", "positioning", "dollarRates", "risk", "cross"];
  const period = (p: "train" | "test" | "all") => (s: Sample) => p === "all" || (p === "train" ? s.t < SPLIT : s.t >= SPLIT);

  const datesOf = (samples: Sample[]) => [...new Set(samples.map((s) => s.t))].sort();
  const driverStats = (samples: Sample[], pooledExcludeDisplayOnly: boolean) => {
    const dates = datesOf(samples);
    const out: Record<string, Record<string, Record<number, Stat>>> = {};
    for (const d of driverIds) {
      out[d] = {};
      const groups: Record<string, Sample[]> = { POOLED: [] };
      for (const s of samples) {
        const dr = s.res.drivers.find((x) => x.id === d)!;
        if (dr.score == null || Math.abs(dr.score) < NEUTRAL_BAND) continue;
        (groups[s.id] ??= []).push(s);
        const inst = INSTRUMENTS.find((i) => i.id === s.id)!;
        const dispOnly = d === "positioning" && (!inst.cot || inst.cot.displayOnly);
        if (!(pooledExcludeDisplayOnly && dispOnly)) groups.POOLED.push(s);
      }
      for (const [g, arr] of Object.entries(groups)) {
        out[d][g] = {};
        for (const h of HORIZONS) {
          out[d][g][h] = stat(arr.filter((s) => s.ret[h] != null).map((s) => ({ t: s.t, sig: s.res.drivers.find((x) => x.id === d)!.score!, ret: s.ret[h]! })), h, dates);
        }
      }
    }
    return out;
  };

  const train1 = s1.filter(period("train"));
  const drvTrain = driverStats(train1, true);
  const drvTest = driverStats(s1.filter(period("test")), true);
  const drvAll = driverStats(s1, true);

  // ── pre-registered weight rule (decided before looking at the numbers):
  // a driver keeps its base weight only if, on the TRAIN period (< 2020), its pooled 20-day agreement beats
  // chance by >= 1 standard error (overlap-adjusted); otherwise its weight is set to 0. The test period never
  // influences a weight.
  const decisions: Record<string, { z: number | null; edge: number | null; keep: boolean }> = {};
  for (const d of driverIds) {
    const st = drvTrain[d].POOLED[20];
    decisions[d] = { z: st.z, edge: st.edge, keep: st.z != null && st.z >= 1 };
  }
  console.log("Weight decisions (train, pooled 20d):", JSON.stringify(decisions));

  for (const d of DRIVERS5) WALK_FORWARD_MULT[d] = decisions[d].keep ? 1 : 0;

  console.log("Pass 2: final weights…");
  const s2 = collect();

  const leanStats = (samples: Sample[]) => {
    const dates = datesOf(samples);
    const out: Record<string, Record<number, Stat & { coverage: number; agreementGe50: Stat; nonOverlap20?: Stat }>> = {};
    const byInst: Record<string, Sample[]> = { POOLED: samples };
    for (const s of samples) (byInst[s.id] ??= []).push(s);
    for (const [g, arr] of Object.entries(byInst)) {
      out[g] = {};
      for (const h of HORIZONS) {
        const dir = arr.filter((s) => (s.res.label === "Bullish lean" || s.res.label === "Bearish lean") && s.ret[h] != null);
        const mk = (xs: Sample[]) => stat(xs.map((s) => ({ t: s.t, sig: s.res.composite!, ret: s.ret[h]! })), h, dates);
        out[g][h] = { ...mk(dir), coverage: arr.length ? dir.length / arr.length : 0, agreementGe50: mk(dir.filter((s) => s.res.driverAgreement >= 50)) };
        if (g === "POOLED" && h === 20) {
          // cross-check without any bootstrap: only every 20th date, so the forward windows do not overlap in time
          const keep = new Set(dates.filter((_, i) => i % 20 === 0));
          out[g][h].nonOverlap20 = stat(dir.filter((s) => keep.has(s.t)).map((s) => ({ t: s.t, sig: s.res.composite!, ret: s.ret[h]! })), h);
        }
      }
    }
    return out;
  };

  const result = {
    generatedAt: new Date().toISOString().slice(0, 10),
    dataThrough: lastDate,
    start: START, split: SPLIT, horizons: HORIZONS,
    method: "Daily walk-forward, no look-ahead: lean at close t vs the move from close t to close t+h (h = 5 / 20 bars). Mixed days excluded. Agreement is compared with the chance level implied by the signal mix and the base rate of up moves. Uncertainty: 95% intervals from a seeded moving-block bootstrap over dates (2000 resamples, blocks of 2h consecutive dates, all instruments of a date resampled together); significant only if the interval for (hit rate − chance) excludes 0. nonOverlap20 is a cross-check using every 20th date only.",
    weightRule: "A driver keeps its base weight only if its pooled 20-day agreement on the TRAIN period (before 2020) beats chance by >= 1 standard error; otherwise weight 0. The TEST period (2020+) never influenced any weight.",
    baseWeights: BASE_WEIGHTS, decisions,
    drivers: { train: drvTrain, test: drvTest, all: drvAll },
    lean: { train: leanStats(s2.filter(period("train"))), test: leanStats(s2.filter(period("test"))), all: leanStats(s2) },
    leanBaseWeights: { test: leanStats(s1.filter(period("test"))), all: leanStats(s1) },
    thresholds: { LEAN_THRESHOLD, NEUTRAL_BAND },
  };
  writeFileSync("src/lib/lean/backtest.json", JSON.stringify(result, null, 1));
  console.log("Wrote src/lib/lean/backtest.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
