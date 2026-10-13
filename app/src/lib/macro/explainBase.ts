// ────────────────────────────────────────────────────────────
// Explanations: shared types, glossary and shared US text. Static, reviewed, educational (written 2026-10-13).
// DESCRIPTIVE ONLY: what a series measures, how it is built, who publishes it and when, why markets
// follow it, how commentary has TYPICALLY read it, and common pitfalls. No predictions, no "expect X",
// no trade ideas, and nothing here is generated at run time. Claims about how markets actually reacted
// are never made here: the detail view's "Measured market reaction" section measures them from data
// (with n and a confidence interval) where free data allow, and says so where they do not.
// ────────────────────────────────────────────────────────────

export interface DocLink { title: string; url: string; kind: "release" | "methodology" | "central bank" | "calendar" | "data" }

export interface Explanation {
  measures: string;
  construction: string;
  schedule: string;
  whyMarkets: string;
  /** how the figure has typically been read; never a prediction */
  interpretation: { currency: string; rates: string; equities: string; gold: string };
  pitfalls: string[];
  glossary: GlossaryId[];
  /** official pages: agency release, methodology, central-bank publication (titles as the institution names them) */
  docs: DocLink[];
  /** Policy Feed items shown under "Official documents": institutions and a title pattern */
  feed?: { institutions: string[]; match: RegExp };
  /** official release calendar (always shown; the next date comes from FRED's calendar for US series when available) */
  calendar: { url: string; label: string };
}

export type GlossaryId =
  | "sa" | "nsa" | "yoy" | "mom" | "saar" | "base_effect" | "core" | "trimmed_mean" | "revision" | "first_print" | "vintage"
  | "diffusion" | "nowcast" | "chain" | "real_nominal" | "breakeven" | "term_premium" | "cmt" | "bp" | "pp"
  | "ilo" | "participation" | "reserves" | "rrp" | "tga" | "bid_to_cover" | "high_yield" | "nber" | "percentile" | "zscore"
  | "ci" | "proxy" | "policy_rate" | "par_yield" | "contribution" | "establishment_household";

