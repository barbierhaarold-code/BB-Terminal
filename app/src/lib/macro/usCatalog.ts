import type { ChartTransform, Headline, LagRule, SeriesDef, Topic, Unit } from "./types";
import { FRED_CR, FRED_PD, fredAttribution } from "./config";

// ────────────────────────────────────────────────────────────
// United States, deep coverage. Every FRED id below was verified against the FRED API on 2026-10-13
// (series exists, frequency, seasonal adjustment, last observation, FRED copyright tag, release id).
// Copyright policy: series tagged "public domain: citation requested" or "copyrighted: citation required"
// are used with the citation; series whose FRED notes say "Reprinted with permission" (University of
// Michigan, National Association of Realtors) are restricted to FRED itself and are NOT used — they are
// listed as coverage gaps instead (see US_GAPS).
//
// DESCRIPTIVE data only: nothing here forecasts, scores or colours a value.
// ────────────────────────────────────────────────────────────

const lag = (days: number, why: string): LagRule => ({ days, basis: "observation", why });
const DAILY = lag(7, "daily series: a weekend plus a holiday, plus FRED's update delay");
const WEEKLY_CLAIMS = lag(16, "weekly, published the Thursday after the week ends: up to ~16 days old before the next one");
const WEEKLY_CONTINUING = lag(23, "weekly, published 12 days after the week ends (one week after initial claims for the same week): up to ~23 days old before the next one");
const WEEKLY_H41 = lag(10, "Wednesday levels published on Thursday: up to ~10 days old before the next one");
const WEEKLY_H8 = lag(18, "weekly H.8, published on Friday about 9 days after the Wednesday it describes");
const MONTHLY = lag(55, "monthly release about 2–4 weeks after month end: up to ~55 days old before the next one");
const MONTHLY_LATE = lag(75, "monthly release about 5–6 weeks after month end: up to ~75 days old before the next one");
const MONTHLY_SURVEY = lag(45, "regional survey published in the month it describes: up to ~45 days old before the next one");
const QUARTERLY_GDP = lag(125, "advance estimate ~30 days after quarter end: up to ~125 days old before the next one");
const QUARTERLY_LATE = lag(175, "quarterly, published 2–3 months after quarter end: up to ~175 days old before the next one");

const BLS = "U.S. Bureau of Labor Statistics";
const BEA = "U.S. Bureau of Economic Analysis";
const CENSUS = "U.S. Census Bureau";
const BOARD = "Board of Governors of the Federal Reserve System";
const NYFED = "Federal Reserve Bank of New York";
const STL = "Federal Reserve Bank of St. Louis";
const ETA = "U.S. Employment and Training Administration";
const TREASURY = "U.S. Department of the Treasury, Bureau of the Fiscal Service";

interface F {
  id: string; code: string; name: string; label: string; basis: string; topic: Topic; agency: string; provider?: string;
  frequency: SeriesDef["frequency"]; transform?: Headline; unit: Unit; sourceUnit?: Unit; decimals: number; lag: LagRule;
  licence?: "pd" | "cr"; chart?: ChartTransform[]; related?: string[]; explain?: string; reaction?: boolean; vintages?: boolean; valueNote?: string;
  computedNote?: string;
}

const COMPUTED: Record<Headline, string | undefined> = {
  none: undefined,
  yoy: "Year-on-year change computed by this terminal",
  mom: "Period-on-period % change computed by this terminal",
  diff: "Change versus the previous period computed by this terminal",
};

/** A FRED-sourced US series. */
function fred(f: F): SeriesDef {
  const transform = f.transform ?? "none";
  return {
    id: f.id, economy: "US", indicator: null, adapter: "fred", code: f.code, frequency: f.frequency, kind: "level", transform,
    label: f.label, basis: f.basis, unit: f.unit, decimals: f.decimals, name: f.name, topic: f.topic, agency: f.agency,
    provider: f.provider ?? `${f.agency}, via FRED`,
    attribution: fredAttribution(f.agency, f.code, f.computedNote ?? COMPUTED[transform]),
    licenceNote: f.licence === "cr" ? FRED_CR : FRED_PD,
    valueNote: f.valueNote, lag: f.lag, sourceUnit: f.sourceUnit, chart: f.chart ?? ["level"], related: f.related, explain: f.explain ?? f.id,
    reaction: f.reaction, vintages: f.vintages,
  };
}

const PRICE_CHART: ChartTransform[] = ["yoy", "mom", "ann3m", "level"];

