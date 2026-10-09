import type { Economy, Indicator, SeriesDef, GapRow, LagRule } from "./types";

// ────────────────────────────────────────────────────────────
// THE one place series are defined. Adding a series = adding a row here (and,
// for a new provider, an adapter on the server). Series come from DBnomics or
// directly from the provider's own API; the UI and the maths never look at which.
// Verified against live queries on 2026-10-09.
//
// Licence policy for this non-commercial terminal: each series records its provider,
// attribution text and, only where a provider states it plainly, a one-line licence
// note. Licences are not audited and never exclude a source. Bot challenges, logins,
// paywalls and HTML scraping do exclude one.
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
const QUARTERLY_LABOUR: LagRule = { days: 135, basis: "observation", why: "quarterly labour-force figure published about 5 weeks after quarter end, then republished by the OECD/FRED with a further delay: up to ~135 days old before the next one" };
const BIS_POLICY: LagRule = { days: 14, basis: "observation", why: "BIS fills the daily policy-rate series up to its last update, normally within a few days of the central bank; 14 days leaves room for its update schedule" };
const SNB_POLICY: LagRule = { days: 14, basis: "observation", why: "the SNB data-portal cube is published weekly and ends on the previous business day, so a rate that has not changed can be up to ~10 days behind; 14 days leaves room for a missed week" };
const STEP: LagRule = { days: 45, basis: "refresh", why: "policy rates change only at meetings (about every 6 weeks); judged by the aggregator's last refresh, not by the date of the last decision" };