export const GLOSSARY: Record<GlossaryId, { term: string; definition: string }> = {
  sa: { term: "Seasonally adjusted (SA)", definition: "Statistically corrected for the regular pattern that repeats every year (holidays, weather, school calendars), so consecutive months or quarters can be compared. Seasonal factors are re-estimated periodically, which revises past values." },
  nsa: { term: "Not seasonally adjusted (NSA)", definition: "The raw series. Year-on-year changes are usually computed on NSA data because comparing a month with the same month a year earlier already removes most seasonality." },
  yoy: { term: "Year-on-year (y/y)", definition: "Change versus the same period one year earlier, in percent. Smooth, but slow to show a turn, and sensitive to what happened a year ago (base effects)." },
  mom: { term: "Period-on-period (m/m, q/q)", definition: "Change versus the immediately preceding month or quarter, in percent. Timely but noisy; needs seasonally adjusted data." },
  saar: { term: "Seasonally adjusted annual rate (SAAR)", definition: "A monthly or quarterly figure scaled up to what it would be over a full year (for growth rates: compounded). US GDP growth and housing starts are quoted this way." },
  base_effect: { term: "Base effect", definition: "A year-on-year rate can move because of an unusual value a year earlier dropping out of the comparison, even if nothing changed this month." },
  core: { term: "Core measure", definition: "A price index that excludes volatile components (usually food and energy) to show the underlying trend. Definitions differ by country and agency." },
  trimmed_mean: { term: "Trimmed mean", definition: "An underlying-inflation measure that drops the components with the most extreme price changes each period (from both tails) and averages the rest." },
  revision: { term: "Revision", definition: "A later change to an already published value, as more complete data arrive or seasonal factors and benchmarks are updated." },
  first_print: { term: "First print", definition: "The value as first published on release day, before any revision. Markets react to the first print; history charts show the latest revised values." },
  vintage: { term: "Vintage", definition: "The whole series as it was known on a given date. ALFRED (archival FRED) keeps every vintage of many US series, which is how revisions are reconstructed here." },
  diffusion: { term: "Diffusion index", definition: "Share of survey respondents reporting an increase minus the share reporting a decrease. Positive means more firms report improvement than deterioration; it says nothing about the size of changes." },
  nowcast: { term: "Nowcast", definition: "A model estimate of the current quarter built from data already released. It is not an official statistic and changes as new data arrive." },
  chain: { term: "Chain-linked volumes", definition: "Real (inflation-adjusted) output measured with weights that are updated every year and linked together, expressed in the prices of a reference year." },
  real_nominal: { term: "Real vs nominal", definition: "Nominal values are in current prices; real values remove inflation. Retail sales and orders here are nominal; GDP growth is real." },
  breakeven: { term: "Breakeven inflation", definition: "Nominal Treasury yield minus the yield of an inflation-protected Treasury (TIPS) of the same maturity: the average inflation rate at which the two would return the same. It also contains liquidity and risk premia, so it is not a pure inflation forecast." },
  term_premium: { term: "Term premium", definition: "The extra yield investors require to hold a long bond rather than rolling short-term bills. It cannot be observed; it is estimated with models (Kim-Wright at the Fed Board, ACM at the NY Fed), and estimates differ." },
  cmt: { term: "Constant maturity yield", definition: "A yield interpolated from the Treasury yield curve at an exact maturity (2, 10, 30 years…), so the series does not jump when the benchmark bond changes." },
  bp: { term: "Basis point (bp)", definition: "One hundredth of a percentage point: a yield move from 4.00% to 4.07% is 7 bp." },
  pp: { term: "Percentage point (pp)", definition: "The arithmetic difference between two percentages (3.0% to 3.5% is +0.5 pp), as opposed to a percent change." },
  ilo: { term: "ILO unemployment", definition: "International Labour Organization definition: people without work, available to start, and who actively looked for work recently. Used by household surveys worldwide, so rates are broadly comparable across countries." },
  participation: { term: "Participation rate", definition: "Share of the working-age population that is either employed or unemployed (looking for work). Ageing and discouraged workers lower it." },
  reserves: { term: "Reserve balances", definition: "Deposits that banks hold at the Federal Reserve. They change when the Fed buys or sells securities and when money moves into the Treasury General Account or the reverse repo facility." },
  rrp: { term: "Overnight reverse repo (ON RRP)", definition: "A Fed facility where money funds and other eligible firms lend cash to the Fed overnight against Treasury collateral. Money parked there is not in bank reserves." },
  tga: { term: "Treasury General Account (TGA)", definition: "The US Treasury's cash account at the Federal Reserve. When it rises (tax receipts, debt issuance), bank reserves fall, all else equal; when the Treasury spends it down, reserves rise." },
  bid_to_cover: { term: "Bid-to-cover ratio", definition: "Total bids received at a Treasury auction divided by the amount sold. Commentators read it as a gauge of demand, but it moves with auction size and bidding rules." },
  high_yield: { term: "Auction high yield (stop-out)", definition: "The highest yield accepted at a Treasury auction; all winning competitive bidders receive this yield." },
  nber: { term: "NBER recession dates", definition: "The National Bureau of Economic Research's Business Cycle Dating Committee dates US peaks and troughs, usually many months after the fact. Shading here uses FRED's NBER-based monthly indicator (USREC)." },
  percentile: { term: "Percentile (in this view)", definition: "Share of observations in the stated window that are less than or equal to the latest value. 90% means only 10% of observations in that window were higher." },
  zscore: { term: "z-score", definition: "(latest − window mean) / window standard deviation: how many standard deviations the latest value sits from the window average. Descriptive only; macro series are not normally distributed." },
  ci: { term: "95% confidence interval", definition: "A range that would contain the true average effect in 95% of repeated samples, under the test's assumptions. If it contains zero, the measured difference is labelled \"not significant\"." },
  proxy: { term: "Proxy", definition: "A related series used in place of one that is not freely available, always labelled as such (for example the Fed's broad dollar index in place of the ICE DXY)." },
  policy_rate: { term: "Policy rate", definition: "The interest rate a central bank sets or targets to steer short-term market rates and, through them, financial conditions." },
  par_yield: { term: "Par yield", definition: "The coupon a bond would need to trade at exactly 100 (par). Central banks estimate par-yield curves from many bonds; it is not the yield of one specific bond." },
  contribution: { term: "Contribution to growth", definition: "How many percentage points of GDP growth come from one component (consumption, investment, net exports, government). The contributions add up, approximately, to total growth." },
  establishment_household: { term: "Establishment vs household survey", definition: "The US jobs report combines two surveys: a large survey of employers (payrolls, hours, earnings) and a survey of households (unemployment rate, participation). They can diverge from month to month." },
};

