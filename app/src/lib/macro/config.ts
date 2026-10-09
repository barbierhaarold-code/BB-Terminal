import type { Economy, Indicator, SeriesDef, GapRow, LagRule } from "./types";

// ────────────────────────────────────────────────────────────
// THE one place series are defined. Adding a series = adding a row here (and,
// for a new aggregator, an adapter on the server). Verified against live
// DBnomics queries on 2026-10-09; see the report for the licence findings.
//
// DESCRIPTIVE data only: nothing here forecasts, scores or colours a value.
// ────────────────────────────────────────────────────────────

export const ECONOMIES: { id: Economy; name: string }[] = [
  { id: "US", name: "United States" }, { id: "EA", name: "Euro Area" }, { id: "UK", name: "United Kingdom" },
  { id: "JP", name: "Japan" }, { id: "CA", name: "Canada" }, { id: "AU", name: "Australia" },
  { id: "NZ", name: "New Zealand" }, { id: "CH", name: "Switzerland" },
];
export const ECONOMY_NAME: Record<Economy, string> = Object.fromEntries(ECONOMIES.map((e) => [e.id, e.name])) as Record<Economy, string>;

export const INDICATORS: { id: Indicator; name: string }[] = [
  { id: "policy_rate", name: "Policy rate" },
  { id: "cpi_yoy", name: "CPI inflation (YoY)" },
  { id: "core_cpi_yoy", name: "Core CPI (YoY)" },
  { id: "unemployment", name: "Unemployment rate" },
  { id: "gdp_growth", name: "Real GDP growth" },
  { id: "yield_10y", name: "10Y government yield" },
];
export const INDICATOR_NAME: Record<Indicator, string> = Object.fromEntries(INDICATORS.map((i) => [i.id, i.name])) as Record<Indicator, string>;

/** Standard lag rules. `days` = worst-case normal age of the latest observation (period length + publication delay). */
const DAILY: LagRule = { days: 7, basis: "observation", why: "daily series: a weekend plus a holiday, plus the aggregator's refresh delay" };
const MONTHLY: LagRule = { days: 55, basis: "observation", why: "monthly release about 3 weeks after month end, so the latest period can be up to ~55 days old before the next one" };
const QUARTERLY_AU_CPI: LagRule = { days: 120, basis: "observation", why: "quarterly CPI is released about 4 weeks after quarter end: up to ~120 days old before the next one" };
const STEP: LagRule = { days: 45, basis: "refresh", why: "policy rates change only at meetings (about every 6 weeks); judged by the aggregator's last refresh, not by the date of the last decision" };

const dbn = {
  adapter: "dbnomics" as const,
  unit: "%" as const,
};
const VIA = "via DBnomics";
/** Shown next to every value computed from a rounded index. */
export const COMPUTED_ROUNDING_NOTE = "computed · may differ by ±0.1 pp from the official figure (index rounded to 0.1)";