const dbn = {
  adapter: "dbnomics" as const,
  unit: "%" as const,
};
const direct = <A extends Exclude<SeriesDef["adapter"], "dbnomics">>(adapter: A) => ({ adapter, unit: "%" as const });
const VIA = "via DBnomics";
const NOT_AUDITED = "Licence not audited (non-commercial terminal); attribution kept.";
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

  // ═════════ Direct primary-source series (no aggregator in between) ═════════

  // ── United States: BLS Public Data API v2 (needs BLS_API_KEY) ──
  { ...direct("bls"), id: "us.cpi", economy: "US", indicator: "cpi_yoy", code: "CUUR0000SA0", frequency: "monthly", kind: "level", transform: "yoy",
    label: "CPI-U, all items (not seasonally adjusted)", basis: "y/y, % (computed from the published index, 3 decimals)", decimals: 1, provider: "U.S. Bureau of Labor Statistics",
    attribution: "Source: U.S. Bureau of Labor Statistics (Public Data API). Year-on-year change computed by this terminal; BLS has not endorsed or checked this calculation",
    licenceNote: "BLS states its website information is in the public domain unless annotated otherwise.", valueNote: "computed from the published index (3 decimals): should match the BLS 12-month change to the displayed decimal", lag: MONTHLY },
  { ...direct("bls"), id: "us.unemp", economy: "US", indicator: "unemployment", code: "LNS14000000", frequency: "monthly", kind: "level", transform: "none",
    label: "Unemployment rate, seasonally adjusted", basis: "level, %", decimals: 1, provider: "U.S. Bureau of Labor Statistics",
    attribution: "Source: U.S. Bureau of Labor Statistics (Current Population Survey, Public Data API)",
    licenceNote: "BLS states its website information is in the public domain unless annotated otherwise.", lag: MONTHLY },

  // ── Euro Area: Eurostat dissemination API ──
  { ...direct("eurostat"), id: "ea.cpi", economy: "EA", indicator: "cpi_yoy", code: "prc_hicp_minr?geo=EA&unit=RCH_A&coicop18=TOTAL", frequency: "monthly", kind: "level", transform: "none",
    label: "HICP, all items", basis: "y/y, % (published by Eurostat)", decimals: 1, provider: "Eurostat",
    attribution: "Source: Eurostat, HICP (prc_hicp_minr), ECOICOP ver. 2",
    licenceNote: "Eurostat: free reuse with the source acknowledged.", lag: MONTHLY },
  { ...direct("eurostat"), id: "ea.unemp", economy: "EA", indicator: "unemployment", code: "une_rt_m?geo=EA21&s_adj=SA&age=TOTAL&sex=T&unit=PC_ACT", frequency: "monthly", kind: "level", transform: "none",
    label: "Unemployment rate, seasonally adjusted, 15–74 (euro area, 21 members)", basis: "level, % of active population", decimals: 1, provider: "Eurostat",
    attribution: "Source: Eurostat, unemployment by sex and age, monthly (une_rt_m)",
    licenceNote: "Eurostat: free reuse with the source acknowledged.", lag: MONTHLY },

  // ── United Kingdom: Bank of England IADB ──
  { ...direct("boe"), id: "uk.policy", economy: "UK", indicator: "policy_rate", code: "IUDBEDR", frequency: "daily", kind: "level", transform: "none",
    label: "Official Bank Rate", basis: "level, %", decimals: 2, provider: "Bank of England",
    attribution: "Source: Bank of England, Interactive Statistical Database (IUDBEDR, official Bank Rate)",
    licenceNote: NOT_AUDITED, lag: DAILY },

  // ── Canada: Bank of Canada Valet + Statistics Canada WDS ──
  { ...direct("boc"), id: "ca.policy", economy: "CA", indicator: "policy_rate", code: "V39079", frequency: "daily", kind: "level", transform: "none",
    label: "Target for the overnight rate", basis: "level, %", decimals: 2, provider: "Bank of Canada",
    attribution: "Source: Bank of Canada, Valet API (V39079, target for the overnight rate)",
    licenceNote: NOT_AUDITED, lag: DAILY },
  { ...direct("statcan"), id: "ca.cpi", economy: "CA", indicator: "cpi_yoy", code: "41690973", frequency: "monthly", kind: "level", transform: "yoy",
    label: "CPI, all items (not seasonally adjusted)", basis: "y/y, % (computed from the published index, rounded to 0.1: can differ from the official y/y by ~0.1 pp)", decimals: 1, provider: "Statistics Canada",
    attribution: "Source: Statistics Canada, Table 18-10-0004-01 (vector v41690973). Year-on-year change computed by this terminal. Adapted from Statistics Canada under the Statistics Canada Open Licence; this does not constitute an endorsement by Statistics Canada",
    licenceNote: "Statistics Canada Open Licence.", valueNote: COMPUTED_ROUNDING_NOTE, lag: MONTHLY },
  { ...direct("statcan"), id: "ca.unemp", economy: "CA", indicator: "unemployment", code: "2062815", frequency: "monthly", kind: "level", transform: "none",
    label: "Unemployment rate, seasonally adjusted, 15+", basis: "level, %", decimals: 1, provider: "Statistics Canada",
    attribution: "Source: Statistics Canada, Table 14-10-0287-01 (vector v2062815, Labour Force Survey). Adapted from Statistics Canada under the Statistics Canada Open Licence; this does not constitute an endorsement by Statistics Canada",
    licenceNote: "Statistics Canada Open Licence.", lag: MONTHLY },

  // ── Japan: BIS policy-rate dataset (the BoJ API exposes the market call rate, not the policy target) + Statistics Bureau dashboard ──
  { ...direct("bis"), id: "jp.policy", economy: "JP", indicator: "policy_rate", code: "D.JP", frequency: "daily", kind: "level", transform: "none",
    label: "Policy rate (uncollateralised overnight call rate target)", basis: "level, %", decimals: 2, provider: "Bank of Japan, via the Bank for International Settlements",
    attribution: "Source: Bank for International Settlements, central bank policy rates (WS_CBPOL; reported by the Bank of Japan)",
    licenceNote: NOT_AUDITED, lag: BIS_POLICY },
  { ...direct("jpstat"), id: "jp.unemp", economy: "JP", indicator: "unemployment", code: "0301010000020020010", frequency: "monthly", kind: "level", transform: "none",
    label: "Unemployment rate, both sexes, seasonally adjusted", basis: "level, %", decimals: 1, provider: "Statistics Bureau of Japan",
    attribution: "Source: Statistics Bureau of Japan, Labour Force Survey (Statistics Dashboard API)",
    licenceNote: NOT_AUDITED, lag: MONTHLY },

  // ── New Zealand: BIS (RBNZ policy rate), IMF (CPI), FRED/OECD (unemployment) ──
  { ...direct("bis"), id: "nz.policy", economy: "NZ", indicator: "policy_rate", code: "D.NZ", frequency: "daily", kind: "level", transform: "none",
    label: "Official Cash Rate", basis: "level, %", decimals: 2, provider: "Reserve Bank of New Zealand, via the Bank for International Settlements",
    attribution: "Source: Bank for International Settlements, central bank policy rates (WS_CBPOL; reported by the Reserve Bank of New Zealand)",
    licenceNote: NOT_AUDITED, lag: BIS_POLICY },
  { ...direct("imf"), id: "nz.cpi", economy: "NZ", indicator: "cpi_yoy", code: "CPI/NZL.CPI._T.YOY_PCH_PA_PT.Q", frequency: "quarterly", kind: "level", transform: "none",
    label: "CPI, all items", basis: "y/y, % (published by the IMF)", decimals: 1, provider: "International Monetary Fund (CPI dataset, from national statistics)",
    attribution: "Source: International Monetary Fund, Consumer Price Index (IMF.STA:CPI), compiled from national statistics",
    licenceNote: NOT_AUDITED, lag: QUARTERLY_AU_CPI },
  { ...direct("fred"), id: "nz.unemp", economy: "NZ", indicator: "unemployment", code: "LRHUTTTTNZQ156S", frequency: "quarterly", kind: "level", transform: "none",
    label: "Unemployment rate, 15+ (harmonised, quarterly)", basis: "level, %", decimals: 1, provider: "OECD harmonised unemployment, via FRED (Federal Reserve Bank of St. Louis)",
    attribution: "Source: Organisation for Economic Co-operation and Development (Infra-annual labour statistics), retrieved from FRED, Federal Reserve Bank of St. Louis",
    licenceNote: NOT_AUDITED, lag: QUARTERLY_LABOUR },

  // ── Switzerland: SNB data portal, FRED ──
  { ...direct("snb"), id: "ch.policy", economy: "CH", indicator: "policy_rate", code: "snbgwdzid:LZ", frequency: "daily", kind: "level", transform: "none",
    label: "SNB policy rate", basis: "level, %", decimals: 2, provider: "Swiss National Bank",
    attribution: "Source: Swiss National Bank, data portal (SNB policy rate)",
    licenceNote: NOT_AUDITED, lag: SNB_POLICY },
  { ...direct("snb"), id: "ch.cpi", economy: "CH", indicator: "cpi_yoy", code: "plkoprinfla:TLK", frequency: "monthly", kind: "level", transform: "none",
    label: "Inflation, national consumer price index", basis: "y/y, % (published)", decimals: 1, provider: "Swiss Federal Statistical Office, via the SNB data portal",
    attribution: "Source: Swiss Federal Statistical Office, published through the Swiss National Bank data portal",
    licenceNote: NOT_AUDITED, lag: MONTHLY },
  { ...direct("snb"), id: "ch.core", economy: "CH", indicator: "core_cpi_yoy", code: "plkoprinfla:KGM", frequency: "monthly", kind: "level", transform: "none",
    label: "Core inflation, trimmed mean (SNB)", basis: "y/y, % (SNB calculation)", decimals: 1, provider: "Swiss National Bank",
    attribution: "Source: Swiss National Bank, data portal (core inflation, trimmed mean)",
    licenceNote: NOT_AUDITED, lag: MONTHLY },
  { ...direct("fred"), id: "ch.gdp", economy: "CH", indicator: "gdp_growth", code: "CLVMNACSCAB1GQCH", frequency: "quarterly", kind: "level", transform: "yoy",
    label: "Real GDP growth", basis: "y/y, % (computed from chain-linked volumes)", decimals: 1, provider: "Eurostat national accounts, via FRED (Federal Reserve Bank of St. Louis)",
    attribution: "Source: Eurostat (real GDP, chain-linked volumes), retrieved from FRED, Federal Reserve Bank of St. Louis. Year-on-year change computed by this terminal",
    licenceNote: NOT_AUDITED, valueNote: "computed from chain-linked volumes (levels, not rounded): matches the official y/y to the displayed decimal",
    lag: { days: 160, basis: "observation", why: "GDP ~60 days after quarter end, then republished by Eurostat/FRED: up to ~160 days old before the next one" } },
  { ...direct("fred"), id: "ch.unemp", economy: "CH", indicator: "unemployment", code: "LRHUTTTTCHQ156S", frequency: "quarterly", kind: "level", transform: "none",
    label: "Unemployment rate, 15+ (harmonised, quarterly)", basis: "level, %", decimals: 1, provider: "OECD harmonised unemployment, via FRED (Federal Reserve Bank of St. Louis)",
    attribution: "Source: Organisation for Economic Co-operation and Development (Infra-annual labour statistics), retrieved from FRED, Federal Reserve Bank of St. Louis",
    licenceNote: NOT_AUDITED, lag: QUARTERLY_LABOUR },
];