// ───────────── shared US pieces ─────────────

export const FED_POLICY_FEED = { institutions: ["Federal Reserve"], match: /FOMC statement|Minutes of the Federal Open Market Committee|release economic projections|Semiannual Monetary Policy Report/i };
export const BLS_CAL = { url: "https://www.bls.gov/schedule/news_release/", label: "BLS release calendar" };
export const BEA_CAL = { url: "https://www.bea.gov/news/schedule", label: "BEA release schedule" };
export const CENSUS_CAL = { url: "https://www.census.gov/economic-indicators/calendar-listview.html", label: "Census Bureau economic indicator calendar" };
export const FED_STATS_CAL = { url: "https://www.federalreserve.gov/data.htm", label: "Federal Reserve statistical releases (each release page lists its schedule)" };
export const FOMC_CAL = { url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", label: "FOMC meeting calendar (HTML only; no machine-readable schedule is published)" };
export const MPR: DocLink = { title: "Federal Reserve: Monetary Policy Report", url: "https://www.federalreserve.gov/monetarypolicy/publications/mpr_default.htm", kind: "central bank" };
export const FOMC_PAGE: DocLink = { title: "Federal Reserve: FOMC meeting calendars, statements and minutes", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", kind: "central bank" };
export const BEIGE: DocLink = { title: "Federal Reserve: Beige Book", url: "https://www.federalreserve.gov/monetarypolicy/publications/beige-book-default.htm", kind: "central bank" };

export const US_PRICES_INTERP = {
  currency: "Higher-than-anticipated inflation has typically been read as raising the odds of tighter Fed policy, which commentary links to a firmer dollar; softer readings the reverse.",
  rates: "Front-end yields (2-year) are the most directly tied to the expected path of the federal funds rate, so they have usually been the first place commentary looks after an inflation release.",
  equities: "Commentary usually frames hotter inflation as a headwind for equities through higher discount rates, especially for long-duration growth stocks; the reading depends on whether growth is also strong.",
  gold: "Gold has two competing readings: an inflation hedge on one side, and a non-yielding asset that suffers when real yields and the dollar rise on the other. Which dominates has varied over time.",
};
export const US_LABOUR_INTERP = {
  currency: "A stronger labour market has typically been read as supporting tighter Fed policy and a firmer dollar; a weaker one the reverse.",
  rates: "Jobs data feed directly into the Fed's maximum-employment mandate; commentary usually reads strength as pushing front-end yields up and weakness as pulling them down.",
  equities: "Readings are ambiguous: strong jobs support earnings but can imply tighter policy; weak jobs can imply easier policy but slower growth. Commentary often focuses on which of the two dominates at the time.",
  gold: "Usually read through the rates and dollar channel: data that lift real yields and the dollar have tended to be framed as a headwind for gold.",
};
export const US_GROWTH_INTERP = {
  currency: "Stronger activity data have typically been read as supportive for the dollar, through expectations of higher US rates relative to other economies.",
  rates: "Activity surprises mostly move expectations for the policy path and term premium; stronger data are usually read as pushing yields higher.",
  equities: "Commentary weighs better earnings prospects against the risk of tighter policy; in slowdowns, strong data are usually read positively, near full employment more ambiguously.",
  gold: "Mostly read through yields and the dollar, and through risk appetite in growth scares.",
};
export const US_MONEY_INTERP = {
  currency: "Balance-sheet and liquidity data are usually discussed as background conditions rather than as drivers of the dollar on release day.",
  rates: "Commentary watches reserves, reverse repo balances and the TGA for signs of funding pressure at the short end (repo rates relative to the Fed's administered rates).",
  equities: "Some market commentary links aggregate liquidity (Fed balance sheet minus TGA and reverse repo) to risk appetite; the relationship is debated and not stable.",
  gold: "Money growth and credit conditions are sometimes cited in longer-run discussions of gold; there is no reliable release-day link.",
};
export const US_RATES_INTERP = {
  currency: "Higher US yields relative to other economies have typically been associated in commentary with a firmer dollar, especially at the front end.",
  rates: "This is itself a rate: read it against the policy rate, the rest of the curve and inflation expectations.",
  equities: "Rising yields raise the discount rate applied to future earnings; commentary usually treats rapid rises as a headwind, particularly for long-duration growth stocks.",
  gold: "Gold, which pays no yield, has historically tended to move inversely to real (inflation-adjusted) yields, though that relationship has weakened at times.",
};