export const SERIES: SeriesDef[] = [
  // ── United States ──
  { ...dbn, id: "us.policy", economy: "US", indicator: "policy_rate", code: "FED/PRATES_PRATES_POLICY_RATES/RESBM_N.D", frequency: "daily", kind: "level", transform: "none",
    label: "Interest on reserves (administered rate)", basis: "level, %", decimals: 2, provider: "Federal Reserve Board",
    attribution: `Source: Board of Governors of the Federal Reserve System, ${VIA}`,
    licenceNote: "Public domain (Federal Reserve Board website: may be copied and distributed without permission).", lag: DAILY },
  { ...dbn, id: "us.y10", economy: "US", indicator: "yield_10y", code: "FED/H15/RIFLGFCY10_N.B", frequency: "daily", kind: "level", transform: "none",
    label: "10-year Treasury constant maturity", basis: "level, %", decimals: 2, provider: "Federal Reserve Board",
    attribution: `Source: Board of Governors of the Federal Reserve System (H.15), ${VIA}`,
    licenceNote: "Public domain (Federal Reserve Board).", lag: DAILY },
  { ...dbn, id: "us.gdp", economy: "US", indicator: "gdp_growth", code: "BEA/NIPA-T10101/A191RL-Q", frequency: "quarterly", kind: "level", transform: "none",
    label: "Real GDP growth", basis: "q/q, annualised, %", decimals: 1, provider: "U.S. Bureau of Economic Analysis",
    attribution: `Source: U.S. Bureau of Economic Analysis, ${VIA}`,
    licenceNote: "Rests on the public-domain status of US federal works (17 U.S.C. §105), not on a BEA page that could be read.",
    lag: { days: 125, basis: "observation", why: "advance estimate ~30 days after quarter end: up to ~125 days old before the next one" } },

  // ── Euro Area ──
  { ...dbn, id: "ea.policy", economy: "EA", indicator: "policy_rate", code: "ECB/FM/D.U2.EUR.4F.KR.DFR.LEV", frequency: "daily", kind: "level", transform: "none",
    label: "ECB deposit facility rate", basis: "level, %", decimals: 2, provider: "European Central Bank",
    attribution: `Source: European Central Bank, ${VIA}`,
    licenceNote: "ESCB statistics: free reuse, commercial or not, source quoted.", lag: DAILY },
  { ...dbn, id: "ea.y10", economy: "EA", indicator: "yield_10y", code: "ECB/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y", frequency: "daily", kind: "level", transform: "none",
    label: "10-year euro-area government yield (AAA-rated curve, spot)", basis: "level, %", decimals: 2, provider: "European Central Bank",
    attribution: `Source: European Central Bank (euro area yield curve), ${VIA}`,
    licenceNote: "ESCB statistics: free reuse, commercial or not, source quoted.", lag: DAILY },
  { ...dbn, id: "ea.gdp", economy: "EA", indicator: "gdp_growth", code: "ECB/MNA/Q.Y.I9.W2.S1.S1.B.B1GQ._Z._Z._Z.EUR.LR.GY", frequency: "quarterly", kind: "level", transform: "none",
    label: "Real GDP growth (euro area 20)", basis: "y/y, %", decimals: 2, provider: "European Central Bank",
    attribution: `Source: European Central Bank (national accounts), ${VIA}`,
    licenceNote: "ESCB statistics: free reuse, commercial or not, source quoted.",
    lag: { days: 160, basis: "observation", why: "flash ~45 days and full estimate ~65 days after quarter end: up to ~160 days old before the next one" } },

  // ── United Kingdom ──
  { ...dbn, id: "uk.cpi", economy: "UK", indicator: "cpi_yoy", code: "ONS/MM23/D7G7.M", frequency: "monthly", kind: "level", transform: "none",
    label: "CPI, all items", basis: "y/y, % (published by ONS)", decimals: 1, provider: "Office for National Statistics",
    attribution: `Source: Office for National Statistics, ${VIA}. Contains public sector information licensed under the Open Government Licence v3.0`,
    licenceNote: "Open Government Licence v3.0.", lag: MONTHLY },
  { ...dbn, id: "uk.unemp", economy: "UK", indicator: "unemployment", code: "ONS/LMS/MGSX.M", frequency: "monthly", kind: "level", transform: "none",
    label: "Unemployment rate, aged 16+, seasonally adjusted", basis: "level, %", decimals: 1, provider: "Office for National Statistics",
    attribution: `Source: Office for National Statistics, ${VIA}. Contains public sector information licensed under the Open Government Licence v3.0`,
    licenceNote: "Open Government Licence v3.0.",
    lag: { days: 110, basis: "observation", why: "ONS publishes a month's labour market figure ~77 days after it ends (June 2026 on 15 Sep 2026) and then monthly: up to ~110 days old before the next one" } },
  { ...dbn, id: "uk.gdp", economy: "UK", indicator: "gdp_growth", code: "ONS/QNA/IHYQ.Q", frequency: "quarterly", kind: "level", transform: "none",
    label: "Real GDP growth", basis: "q/q, % (CVM, seasonally adjusted)", decimals: 1, provider: "Office for National Statistics",
    attribution: `Source: Office for National Statistics, ${VIA}. Contains public sector information licensed under the Open Government Licence v3.0`,
    licenceNote: "Open Government Licence v3.0.",
    lag: { days: 135, basis: "observation", why: "first estimate ~40 days after quarter end: up to ~135 days old before the next one" } },

  // ── Japan (YoY computed from the published index) ──
  { ...dbn, id: "jp.cpi", economy: "JP", indicator: "cpi_yoy", code: "STATJP/CPIm/001", frequency: "monthly", kind: "level", transform: "yoy",
    label: "CPI, all items", basis: "y/y, % (computed from the published index, which is rounded to 0.1: can differ from the official y/y by ~0.1 pp)", decimals: 1, provider: "Statistics Bureau of Japan",
    attribution: `Source: Statistics Bureau of Japan, ${VIA}. Year-on-year change computed by this terminal`,
    licenceNote: "Commercial use permitted; terms compatible with CC BY 4.0.", valueNote: COMPUTED_ROUNDING_NOTE, lag: MONTHLY },
  { ...dbn, id: "jp.core", economy: "JP", indicator: "core_cpi_yoy", code: "STATJP/CPIm/740", frequency: "monthly", kind: "level", transform: "yoy",
    label: "CPI, all items less fresh food and energy", basis: "y/y, % (computed from the published index, which is rounded to 0.1: can differ from the official y/y by ~0.1 pp)", decimals: 1, provider: "Statistics Bureau of Japan",
    attribution: `Source: Statistics Bureau of Japan, ${VIA}. Year-on-year change computed by this terminal`,
    licenceNote: "Commercial use permitted; terms compatible with CC BY 4.0.", valueNote: COMPUTED_ROUNDING_NOTE, lag: MONTHLY },

  // ── Australia (RBA tables; CPI, GDP and labour force are ABS data republished by the RBA) ──
  { ...dbn, id: "au.policy", economy: "AU", indicator: "policy_rate", code: "RBA/A2/ARBAMPCNCRT", frequency: "daily", kind: "step", transform: "none",
    label: "Cash rate target", basis: "level, % (observation date = date the rate took effect)", decimals: 2, provider: "Reserve Bank of Australia",
    attribution: `Source: Reserve Bank of Australia (CC BY 4.0), ${VIA}. The RBA does not endorse this terminal`,
    licenceNote: "CC BY 4.0 plus RBA Cash Rate terms: no implied endorsement.", lag: STEP },
  { ...dbn, id: "au.cpi", economy: "AU", indicator: "cpi_yoy", code: "RBA/G1/GCPIAGYP", frequency: "quarterly", kind: "level", transform: "none",
    label: "CPI, year-ended inflation", basis: "y/y, % (published)", decimals: 1, provider: "Australian Bureau of Statistics, via the RBA",
    attribution: `Source: Australian Bureau of Statistics (CC BY 4.0) republished by the Reserve Bank of Australia, ${VIA}. The RBA does not endorse this terminal`,
    licenceNote: "ABS material is CC BY 4.0; RBA marks it as third-party material.", lag: QUARTERLY_AU_CPI },
  { ...dbn, id: "au.core", economy: "AU", indicator: "core_cpi_yoy", code: "RBA/G1/GCPIOCPMTMYP", frequency: "quarterly", kind: "level", transform: "none",
    label: "Trimmed mean inflation (excl. interest charges and tax changes)", basis: "y/y, % (published)", decimals: 1, provider: "Australian Bureau of Statistics, via the RBA",
    attribution: `Source: Australian Bureau of Statistics (CC BY 4.0) republished by the Reserve Bank of Australia, ${VIA}. The RBA does not endorse this terminal`,
    licenceNote: "ABS material is CC BY 4.0; RBA marks it as third-party material.", lag: QUARTERLY_AU_CPI },
  { ...dbn, id: "au.unemp", economy: "AU", indicator: "unemployment", code: "RBA/H5/GLFSURSA", frequency: "monthly", kind: "level", transform: "none",
    label: "Unemployment rate, seasonally adjusted", basis: "level, %", decimals: 2, provider: "Australian Bureau of Statistics, via the RBA",
    attribution: `Source: Australian Bureau of Statistics (CC BY 4.0) republished by the Reserve Bank of Australia, ${VIA}. The RBA does not endorse this terminal`,
    licenceNote: "ABS material is CC BY 4.0; RBA marks it as third-party material.", lag: MONTHLY },
  { ...dbn, id: "au.gdp", economy: "AU", indicator: "gdp_growth", code: "RBA/H1/GGDPCVGDPY", frequency: "quarterly", kind: "level", transform: "none",
    label: "Real GDP growth", basis: "y/y, %", decimals: 2, provider: "Australian Bureau of Statistics, via the RBA",
    attribution: `Source: Australian Bureau of Statistics (CC BY 4.0) republished by the Reserve Bank of Australia, ${VIA}. The RBA does not endorse this terminal`,
    licenceNote: "ABS material is CC BY 4.0; RBA marks it as third-party material.",
    lag: { days: 160, basis: "observation", why: "national accounts ~65 days after quarter end: up to ~160 days old before the next one" } },
  { ...dbn, id: "au.y10", economy: "AU", indicator: "yield_10y", code: "RBA/F2/FCMYGBAG10D", frequency: "daily", kind: "level", transform: "none",
    label: "Australian Government 10-year bond yield", basis: "level, %", decimals: 2, provider: "Reserve Bank of Australia",
    attribution: `Source: Reserve Bank of Australia (CC BY 4.0), ${VIA}. The RBA does not endorse this terminal`,
    licenceNote: "CC BY 4.0 plus RBA financial-data terms: no implied endorsement.", lag: DAILY },
];