export const SERIES_BY_ID: Record<string, SeriesDef> = Object.fromEntries(SERIES.map((s) => [s.id, s]));

// ───────────── Coverage gaps (checked against live queries on 2026-10-09) ─────────────

type GapSpec = Omit<GapRow, "economy" | "indicator">;
const no = (reason: string): GapSpec => ({ kind: "no_series", reason });
const notPinned = (reason: string): GapSpec => ({ kind: "not_pinned", reason });

const OECD_BLOCKED = "The OECD SDMX API (sdmx.oecd.org) answered a Cloudflare bot challenge (HTTP 403) from this network on 2026-10-09; this terminal does not bypass bot challenges.";
const OUT_OF_SCOPE = "Outside the cells covered in this step; no endpoint was evaluated for it.";

/** Cells that have no series, with the reason. Cells with a series that is currently unavailable are reported by the page from the live error instead. */
export const KNOWN_GAPS: Partial<Record<Economy, Partial<Record<Indicator, GapSpec>>>> = {
  US: {
    core_cpi_yoy: notPinned("BLS core CPI (CUUR0000SA0L1E) could be served by the same BLS adapter; not wired in this step."),
  },
  EA: {
    core_cpi_yoy: notPinned("Eurostat publishes core HICP (excluding energy, food, alcohol and tobacco) in the same dataset as headline HICP; not wired in this step."),
  },
  UK: {
    core_cpi_yoy: notPinned("ONS publishes a core CPI series, but its code was not pinned and verified."),
    yield_10y: no("No 10-year gilt yield series was found on DBnomics, and no other endpoint was evaluated in this step."),
  },
  JP: {
    gdp_growth: no(`No keyless Cabinet Office GDP endpoint was found. ${OECD_BLOCKED}`),
    yield_10y: no(`No keyless 10-year JGB yield endpoint was found. ${OECD_BLOCKED}`),
  },
  CA: {
    core_cpi_yoy: notPinned("Statistics Canada publishes CPI-trim and CPI-median through the same vector API as headline CPI; not wired in this step."),
    gdp_growth: notPinned("Statistics Canada table 36100104 is on its vector API, but the series was not pinned and verified."),
    yield_10y: no("No 10-year yield series was found on DBnomics, and no other endpoint was evaluated in this step."),
  },
  AU: {},
  NZ: {
    core_cpi_yoy: no(OUT_OF_SCOPE),
    gdp_growth: no(`No fresh source: the IMF national-accounts dataset and FRED (OECD) both end with Q1 2026 (about 190 days old, over the 160-day rule); the Stats NZ API answered HTTP 502 and the RBNZ file server HTTP 403. ${OECD_BLOCKED}`),
    yield_10y: no(OUT_OF_SCOPE),
  },
  CH: {
    yield_10y: no(OUT_OF_SCOPE),
  },
};

/** Static reason for a cell with no series. */
export function knownGap(economy: Economy, indicator: Indicator): GapSpec {
  return KNOWN_GAPS[economy]?.[indicator] ?? no("No free, fresh series was found for this cell.");
}

export const STALE_RULE_TEXT =
  "Each series has an expected lag: the worst-case normal age of its latest observation (period length plus publication delay). "
  + "Older than that, the row is flagged STALE and stays in the table. Older than twice the lag, it leaves the table and appears under Coverage gaps. "
  + "Step-series policy rates that are mirrored by DBnomics are judged by when the aggregator last refreshed them rather than by the date of the last decision; policy rates fetched directly are daily series, judged by the date of their latest observation.";