export const US_SERIES: SeriesDef[] = [
  // ───────── Inflation ─────────
  fred({ id: "us.cpi_sa", code: "CPIAUCSL", name: "CPI, headline (m/m)", label: "CPI-U, all items, seasonally adjusted", basis: "m/m, % (computed from the SA index)", topic: "inflation", agency: BLS,
    frequency: "monthly", transform: "mom", unit: "%", sourceUnit: "index", decimals: 1, lag: MONTHLY, chart: PRICE_CHART, reaction: true, explain: "us.cpi",
    related: ["us.cpi", "us.core_sa", "us.pce", "us.ppi"] }),
  fred({ id: "us.core_sa", code: "CPILFESL", name: "CPI, core (m/m)", label: "CPI-U less food and energy, seasonally adjusted", basis: "m/m, % (computed from the SA index)", topic: "inflation", agency: BLS,
    frequency: "monthly", transform: "mom", unit: "%", sourceUnit: "index", decimals: 1, lag: MONTHLY, chart: PRICE_CHART, reaction: true, explain: "us.core",
    related: ["us.core", "us.cpi_sa", "us.pcecore", "us.ppicore"] }),
  fred({ id: "us.pce", code: "PCEPI", name: "PCE price index", label: "PCE chain-type price index", basis: "y/y, % (computed from the index)", topic: "inflation", agency: BEA,
    frequency: "monthly", transform: "yoy", unit: "%", sourceUnit: "index", decimals: 1, lag: MONTHLY_LATE, chart: PRICE_CHART, reaction: true,
    related: ["us.pcecore", "us.cpi", "us.policy", "us.be5"] }),
  fred({ id: "us.pcecore", code: "PCEPILFE", name: "Core PCE price index", label: "PCE price index excluding food and energy", basis: "y/y, % (computed from the index)", topic: "inflation", agency: BEA,
    frequency: "monthly", transform: "yoy", unit: "%", sourceUnit: "index", decimals: 1, lag: MONTHLY_LATE, chart: PRICE_CHART, reaction: true,
    related: ["us.pce", "us.core", "us.policy", "us.eci"] }),
  fred({ id: "us.ppi", code: "PPIFIS", name: "PPI, final demand", label: "Producer Price Index by commodity: final demand, seasonally adjusted", basis: "y/y, % (computed from the SA index)", topic: "inflation", agency: BLS,
    frequency: "monthly", transform: "yoy", unit: "%", sourceUnit: "index", decimals: 1, lag: MONTHLY, chart: PRICE_CHART, reaction: true,
    valueNote: "computed from the seasonally adjusted index; BLS's own 12-month change uses the unadjusted index and can differ by about 0.1 pp",
    related: ["us.ppicore", "us.cpi", "us.importpx"] }),
  fred({ id: "us.ppicore", code: "PPICOR", name: "PPI, final demand less food and energy", label: "PPI final demand less foods and energy (not seasonally adjusted)", basis: "y/y, % (computed from the index)", topic: "inflation", agency: BLS,
    frequency: "monthly", transform: "yoy", unit: "%", sourceUnit: "index", decimals: 1, lag: MONTHLY, chart: ["yoy", "level"], explain: "us.ppi",
    related: ["us.ppi", "us.core", "us.pcecore"] }),
  fred({ id: "us.importpx", code: "IR", name: "Import prices", label: "Import price index (end use), all commodities (not seasonally adjusted)", basis: "y/y, % (computed from the index)", topic: "inflation", agency: BLS,
    frequency: "monthly", transform: "yoy", unit: "%", sourceUnit: "index", decimals: 1, lag: MONTHLY, chart: ["yoy", "mom", "level"],
    related: ["us.ppi", "us.cpi", "us.trade"] }),
  fred({ id: "us.ahe", code: "CES0500000003", name: "Average hourly earnings", label: "Average hourly earnings of all employees, total private, seasonally adjusted", basis: "y/y, % (computed from $ per hour)", topic: "inflation", agency: BLS,
    frequency: "monthly", transform: "yoy", unit: "%", sourceUnit: "usd_hr", decimals: 1, lag: MONTHLY, chart: ["yoy", "mom", "ann3m", "level"], reaction: true,
    related: ["us.eci", "us.payrolls", "us.unemp", "us.core"] }),
  fred({ id: "us.eci", code: "ECIALLCIV", name: "Employment Cost Index", label: "ECI, total compensation, all civilian workers, seasonally adjusted", basis: "q/q, % (computed from the index)", topic: "inflation", agency: BLS,
    frequency: "quarterly", transform: "mom", unit: "%", sourceUnit: "index", decimals: 1, lag: lag(125, "quarterly, published about 1 month after the quarter: up to ~125 days old"), chart: ["mom", "yoy", "level"],
    related: ["us.ahe", "us.pcecore", "us.unemp"] }),
  {
    id: "us.sce1y", economy: "US", indicator: null, adapter: "nyfedsce", code: "Inflation expectations:B", frequency: "monthly", kind: "level", transform: "none",
    label: "Median one-year-ahead expected inflation rate (Survey of Consumer Expectations)", basis: "level, % (survey median)", unit: "%", decimals: 1, name: "Consumer inflation expectations, 1 year (NY Fed SCE)",
    topic: "inflation", agency: NYFED, provider: "Federal Reserve Bank of New York (Survey of Consumer Expectations)",
    attribution: "Source: Survey of Consumer Expectations, © 2013–2026 Federal Reserve Bank of New York (FRBNY). The SCE data are available without charge at http://www.newyorkfed.org/microeconomics/sce and may be used subject to license terms posted there. FRBNY disclaims any responsibility for this analysis and interpretation of Survey of Consumer Expectations data",
    licenceNote: "FRBNY SCE licence: reproduction and redistribution permitted with this attribution; no endorsement implied.", lag: MONTHLY, chart: ["level"], explain: "us.sce", vintages: false,
    related: ["us.sce3y", "us.be5", "us.cpi"], calendar: { url: "https://www.newyorkfed.org/microeconomics/sce", label: "NY Fed Survey of Consumer Expectations (release schedule on the page)" },
  },
  {
    id: "us.sce3y", economy: "US", indicator: null, adapter: "nyfedsce", code: "Inflation expectations:C", frequency: "monthly", kind: "level", transform: "none",
    label: "Median three-year-ahead expected inflation rate (Survey of Consumer Expectations)", basis: "level, % (survey median)", unit: "%", decimals: 1, name: "Consumer inflation expectations, 3 years (NY Fed SCE)",
    topic: "inflation", agency: NYFED, provider: "Federal Reserve Bank of New York (Survey of Consumer Expectations)",
    attribution: "Source: Survey of Consumer Expectations, © 2013–2026 Federal Reserve Bank of New York (FRBNY). The SCE data are available without charge at http://www.newyorkfed.org/microeconomics/sce and may be used subject to license terms posted there. FRBNY disclaims any responsibility for this analysis and interpretation of Survey of Consumer Expectations data",
    licenceNote: "FRBNY SCE licence: reproduction and redistribution permitted with this attribution; no endorsement implied.", lag: MONTHLY, chart: ["level"], explain: "us.sce", vintages: false,
    related: ["us.sce1y", "us.be10", "us.cpi"], calendar: { url: "https://www.newyorkfed.org/microeconomics/sce", label: "NY Fed Survey of Consumer Expectations (release schedule on the page)" },
  },
  fred({ id: "us.be5", code: "T5YIE", name: "5-year breakeven inflation", label: "5-year breakeven inflation rate (nominal minus TIPS yield)", basis: "level, % (computed by FRED from H.15 yields)", topic: "inflation", agency: STL,
    provider: "Federal Reserve Bank of St. Louis (from Board H.15 yields), via FRED", frequency: "daily", unit: "%", decimals: 2, lag: DAILY, licence: "cr", vintages: false, chart: ["level", "diff"], explain: "us.breakeven",
    related: ["us.be10", "us.y5", "us.sce3y", "us.cpi"] }),
  fred({ id: "us.be10", code: "T10YIE", name: "10-year breakeven inflation", label: "10-year breakeven inflation rate (nominal minus TIPS yield)", basis: "level, % (computed by FRED from H.15 yields)", topic: "inflation", agency: STL,
    provider: "Federal Reserve Bank of St. Louis (from Board H.15 yields), via FRED", frequency: "daily", unit: "%", decimals: 2, lag: DAILY, licence: "cr", vintages: false, chart: ["level", "diff"], explain: "us.breakeven",
    related: ["us.be5", "us.y10", "us.tips10"] }),

  // ───────── Labour ─────────
  fred({ id: "us.payrolls", code: "PAYEMS", name: "Nonfarm payrolls (monthly change)", label: "All employees, total nonfarm, seasonally adjusted", basis: "monthly change, thousands (computed from the level)", topic: "labour", agency: BLS,
    frequency: "monthly", transform: "diff", unit: "k", sourceUnit: "k", decimals: 0, lag: MONTHLY, chart: ["diff", "level", "yoy"], reaction: true,
    related: ["us.unemp", "us.ahe", "us.claims", "us.jolts", "us.lfpr"] }),
  fred({ id: "us.u6", code: "U6RATE", name: "U-6 underemployment rate", label: "Total unemployed plus marginally attached plus part-time for economic reasons, seasonally adjusted", basis: "level, % of labour force plus marginally attached", topic: "labour", agency: BLS,
    frequency: "monthly", unit: "%", decimals: 1, lag: MONTHLY, chart: ["level", "diff"], related: ["us.unemp", "us.lfpr", "us.payrolls"] }),
  fred({ id: "us.lfpr", code: "CIVPART", name: "Labour force participation rate", label: "Labor force participation rate, seasonally adjusted", basis: "level, % of civilian population 16+", topic: "labour", agency: BLS,
    frequency: "monthly", unit: "%", decimals: 1, lag: MONTHLY, chart: ["level", "diff"], related: ["us.unemp", "us.u6", "us.payrolls"] }),
  fred({ id: "us.claims", code: "ICSA", name: "Initial jobless claims", label: "Initial claims for unemployment insurance, seasonally adjusted (week ending)", basis: "level, persons per week", topic: "labour", agency: ETA,
    frequency: "weekly", unit: "persons", decimals: 0, lag: WEEKLY_CLAIMS, chart: ["level", "yoy"], reaction: true,
    related: ["us.ccl", "us.payrolls", "us.unemp"] }),
  fred({ id: "us.ccl", code: "CCSA", name: "Continuing jobless claims", label: "Continued claims (insured unemployment), seasonally adjusted (week ending)", basis: "level, persons", topic: "labour", agency: ETA,
    frequency: "weekly", unit: "persons", decimals: 0, lag: WEEKLY_CONTINUING, chart: ["level", "yoy"], explain: "us.claims", related: ["us.claims", "us.unemp"] }),
  fred({ id: "us.jolts", code: "JTSJOL", name: "JOLTS job openings", label: "Job openings, total nonfarm, seasonally adjusted", basis: "level, thousands", topic: "labour", agency: BLS,
    frequency: "monthly", unit: "k", decimals: 0, lag: MONTHLY_LATE, chart: ["level", "diff", "yoy"], reaction: true, related: ["us.quits", "us.unemp", "us.payrolls"] }),
  fred({ id: "us.quits", code: "JTSQUR", name: "JOLTS quits rate", label: "Quits rate, total nonfarm, seasonally adjusted", basis: "level, % of employment", topic: "labour", agency: BLS,
    frequency: "monthly", unit: "%", decimals: 1, lag: MONTHLY_LATE, chart: ["level", "diff"], explain: "us.jolts", related: ["us.jolts", "us.ahe", "us.eci"] }),

  // ───────── Growth ─────────
  fred({ id: "us.gdp_pce", code: "DPCERY2Q224SBEA", name: "GDP contribution: consumer spending", label: "Contribution of personal consumption expenditures to real GDP growth", basis: "percentage points, annual rate", topic: "growth", agency: BEA,
    frequency: "quarterly", unit: "pp", decimals: 2, lag: QUARTERLY_GDP, explain: "us.gdp_contrib", related: ["us.gdp", "us.gdp_inv", "us.gdp_nx", "us.gdp_gov", "us.retail"] }),
  fred({ id: "us.gdp_inv", code: "A006RY2Q224SBEA", name: "GDP contribution: private investment", label: "Contribution of gross private domestic investment to real GDP growth", basis: "percentage points, annual rate", topic: "growth", agency: BEA,
    frequency: "quarterly", unit: "pp", decimals: 2, lag: QUARTERLY_GDP, explain: "us.gdp_contrib", related: ["us.gdp", "us.gdp_pce", "us.coreorders", "us.starts"] }),
  fred({ id: "us.gdp_nx", code: "A019RY2Q224SBEA", name: "GDP contribution: net exports", label: "Contribution of net exports of goods and services to real GDP growth", basis: "percentage points, annual rate", topic: "growth", agency: BEA,
    frequency: "quarterly", unit: "pp", decimals: 2, lag: QUARTERLY_GDP, explain: "us.gdp_contrib", related: ["us.gdp", "us.trade", "us.importpx"] }),
  fred({ id: "us.gdp_gov", code: "A822RY2Q224SBEA", name: "GDP contribution: government", label: "Contribution of government consumption expenditures and gross investment to real GDP growth", basis: "percentage points, annual rate", topic: "growth", agency: BEA,
    frequency: "quarterly", unit: "pp", decimals: 2, lag: QUARTERLY_GDP, explain: "us.gdp_contrib", related: ["us.gdp", "us.deficit"] }),
  fred({ id: "us.gdpnow", code: "GDPNOW", name: "Atlanta Fed GDPNow", label: "GDPNow model estimate of real GDP growth for the quarter shown", basis: "q/q, seasonally adjusted annual rate, % (model nowcast, not an official estimate)", topic: "growth",
    agency: "Federal Reserve Bank of Atlanta", frequency: "quarterly", unit: "%", decimals: 1, licence: "cr", vintages: true,
    lag: lag(125, "the nowcast for a quarter is updated several times a month until BEA's advance estimate"), valueNote: "model nowcast for the quarter shown; updated several times a month (see revisions)",
    related: ["us.gdp", "us.retail", "us.indpro"] }),
  fred({ id: "us.retail", code: "RSAFS", name: "Retail sales (m/m)", label: "Advance retail sales: retail trade and food services, seasonally adjusted", basis: "m/m, % (computed from $ millions, nominal)", topic: "growth", agency: CENSUS,
    frequency: "monthly", transform: "mom", unit: "%", sourceUnit: "usd_mn", decimals: 1, lag: MONTHLY, chart: ["mom", "yoy", "level"], reaction: true,
    related: ["us.gdp_pce", "us.cpi", "us.conscredit"] }),
  fred({ id: "us.indpro", code: "INDPRO", name: "Industrial production (m/m)", label: "Industrial production, total index, seasonally adjusted", basis: "m/m, % (computed from the index)", topic: "growth", agency: BOARD,
    frequency: "monthly", transform: "mom", unit: "%", sourceUnit: "index", decimals: 1, lag: MONTHLY, chart: ["mom", "yoy", "level"], reaction: true,
    related: ["us.tcu", "us.durables", "us.empire", "us.philly"] }),
  fred({ id: "us.tcu", code: "TCU", name: "Capacity utilisation", label: "Capacity utilization, total index, seasonally adjusted", basis: "level, % of capacity", topic: "growth", agency: BOARD,
    frequency: "monthly", unit: "%", decimals: 1, lag: MONTHLY, chart: ["level", "diff"], explain: "us.indpro", related: ["us.indpro", "us.ppi"] }),
  fred({ id: "us.durables", code: "DGORDER", name: "Durable goods orders (m/m)", label: "Manufacturers' new orders: durable goods, seasonally adjusted", basis: "m/m, % (computed from $ millions, nominal)", topic: "growth", agency: CENSUS,
    frequency: "monthly", transform: "mom", unit: "%", sourceUnit: "usd_mn", decimals: 1, lag: MONTHLY_LATE, chart: ["mom", "yoy", "level"],
    related: ["us.coreorders", "us.indpro", "us.gdp_inv"] }),
  fred({ id: "us.coreorders", code: "NEWORDER", name: "Core capital goods orders (m/m)", label: "Manufacturers' new orders: nondefense capital goods excluding aircraft, seasonally adjusted", basis: "m/m, % (computed from $ millions, nominal)", topic: "growth", agency: CENSUS,
    frequency: "monthly", transform: "mom", unit: "%", sourceUnit: "usd_mn", decimals: 1, lag: MONTHLY_LATE, chart: ["mom", "yoy", "level"], explain: "us.durables",
    related: ["us.durables", "us.gdp_inv"] }),
  fred({ id: "us.starts", code: "HOUST", name: "Housing starts", label: "New privately-owned housing units started, total, seasonally adjusted annual rate", basis: "level, thousands of units (annual rate)", topic: "growth", agency: CENSUS,
    frequency: "monthly", unit: "k", decimals: 0, lag: MONTHLY, chart: ["level", "mom", "yoy"], related: ["us.permits", "us.newhomes", "us.dq_mort", "us.y10"] }),
  fred({ id: "us.permits", code: "PERMIT", name: "Building permits", label: "New privately-owned housing units authorized in permit-issuing places, seasonally adjusted annual rate", basis: "level, thousands of units (annual rate)", topic: "growth", agency: CENSUS,
    frequency: "monthly", unit: "k", decimals: 0, lag: MONTHLY, chart: ["level", "mom", "yoy"], explain: "us.starts", related: ["us.starts", "us.newhomes"] }),
  fred({ id: "us.newhomes", code: "HSN1F", name: "New home sales", label: "New one-family houses sold, seasonally adjusted annual rate", basis: "level, thousands (annual rate)", topic: "growth", agency: CENSUS,
    frequency: "monthly", unit: "k", decimals: 0, lag: MONTHLY_LATE, chart: ["level", "mom", "yoy"], related: ["us.starts", "us.permits", "us.y10"] }),
  fred({ id: "us.trade", code: "BOPGSTB", name: "Trade balance", label: "Trade balance: goods and services, balance of payments basis, seasonally adjusted", basis: "level, $ (monthly, nominal)", topic: "fiscal", agency: `${BEA} and ${CENSUS}`,
    frequency: "monthly", unit: "usd_mn", decimals: 1, lag: MONTHLY_LATE, chart: ["level", "diff"], related: ["us.ca", "us.gdp_nx", "us.importpx"] }),

  // ───────── Money and credit ─────────
  fred({ id: "us.m2", code: "M2SL", name: "M2 money stock", label: "M2, seasonally adjusted (H.6)", basis: "y/y, % (computed from $ billions)", topic: "money", agency: BOARD,
    frequency: "monthly", transform: "yoy", unit: "%", sourceUnit: "usd_bn", decimals: 1, lag: MONTHLY, chart: ["yoy", "level", "ann3m"], related: ["us.fedassets", "us.bankcredit", "us.reserves"] }),
  fred({ id: "us.fedassets", code: "WALCL", name: "Fed balance sheet (total assets)", label: "Federal Reserve total assets (less eliminations from consolidation), Wednesday level (H.4.1)", basis: "level, $", topic: "money", agency: BOARD,
    frequency: "weekly", unit: "usd_mn", decimals: 1, lag: WEEKLY_H41, chart: ["level", "diff", "yoy"], related: ["us.reserves", "us.rrp", "us.tga", "us.m2"] }),
  fred({ id: "us.reserves", code: "WRESBAL", name: "Reserve balances", label: "Reserve balances with Federal Reserve Banks, Wednesday level (H.4.1)", basis: "level, $", topic: "money", agency: BOARD,
    frequency: "weekly", unit: "usd_mn", decimals: 1, lag: WEEKLY_H41, chart: ["level", "diff"], explain: "us.fedassets", related: ["us.fedassets", "us.rrp", "us.tga", "us.iorb"] }),
  fred({ id: "us.rrp", code: "RRPONTSYD", name: "Overnight reverse repo (ON RRP)", label: "Overnight reverse repurchase agreements: Treasury securities sold by the Fed in temporary open market operations", basis: "level, $ (daily)", topic: "money", agency: NYFED,
    provider: "Federal Reserve Bank of New York, via FRED", frequency: "daily", unit: "usd_bn", decimals: 1, lag: DAILY, licence: "cr", vintages: false, chart: ["level", "diff"], explain: "us.fedassets",
    related: ["us.reserves", "us.fedassets", "us.sofr"] }),
  fred({ id: "us.bankcredit", code: "TOTBKCR", name: "Bank credit (H.8)", label: "Bank credit, all commercial banks, seasonally adjusted (H.8)", basis: "y/y, % (computed from $ billions, weekly)", topic: "money", agency: BOARD,
    frequency: "weekly", transform: "yoy", unit: "%", sourceUnit: "usd_bn", decimals: 1, lag: WEEKLY_H8, chart: ["yoy", "level"], related: ["us.conscredit", "us.m2", "us.dq_all"] }),
  fred({ id: "us.conscredit", code: "TOTALSL", name: "Consumer credit (G.19), monthly change", label: "Total consumer credit owned and securitized, seasonally adjusted (G.19)", basis: "monthly change, $ (computed from the level)", topic: "money", agency: BOARD,
    frequency: "monthly", transform: "diff", unit: "usd_mn", sourceUnit: "usd_mn", decimals: 1, lag: MONTHLY_LATE, chart: ["diff", "yoy", "level"], related: ["us.dq_cc", "us.retail", "us.bankcredit"] }),
  fred({ id: "us.dq_cc", code: "DRCCLACBS", name: "Delinquency rate: credit cards", label: "Delinquency rate on credit card loans, all commercial banks, seasonally adjusted", basis: "level, % of loans", topic: "money", agency: BOARD,
    frequency: "quarterly", unit: "%", decimals: 2, lag: QUARTERLY_LATE, chart: ["level", "diff"], explain: "us.delinquency", related: ["us.dq_mort", "us.dq_all", "us.conscredit"] }),
  fred({ id: "us.dq_mort", code: "DRSFRMACBS", name: "Delinquency rate: residential mortgages", label: "Delinquency rate on single-family residential mortgages, all commercial banks, seasonally adjusted", basis: "level, % of loans", topic: "money", agency: BOARD,
    frequency: "quarterly", unit: "%", decimals: 2, lag: QUARTERLY_LATE, chart: ["level", "diff"], explain: "us.delinquency", related: ["us.dq_cc", "us.dq_all", "us.starts"] }),
  fred({ id: "us.dq_all", code: "DRALACBS", name: "Delinquency rate: all loans", label: "Delinquency rate on all loans, all commercial banks, seasonally adjusted", basis: "level, % of loans", topic: "money", agency: BOARD,
    frequency: "quarterly", unit: "%", decimals: 2, lag: QUARTERLY_LATE, chart: ["level", "diff"], explain: "us.delinquency", related: ["us.dq_cc", "us.dq_mort", "us.bankcredit"] }),

  // ───────── Rates ─────────
  fred({ id: "us.fftl", code: "DFEDTARL", name: "Fed funds target range, lower limit", label: "Federal funds target range, lower limit", basis: "level, %", topic: "rates", agency: BOARD,
    frequency: "daily", unit: "%", decimals: 2, lag: DAILY, vintages: false, explain: "us.fedfunds_target", related: ["us.policy", "us.effr", "us.iorb"] }),
  fred({ id: "us.effr", code: "EFFR", name: "Effective federal funds rate", label: "Effective federal funds rate (volume-weighted median of overnight fed funds trades)", basis: "level, %", topic: "rates", agency: NYFED,
    provider: "Federal Reserve Bank of New York, via FRED", frequency: "daily", unit: "%", decimals: 2, lag: DAILY, licence: "cr", vintages: false, chart: ["level", "diff"],
    related: ["us.policy", "us.fftl", "us.sofr", "us.iorb"] }),
  fred({ id: "us.sofr", code: "SOFR", name: "SOFR", label: "Secured Overnight Financing Rate", basis: "level, %", topic: "rates", agency: NYFED,
    provider: "Federal Reserve Bank of New York, via FRED", frequency: "daily", unit: "%", decimals: 2, lag: DAILY, licence: "cr", vintages: false, chart: ["level", "diff"],
    related: ["us.effr", "us.rrp", "us.policy"] }),
  fred({ id: "us.iorb", code: "IORB", name: "Interest on reserve balances (IORB)", label: "Interest rate on reserve balances (administered rate)", basis: "level, %", topic: "rates", agency: BOARD,
    frequency: "daily", unit: "%", decimals: 2, lag: DAILY, vintages: false, explain: "us.fedfunds_target", related: ["us.policy", "us.effr", "us.reserves"] }),
  fred({ id: "us.y2", code: "DGS2", name: "2-year Treasury yield", label: "2-year Treasury constant maturity (H.15)", basis: "level, %", topic: "rates", agency: BOARD,
    provider: "Federal Reserve Board (H.15), via FRED", frequency: "daily", unit: "%", decimals: 2, lag: DAILY, vintages: false, chart: ["level", "diff"], explain: "us.treasury",
    related: ["us.policy", "us.y10", "us.s2s10", "us.y5"] }),
  fred({ id: "us.y5", code: "DGS5", name: "5-year Treasury yield", label: "5-year Treasury constant maturity (H.15)", basis: "level, %", topic: "rates", agency: BOARD,
    provider: "Federal Reserve Board (H.15), via FRED", frequency: "daily", unit: "%", decimals: 2, lag: DAILY, vintages: false, chart: ["level", "diff"], explain: "us.treasury",
    related: ["us.y2", "us.y10", "us.be5"] }),
  fred({ id: "us.y30", code: "DGS30", name: "30-year Treasury yield", label: "30-year Treasury constant maturity (H.15)", basis: "level, %", topic: "rates", agency: BOARD,
    provider: "Federal Reserve Board (H.15), via FRED", frequency: "daily", unit: "%", decimals: 2, lag: DAILY, vintages: false, chart: ["level", "diff"], explain: "us.treasury",
    related: ["us.y10", "us.tp10", "us.deficit"] }),
  fred({ id: "us.tips10", code: "DFII10", name: "10-year real yield (TIPS)", label: "10-year Treasury inflation-indexed constant maturity (H.15)", basis: "level, % (real)", topic: "rates", agency: BOARD,
    provider: "Federal Reserve Board (H.15), via FRED", frequency: "daily", unit: "%", decimals: 2, lag: DAILY, vintages: false, chart: ["level", "diff"],
    related: ["us.y10", "us.be10", "us.tp10"] }),
  fred({ id: "us.tp10", code: "THREEFYTP10", name: "10-year term premium (Kim-Wright, not ACM)", label: "Term premium on a 10-year zero-coupon bond, Kim-Wright three-factor model (Federal Reserve Board)", basis: "level, % (model estimate)", topic: "rates", agency: BOARD,
    frequency: "daily", unit: "%", decimals: 2, lag: lag(14, "model estimate updated weekly by the Board: up to ~14 days old"), vintages: false, chart: ["level", "diff"],
    valueNote: "Kim-Wright model (Board). This is NOT the NY Fed ACM term premium, which is listed under Coverage gaps",
    related: ["us.y10", "us.tips10", "us.be10"] }),
  fred({ id: "us.s2s10", code: "T10Y2Y", name: "2s10s curve spread", label: "10-year minus 2-year Treasury constant maturity", basis: "percentage points (computed by FRED from H.15)", topic: "rates", agency: STL,
    provider: "Federal Reserve Bank of St. Louis (from Board H.15 yields), via FRED", frequency: "daily", unit: "pp", decimals: 2, lag: DAILY, licence: "cr", vintages: false, chart: ["level", "diff"], explain: "us.curve",
    related: ["us.y2", "us.y10", "us.s3m10"] }),
  fred({ id: "us.s3m10", code: "T10Y3M", name: "3m10y curve spread", label: "10-year minus 3-month Treasury constant maturity", basis: "percentage points (computed by FRED from H.15)", topic: "rates", agency: STL,
    provider: "Federal Reserve Bank of St. Louis (from Board H.15 yields), via FRED", frequency: "daily", unit: "pp", decimals: 2, lag: DAILY, licence: "cr", vintages: false, chart: ["level", "diff"], explain: "us.curve",
    related: ["us.s2s10", "us.y10", "us.policy"] }),

  // ───────── Fiscal and external ─────────
  {
    id: "us.debt", economy: "US", indicator: null, adapter: "fiscaldata", code: "debt", frequency: "daily", kind: "level", transform: "none",
    label: "Total public debt outstanding (Debt to the Penny)", basis: "level, $", unit: "usd", decimals: 2, name: "Federal debt (Debt to the Penny)", topic: "fiscal", agency: TREASURY,
    provider: "U.S. Treasury, Bureau of the Fiscal Service (FiscalData API)", attribution: "Source: U.S. Department of the Treasury, Bureau of the Fiscal Service, Debt to the Penny (FiscalData API)",
    licenceNote: "U.S. federal government work: public domain (17 U.S.C. §105); FiscalData data are free to reuse.", lag: DAILY, chart: ["level", "diff", "yoy"], vintages: false, explain: "us.debt",
    related: ["us.deficit", "us.tga", "us.y30"], calendar: { url: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/", label: "FiscalData: Debt to the Penny (published each business day)" },
  },
  {
    id: "us.tga", economy: "US", indicator: null, adapter: "fiscaldata", code: "tga", frequency: "daily", kind: "level", transform: "none",
    label: "Treasury General Account closing balance (Daily Treasury Statement)", basis: "level, $", unit: "usd_mn", decimals: 1, name: "Treasury General Account (TGA)", topic: "fiscal", agency: TREASURY,
    provider: "U.S. Treasury, Bureau of the Fiscal Service (FiscalData API)", attribution: "Source: U.S. Department of the Treasury, Bureau of the Fiscal Service, Daily Treasury Statement, operating cash balance (FiscalData API)",
    licenceNote: "U.S. federal government work: public domain (17 U.S.C. §105); FiscalData data are free to reuse.", lag: DAILY, chart: ["level", "diff"], vintages: false, explain: "us.tga",
    related: ["us.reserves", "us.fedassets", "us.debt", "us.rrp"], calendar: { url: "https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/", label: "FiscalData: Daily Treasury Statement (published each business day at 4 pm ET)" },
  },
  fred({ id: "us.deficit", code: "MTSDS133FMS", name: "Federal surplus or deficit (monthly)", label: "Federal surplus or deficit [-], Monthly Treasury Statement (not seasonally adjusted)", basis: "level, $ (monthly flow)", topic: "fiscal", agency: TREASURY,
    frequency: "monthly", unit: "usd_mn", decimals: 1, lag: MONTHLY, chart: ["level"], related: ["us.debt", "us.tga", "us.gdp_gov"],
    valueNote: "a single month's flow, not seasonally adjusted: compare with the same month a year earlier, not with the previous month" }),
  fred({ id: "us.tic", code: "FORTREASNET99996", name: "TIC: foreign net purchases of Treasuries", label: "Foreign net transactions of U.S. long- and short-term Treasury securities, grand total (TIC)", basis: "level, $ (monthly flow)", topic: "fiscal",
    agency: "U.S. Department of the Treasury (Treasury International Capital system)", provider: "U.S. Treasury TIC (via the Federal Reserve Bank of New York), via FRED", frequency: "monthly", unit: "usd_mn", decimals: 1,
    lag: lag(80, "TIC data are published about 7 weeks after the month: up to ~80 days old"), chart: ["level"],
    valueNote: "FRED shows no copyright tag for this series; TIC is a U.S. Treasury publication (U.S. government work)", related: ["us.y10", "us.ca", "us.trade"] }),
  fred({ id: "us.ca", code: "IEABC", name: "Current account balance", label: "Balance on current account, seasonally adjusted (quarterly)", basis: "level, $ (quarterly flow)", topic: "fiscal", agency: BEA,
    frequency: "quarterly", unit: "usd_mn", decimals: 1, lag: QUARTERLY_LATE, chart: ["level", "diff"], related: ["us.trade", "us.tic", "us.gdp_nx"] }),
  {
    id: "us.auc10y", economy: "US", indicator: null, adapter: "fiscaldata", code: "auction10:high_yield", frequency: "daily", kind: "level", transform: "none",
    label: "10-year Treasury note auctions: high yield (new issues and reopenings; TIPS excluded)", basis: "level, % (one value per auction date)", unit: "%", decimals: 3, name: "10-year note auction: high yield", topic: "fiscal", agency: TREASURY,
    provider: "U.S. Treasury, Bureau of the Fiscal Service (FiscalData auctions API)", attribution: "Source: U.S. Department of the Treasury, Treasury Securities Auctions Data (FiscalData API)",
    licenceNote: "U.S. federal government work: public domain (17 U.S.C. §105); FiscalData data are free to reuse.", lag: lag(45, "10-year notes are auctioned about once a month (new issue or reopening)"), chart: ["level"], vintages: false,
    explain: "us.auction", related: ["us.auc10btc", "us.y10", "us.debt"], calendar: { url: "https://www.treasurydirect.gov/auctions/upcoming/", label: "TreasuryDirect: upcoming auctions" },
  },
  {
    id: "us.auc10btc", economy: "US", indicator: null, adapter: "fiscaldata", code: "auction10:bid_to_cover_ratio", frequency: "daily", kind: "level", transform: "none",
    label: "10-year Treasury note auctions: bid-to-cover ratio (new issues and reopenings; TIPS excluded)", basis: "ratio of bids tendered to amount accepted (one value per auction date)", unit: "ratio", decimals: 2, name: "10-year note auction: bid-to-cover", topic: "fiscal", agency: TREASURY,
    provider: "U.S. Treasury, Bureau of the Fiscal Service (FiscalData auctions API)", attribution: "Source: U.S. Department of the Treasury, Treasury Securities Auctions Data (FiscalData API)",
    licenceNote: "U.S. federal government work: public domain (17 U.S.C. §105); FiscalData data are free to reuse.", lag: lag(45, "10-year notes are auctioned about once a month (new issue or reopening)"), chart: ["level"], vintages: false,
    explain: "us.auction", related: ["us.auc10y", "us.y10"], calendar: { url: "https://www.treasurydirect.gov/auctions/upcoming/", label: "TreasuryDirect: upcoming auctions" },
  },

  // ───────── Regional Fed surveys ─────────
  fred({ id: "us.empire", code: "GACDISA066MSFRBNY", name: "Empire State Manufacturing Survey", label: "Current general business conditions, diffusion index, New York, seasonally adjusted", basis: "diffusion index (positive = more firms report improvement)", topic: "surveys", agency: NYFED,
    provider: "Federal Reserve Bank of New York, via FRED", frequency: "monthly", unit: "index", decimals: 1, lag: MONTHLY_SURVEY, licence: "cr", chart: ["level", "diff"], explain: "us.regional",
    related: ["us.philly", "us.dallas", "us.indpro"] }),
  fred({ id: "us.philly", code: "GACDFSA066MSFRBPHI", name: "Philadelphia Fed Manufacturing Business Outlook", label: "Current general activity, diffusion index, Third District, seasonally adjusted", basis: "diffusion index (positive = more firms report increase)", topic: "surveys", agency: "Federal Reserve Bank of Philadelphia",
    provider: "Federal Reserve Bank of Philadelphia, via FRED", frequency: "monthly", unit: "index", decimals: 1, lag: MONTHLY_SURVEY, licence: "cr", chart: ["level", "diff"], explain: "us.regional",
    related: ["us.empire", "us.dallas", "us.indpro"] }),
  fred({ id: "us.dallas", code: "BACTSAMFRBDAL", name: "Dallas Fed Texas Manufacturing Outlook", label: "Current general business activity, diffusion index, Texas, seasonally adjusted", basis: "diffusion index (positive = more firms report improvement)", topic: "surveys", agency: "Federal Reserve Bank of Dallas",
    provider: "Federal Reserve Bank of Dallas, via FRED", frequency: "monthly", unit: "index", decimals: 1, lag: MONTHLY_SURVEY, licence: "cr", chart: ["level", "diff"], explain: "us.regional",
    related: ["us.empire", "us.philly", "us.indpro"] }),
];

export const TOPICS: { id: Topic; name: string }[] = [
  { id: "inflation", name: "Inflation" }, { id: "labour", name: "Labour" }, { id: "growth", name: "Growth" },
  { id: "money", name: "Money and credit" }, { id: "rates", name: "Rates" }, { id: "fiscal", name: "Fiscal and external" },
  { id: "surveys", name: "Regional Fed surveys" },
];

/** Requested US series that are NOT shown, with the reason (feeds the Coverage gaps panel). */
export const US_GAPS: { name: string; reason: string }[] = [
  { name: "ISM Manufacturing and Services PMI", reason: "Proprietary (Institute for Supply Management); not free to redistribute. Not substituted." },
  { name: "S&P Global US PMI", reason: "Proprietary (S&P Global); paid. Not substituted." },
  { name: "Conference Board Consumer Confidence and Leading Economic Index", reason: "Proprietary (The Conference Board); paid. Not substituted." },
  { name: "University of Michigan consumer sentiment and inflation expectations (MICH)", reason: "FRED notes: \"Copyright … University of Michigan. Reprinted with permission.\" The permission is FRED's, not this terminal's. The NY Fed Survey of Consumer Expectations is shown instead, under its own name (it is a different survey, not a proxy)." },
  { name: "Existing home sales (EXHOSLUSM495S)", reason: "FRED notes: \"Copyright … National Association of Realtors. Reprinted with permission.\" Restricted to FRED; not used. New home sales (Census) are shown." },
  { name: "NY Fed ACM term premium", reason: "Published only as a ~10 MB legacy Excel (.xls, BIFF) workbook (the .csv link serves the same binary); this terminal has no parser for that format and does not scrape. The Federal Reserve Board's Kim-Wright term premium (THREEFYTP10) is shown and labelled as Kim-Wright, not ACM." },
  { name: "Richmond Fed Fifth District manufacturing survey", reason: "Not on FRED. The bank publishes it as a spreadsheet whose download link could only be found by scraping its HTML page; this terminal does not scrape." },
  { name: "Kansas City Fed Tenth District manufacturing survey", reason: "Not on FRED. kansascityfed.org did not answer requests carrying this terminal's User-Agent (connection timed out, 2026-10-13); not worked around." },
  { name: "Consensus forecasts (for surprises)", reason: "Market consensus forecasts are proprietary (Bloomberg, Reuters/LSEG, etc.); no free official source. Market-reaction measurements therefore group releases by the direction of the change versus the previous value, and say so." },
  { name: "DXY (ICE US Dollar Index)", reason: "ICE index, not free. Market-reaction measurements use the Federal Reserve Board's Nominal Broad U.S. Dollar Index (DTWEXBGS), labelled as a proxy." },
];

export const US_SERIES_BY_ID: Record<string, SeriesDef> = Object.fromEntries(US_SERIES.map((s) => [s.id, s]));