export const SERIES_BY_ID: Record<string, SeriesDef> = Object.fromEntries(SERIES.map((s) => [s.id, s]));

// ───────────── Coverage gaps (checked against live DBnomics queries on 2026-10-09) ─────────────

const OECD_X = "OECD is excluded for v1 (its terms could not be established and its DBnomics mirror was last indexed June 2026 with data to Apr–May 2026).";
type GapSpec = Omit<GapRow, "economy" | "indicator">;
const no = (reason: string): GapSpec => ({ kind: "no_series", reason });
const excluded = (reason: string): GapSpec => ({ kind: "excluded_provider", reason });
const stale = (reason: string): GapSpec => ({ kind: "stale_mirror", reason });
const notPinned = (reason: string): GapSpec => ({ kind: "not_pinned", reason });

const BLS_STALE = "The BLS mirror on DBnomics ends January 2025 (about 20 months old), and OECD is excluded for v1.";
const NO_OFFICIAL_RATE = (bank: string) => `${bank} is not on DBnomics with a policy-rate series; the BIS series ends June 2025 and the RBA international table ends January 2024.`;

export const KNOWN_GAPS: Partial<Record<Economy, Partial<Record<Indicator, GapSpec>>>> = {
  US: {
    cpi_yoy: stale(BLS_STALE), core_cpi_yoy: stale(BLS_STALE), unemployment: stale(BLS_STALE),
  },
  EA: {
    cpi_yoy: stale("The ECB consumer-price series on DBnomics ends December 2025 (about 9 months old, more than twice the expected lag)."),
    core_cpi_yoy: stale("The ECB consumer-price series on DBnomics ends December 2025 (about 9 months old)."),
    unemployment: stale("The Eurostat mirror on DBnomics ends November 2025 (indexed January 2026, about 10 months old)."),
  },
  UK: {
    policy_rate: no(NO_OFFICIAL_RATE("The Bank of England")),
    core_cpi_yoy: notPinned("ONS publishes a core CPI series, but its code was not pinned and verified for v1."),
    yield_10y: no("No free, licensed 10-year gilt yield series on DBnomics; " + OECD_X),
  },
  JP: {
    policy_rate: no(NO_OFFICIAL_RATE("The Bank of Japan")),
    unemployment: no("Only levels (persons) are available on DBnomics, not the unemployment rate; not derived in v1."),
    gdp_growth: no("No Cabinet Office GDP series on DBnomics; " + OECD_X),
    yield_10y: no("No free, licensed 10-year JGB yield series on DBnomics; " + OECD_X),
  },
  CA: {
    policy_rate: no(NO_OFFICIAL_RATE("The Bank of Canada") + " Its DBnomics provider only carries staff projections."),
    cpi_yoy: no("Statistics Canada's DBnomics tables do not include headline CPI; " + OECD_X),
    core_cpi_yoy: no("Statistics Canada's DBnomics tables do not include CPI; " + OECD_X),
    unemployment: no("Statistics Canada's DBnomics tables do not include the monthly labour force survey headline; " + OECD_X),
    gdp_growth: notPinned("Statistics Canada table 36100104 is on DBnomics, but the series was not pinned and verified for v1."),
    yield_10y: no("No free, licensed 10-year yield series on DBnomics; " + OECD_X),
  },
  AU: {},
  NZ: {},
  CH: {},
};

const NZ_ALL = "The Reserve Bank of New Zealand and Stats NZ are not on DBnomics; " + OECD_X;
const CH_ALL = "The Swiss National Bank is not on DBnomics; SECO is excluded (reproduction requires the copyright holder's prior written consent); " + OECD_X;

/** Static reason for a cell with no series in v1. */
export function knownGap(economy: Economy, indicator: Indicator): GapSpec {
  const hit = KNOWN_GAPS[economy]?.[indicator];
  if (hit) return hit;
  if (economy === "NZ") return no(NZ_ALL);
  if (economy === "CH") return excluded(CH_ALL);
  return no("No free, licensed, fresh series was found on DBnomics for this cell.");
}

export const STALE_RULE_TEXT =
  "Each series has an expected lag: the worst-case normal age of its latest observation (period length plus publication delay). "
  + "Older than that, the row is flagged STALE and stays in the table. Older than twice the lag, it leaves the table and appears under Coverage gaps. "
  + "Policy rates change only at meetings, so they are judged by when the aggregator last refreshed them rather than by the date of the last decision.";
