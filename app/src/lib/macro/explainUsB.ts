import {
  BEA_CAL, BEIGE, CENSUS_CAL, FED_POLICY_FEED, FED_STATS_CAL, FOMC_CAL, FOMC_PAGE, MPR,
  US_GROWTH_INTERP, US_MONEY_INTERP, US_RATES_INTERP, type Explanation,
} from "./explainBase";

// United States: growth, money and credit, rates, fiscal and external, regional surveys
// (static, reviewed text; see explainBase.ts for the rules).

const BEA_GDP_FEED = { institutions: ["U.S. Bureau of Economic Analysis"], match: /\bGDP\b|Gross Domestic Product/i };
const CENSUS_FEED = (re: RegExp) => ({ institutions: ["U.S. Census Bureau"], match: re });
const FISCALDATA_CAL = { url: "https://fiscaldata.treasury.gov/release-calendar/", label: "FiscalData release calendar (U.S. Treasury)" };

export const US_EXPLAIN_B: Record<string, Explanation> = {
  // ═════════ growth ═════════
  "us.gdp": {
    measures: "The growth of US real (inflation-adjusted) gross domestic product versus the previous quarter, expressed as a seasonally adjusted annual rate.",
    construction: "Hard data assembled by the Bureau of Economic Analysis from many sources (retail and services surveys, trade data, construction spending, government accounts), in chained 2017 dollars. The advance estimate relies partly on BEA's own assumptions for missing source data and is revised in the second and third estimates and at annual updates.",
    schedule: "U.S. Bureau of Economic Analysis: advance estimate about four weeks after the quarter ends, then second and third estimates in the following two months, at 8:30 a.m. ET.",
    whyMarkets: "The broadest measure of the economy. Because many inputs are known beforehand (and nowcasts track it), its release-day news is often modest, but its composition (consumption, investment, trade, inventories) shapes the narrative.",
    interpretation: US_GROWTH_INTERP,
    pitfalls: [
      "Annualising a quarterly change multiplies noise by about four; a 0.5% quarter becomes roughly 2% annualised.",
      "Inventories and net exports swing growth sharply without saying much about underlying demand; final sales to private domestic purchasers is often used as a cleaner gauge.",
      "Revisions between advance and later estimates can exceed one percentage point (see the revisions section).",
      "Other economies quote GDP growth quarter-on-quarter (not annualised) or year-on-year, so headline numbers are not directly comparable.",
    ],
    glossary: ["saar", "chain", "real_nominal", "revision", "first_print", "contribution"],
    docs: [
      { title: "BEA: Gross Domestic Product", url: "https://www.bea.gov/data/gdp/gross-domestic-product", kind: "release" },
      { title: "BEA: NIPA Handbook (concepts and methods)", url: "https://www.bea.gov/resources/methodologies/nipa-handbook", kind: "methodology" },
      MPR,
    ],
    feed: BEA_GDP_FEED, calendar: BEA_CAL,
  },
  "us.gdp_contrib": {
    measures: "How many percentage points of annualised real GDP growth come from one expenditure component: personal consumption, gross private domestic investment (including inventories), net exports, or government.",
    construction: "Published by the Bureau of Economic Analysis in NIPA table 1.1.2, seasonally adjusted at annual rates. The four contributions add up to total GDP growth, apart from small residuals of chained aggregation.",
    schedule: "U.S. Bureau of Economic Analysis, with each GDP estimate (advance, second, third), 8:30 a.m. ET.",
    whyMarkets: "Shows whether growth is driven by domestic demand or by volatile items such as inventories and trade, which commentary tends to discount.",
    interpretation: US_GROWTH_INTERP,
    pitfalls: [
      "Imports enter net exports with a negative sign, so a surge in imports to build inventories subtracts from net exports and adds to investment at the same time.",
      "Contributions are revised with GDP.",
    ],
    glossary: ["contribution", "saar", "chain", "revision"],
    docs: [
      { title: "BEA: Gross Domestic Product", url: "https://www.bea.gov/data/gdp/gross-domestic-product", kind: "release" },
      { title: "BEA: NIPA Handbook (concepts and methods)", url: "https://www.bea.gov/resources/methodologies/nipa-handbook", kind: "methodology" },
    ],
    feed: BEA_GDP_FEED, calendar: BEA_CAL,
  },
  "us.gdpnow": {
    measures: "A running model estimate of real GDP growth (seasonally adjusted annual rate) for the quarter shown, before BEA publishes its advance estimate.",
    construction: "Model output, not an official statistic: the Federal Reserve Bank of Atlanta aggregates estimates of GDP's components from incoming monthly data with a bridge-equation approach. The value changes after each relevant data release; it carries no judgemental adjustment.",
    schedule: "Federal Reserve Bank of Atlanta, updated several times a month after major data releases; the series on FRED keeps the latest estimate per quarter (earlier estimates are visible through vintages).",
    whyMarkets: "Gives a running read of the quarter well before official data and summarises what releases already imply; commentary often compares it with BEA's advance estimate.",
    interpretation: US_GROWTH_INTERP,
    pitfalls: [
      "Early in a quarter it rests on very little data and can move by several points.",
      "The Atlanta Fed states it is not an official forecast of the Atlanta Fed or the Federal Reserve.",
      "Model estimates can be distorted by unusual swings in trade or inventories (for example around gold imports or tariff front-running).",
    ],
    glossary: ["nowcast", "saar", "vintage"],
    docs: [
      { title: "Federal Reserve Bank of Atlanta: GDPNow", url: "https://www.atlantafed.org/cqer/research/gdpnow", kind: "release" },
    ],
    calendar: { url: "https://www.atlantafed.org/cqer/research/gdpnow", label: "Atlanta Fed GDPNow (release schedule on the page)" },
  },
  "us.retail": {
    measures: "The monthly change in the dollar value of sales at retail stores and food-service establishments (the advance estimate).",
    construction: "Survey data from the Census Bureau's Advance Monthly Retail Trade Survey of a subsample of retailers, seasonally adjusted and adjusted for trading-day and holiday differences. Nominal: not adjusted for inflation. The row shows the % change computed from the published level.",
    schedule: "U.S. Census Bureau, monthly, about two weeks after the month ends (mid-month), 8:30 a.m. ET.",
    whyMarkets: "A timely gauge of consumer spending, the largest component of GDP; the 'control group' (excluding autos, gasoline, building materials and food services) feeds directly into BEA's consumption estimates.",
    interpretation: US_GROWTH_INTERP,
    pitfalls: [
      "Nominal: in months of high inflation, rising sales can reflect prices rather than volumes.",
      "Auto and gasoline sales are volatile; the control group is often more informative.",
      "The advance estimate is revised in the next two months.",
      "Covers goods far more than services, so it misses much of consumer spending.",
    ],
    glossary: ["sa", "mom", "real_nominal", "revision"],
    docs: [
      { title: "Census Bureau: Advance Monthly Retail Trade Report", url: "https://www.census.gov/retail/marts/www/marts_current.pdf", kind: "release" },
      { title: "Census Bureau: Monthly Retail Trade (methodology)", url: "https://www.census.gov/retail/index.html", kind: "methodology" },
    ],
    feed: CENSUS_FEED(/Retail/i), calendar: CENSUS_CAL,
  },
  "us.indpro": {
    measures: "Industrial production: the real output of US manufacturing, mining, and electric and gas utilities. Capacity utilisation: output as a share of estimated sustainable capacity.",
    construction: "Compiled by the Federal Reserve Board from physical-product data, production-worker hours and electricity use; index 2017 = 100, seasonally adjusted. Capacity is estimated by the Board from surveys and industry data.",
    schedule: "Board of Governors of the Federal Reserve System, G.17 release, monthly around mid-month, 9:15 a.m. ET; an annual revision updates several years.",
    whyMarkets: "Industry is a small share of GDP but cyclically sensitive; capacity utilisation is read as an indicator of slack in goods-producing sectors.",
    interpretation: US_GROWTH_INTERP,
    pitfalls: [
      "Utilities output swings with the weather; manufacturing output is the cleaner cyclical signal.",
      "Strikes and plant retooling (autos, aircraft) distort single months.",
      "Capacity estimates are model-based and revised.",
    ],
    glossary: ["sa", "mom", "revision"],
    docs: [
      { title: "Federal Reserve: G.17 Industrial Production and Capacity Utilization", url: "https://www.federalreserve.gov/releases/g17/current/default.htm", kind: "release" },
      { title: "Federal Reserve: G.17 explanatory notes", url: "https://www.federalreserve.gov/releases/g17/About.htm", kind: "methodology" },
    ],
    feed: { institutions: ["Federal Reserve"], match: /G\.17/i }, calendar: FED_STATS_CAL,
  },
  "us.durables": {
    measures: "New orders placed with US manufacturers for durable goods (items meant to last three years or more), and the narrower 'core capital goods' orders (non-defence capital goods excluding aircraft).",
    construction: "Survey data from the Census Bureau's Manufacturers' Shipments, Inventories, and Orders (M3) survey; seasonally adjusted, nominal dollars. The rows show % changes computed from the published levels.",
    schedule: "U.S. Census Bureau: advance durable goods report about four weeks after the month ends, 8:30 a.m. ET; the full M3 report (factory orders) follows about a week later.",
    whyMarkets: "Core capital goods orders are read as a leading indicator of business equipment investment; headline durables are dominated by volatile aircraft orders.",
    interpretation: US_GROWTH_INTERP,
    pitfalls: [
      "Commercial aircraft orders can swing the headline by several percent in one month.",
      "Nominal: price increases inflate order values.",
      "Advance figures are revised in the full M3 report a week later.",
    ],
    glossary: ["sa", "mom", "real_nominal", "revision"],
    docs: [
      { title: "Census Bureau: Manufacturers' Shipments, Inventories, and Orders (M3)", url: "https://www.census.gov/manufacturing/m3/index.html", kind: "release" },
    ],
    feed: CENSUS_FEED(/Durable|Manufacturers' Shipments/i), calendar: CENSUS_CAL,
  },
  "us.starts": {
    measures: "Housing starts: new privately owned housing units on which construction began. Building permits: units authorised by local permit-issuing offices. Both at seasonally adjusted annual rates.",
    construction: "Survey data from the Census Bureau and the Department of Housing and Urban Development (Survey of Construction and the Building Permits Survey); seasonally adjusted annual rates, in thousands of units.",
    schedule: "U.S. Census Bureau and HUD, New Residential Construction release, around the 12th business day of the month, 8:30 a.m. ET.",
    whyMarkets: "Housing is the most interest-rate-sensitive part of the economy; permits are read as a lead on future starts and residential investment.",
    interpretation: US_GROWTH_INTERP,
    pitfalls: [
      "Large sampling error: the Census Bureau often cannot say whether a monthly change differs from zero at 90% confidence.",
      "Multi-family starts are lumpy and weather-sensitive.",
      "Permits are revised in the following month's release.",
    ],
    glossary: ["saar", "sa", "revision"],
    docs: [
      { title: "Census Bureau: New Residential Construction", url: "https://www.census.gov/construction/nrc/index.html", kind: "release" },
    ],
    feed: CENSUS_FEED(/Residential Construction/i), calendar: CENSUS_CAL,
  },
  "us.newhomes": {
    measures: "Sales of newly built single-family houses (signed contracts), at a seasonally adjusted annual rate.",
    construction: "Survey data from the Census Bureau and HUD Survey of Construction; seasonally adjusted annual rate, thousands.",
    schedule: "U.S. Census Bureau and HUD, New Residential Sales release, near the end of the month for the previous month, 10:00 a.m. ET.",
    whyMarkets: "A timely signal of housing demand, since a sale is counted at contract signing; read alongside mortgage rates. Existing home sales (a larger market) are not shown here for licensing reasons.",
    interpretation: US_GROWTH_INTERP,
    pitfalls: [
      "Very large sampling error: the 90% confidence interval on the monthly change is often around ±15–20%.",
      "Revisions to prior months are frequent and sizeable.",
      "New homes are a small share of all home sales.",
    ],
    glossary: ["saar", "revision"],
    docs: [
      { title: "Census Bureau: New Residential Sales", url: "https://www.census.gov/construction/nrs/index.html", kind: "release" },
    ],
    feed: CENSUS_FEED(/Residential Sales/i), calendar: CENSUS_CAL,
  },
  "us.trade": {
    measures: "The US balance of trade in goods and services (exports minus imports) for the month, balance-of-payments basis; negative values are deficits.",
    construction: "Hard data: Census Bureau goods trade from customs records and BEA services estimates, seasonally adjusted, nominal US dollars.",
    schedule: "U.S. Bureau of Economic Analysis and U.S. Census Bureau, monthly, about five weeks after the month ends, 8:30 a.m. ET; an advance goods-only report comes about a week earlier.",
    whyMarkets: "Feeds the net-exports component of GDP and is part of the external-balance and dollar debate; swings in imports ahead of tariffs or in gold flows can move it sharply.",
    interpretation: US_GROWTH_INTERP,
    pitfalls: [
      "Nominal: oil and commodity prices move the balance without volume changes.",
      "Non-monetary gold flows can create large monthly swings that BEA treats differently in GDP.",
      "Revised with annual updates.",
    ],
    glossary: ["sa", "real_nominal", "revision"],
    docs: [
      { title: "BEA: U.S. International Trade in Goods and Services", url: "https://www.bea.gov/data/intl-trade-investment/international-trade-goods-and-services", kind: "release" },
      { title: "Census Bureau: Foreign Trade", url: "https://www.census.gov/foreign-trade/index.html", kind: "data" },
    ],
    feed: { institutions: ["U.S. Bureau of Economic Analysis", "U.S. Census Bureau"], match: /International Trade in Goods and Services/i }, calendar: BEA_CAL,
  },

  // ═════════ money and credit ═════════
  "us.m2": {
    measures: "The M2 money stock: currency, checking and savings deposits, small time deposits and retail money-market fund balances; the row shows its 12-month growth.",
    construction: "Compiled by the Federal Reserve Board from bank and money-fund reports (H.6 release); seasonally adjusted, billions of dollars. Since 2021 the H.6 is published monthly only.",
    schedule: "Board of Governors of the Federal Reserve System, H.6 Money Stock Measures, monthly, usually the fourth Tuesday, 1:00 p.m. ET.",
    whyMarkets: "Watched by some for liquidity and inflation arguments, especially after the 2020–21 surge and the 2022–23 contraction; the empirical link between M2 and inflation has been unstable for decades.",
    interpretation: US_MONEY_INTERP,
    pitfalls: [
      "The May 2020 change that reclassified savings deposits into M1 does not affect M2 but breaks M1 comparisons.",
      "Money-fund and deposit shifts driven by interest rates can move M2 without any change in spending.",
    ],
    glossary: ["sa", "yoy"],
    docs: [
      { title: "Federal Reserve: H.6 Money Stock Measures", url: "https://www.federalreserve.gov/releases/h6/current/default.htm", kind: "release" },
    ],
    calendar: FED_STATS_CAL,
  },
  "us.fedassets": {
    measures: "Total assets on the Federal Reserve's balance sheet (mostly Treasury and agency mortgage-backed securities), bank reserve balances held at the Fed, and the overnight reverse repo facility, which together describe how much liquidity the Fed supplies and where it sits.",
    construction: "Accounting data. Total assets and reserve balances are Wednesday levels from the H.4.1 release (Board of Governors). Overnight reverse repos are daily operation results from the Federal Reserve Bank of New York.",
    schedule: "H.4.1: weekly, Thursdays at 4:30 p.m. ET. ON RRP: daily, published by the New York Fed after the operation closes.",
    whyMarkets: "Quantitative tightening (the run-off of securities) drains reserves over time; commentary watches whether reserves stay 'ample' and whether money-market rates drift above the Fed's administered rates.",
    interpretation: US_MONEY_INTERP,
    pitfalls: [
      "Reserves fall when the Treasury rebuilds its TGA balance or money moves into the reverse repo facility, even with no change in Fed policy.",
      "Quarter-end and tax-date effects create temporary swings.",
      "Total assets include emergency facilities and lending that can move independently of securities holdings.",
    ],
    glossary: ["reserves", "rrp", "tga"],
    docs: [
      { title: "Federal Reserve: H.4.1 Factors Affecting Reserve Balances", url: "https://www.federalreserve.gov/releases/h41/", kind: "release" },
      { title: "NY Fed: Reverse repo operations", url: "https://www.newyorkfed.org/markets/desk-operations/reverse-repo", kind: "data" },
      { title: "Federal Reserve: Policy normalization (balance sheet)", url: "https://www.federalreserve.gov/monetarypolicy/policy-normalization.htm", kind: "central bank" },
    ],
    feed: FED_POLICY_FEED, calendar: { url: "https://www.federalreserve.gov/releases/h41/", label: "H.4.1 (weekly, Thursdays 4:30 p.m. ET)" },
  },
  "us.bankcredit": {
    measures: "Total bank credit at all US commercial banks: loans and leases plus securities holdings; the row shows 12-month growth.",
    construction: "Estimated by the Federal Reserve Board from weekly reports of a sample of banks, benchmarked to quarterly Call Reports (H.8 release). Seasonally adjusted, billions of dollars.",
    schedule: "Board of Governors of the Federal Reserve System, H.8, weekly on Fridays at 4:15 p.m. ET, covering the week ending about nine days earlier.",
    whyMarkets: "A timely read on whether banks are expanding or contracting credit, watched closely in banking stress episodes such as March 2023.",
    interpretation: US_MONEY_INTERP,
    pitfalls: [
      "Weekly figures are revised when the sample is benchmarked to Call Reports, sometimes noticeably.",
      "Mergers, conversions of non-banks into banks and accounting changes create breaks that the Board adjusts for with a lag.",
    ],
    glossary: ["sa", "yoy", "revision"],
    docs: [
      { title: "Federal Reserve: H.8 Assets and Liabilities of Commercial Banks", url: "https://www.federalreserve.gov/releases/h8/current/default.htm", kind: "release" },
    ],
    calendar: FED_STATS_CAL,
  },
  "us.conscredit": {
    measures: "The monthly change in outstanding consumer credit (credit cards and other revolving credit, plus auto and student loans), excluding loans secured by real estate.",
    construction: "Compiled by the Federal Reserve Board from lender data (G.19 release), seasonally adjusted, millions of dollars. The figure shown is computed by this terminal as the change in the published level.",
    schedule: "Board of Governors of the Federal Reserve System, G.19, monthly, about five weeks after the month ends, 3:00 p.m. ET.",
    whyMarkets: "Shows whether households are borrowing more to finance spending; watched with delinquency rates for signs of household strain.",
    interpretation: US_MONEY_INTERP,
    pitfalls: [
      "Student-loan data have structural breaks (federal programme changes and reporting changes).",
      "Monthly changes are revised and volatile.",
    ],
    glossary: ["sa", "revision"],
    docs: [
      { title: "Federal Reserve: G.19 Consumer Credit", url: "https://www.federalreserve.gov/releases/g19/current/default.htm", kind: "release" },
    ],
    feed: { institutions: ["Federal Reserve"], match: /G\.19/i }, calendar: FED_STATS_CAL,
  },
  "us.delinquency": {
    measures: "Delinquency rates on loans at US commercial banks: the share of loan balances 30 days or more past due (or not accruing interest), for credit cards, single-family residential mortgages, and all loans.",
    construction: "Compiled by the Federal Reserve Board from banks' quarterly Call Reports (FFIEC 031/041), seasonally adjusted, percent of loans.",
    schedule: "Board of Governors of the Federal Reserve System, quarterly, about eight weeks after the quarter ends.",
    whyMarkets: "A slow-moving indicator of credit quality and household stress; rising credit-card delinquencies are watched as a sign of strain among lower-income borrowers.",
    interpretation: US_MONEY_INTERP,
    pitfalls: [
      "Covers loans held by commercial banks only, not non-bank lenders or securitised loans held elsewhere.",
      "Charge-off policies and loan sales affect measured delinquency.",
      "Quarterly and lagged: it confirms rather than signals turns.",
    ],
    glossary: ["sa"],
    docs: [
      { title: "Federal Reserve: Charge-Off and Delinquency Rates on Loans and Leases at Commercial Banks", url: "https://www.federalreserve.gov/releases/chargeoff/", kind: "release" },
    ],
    calendar: FED_STATS_CAL,
  },

  // ═════════ rates ═════════
  "us.fedfunds_target": {
    measures: "The target range for the federal funds rate set by the Federal Open Market Committee (upper and lower limits), and the interest rate on reserve balances (IORB) set by the Board to keep the market rate inside that range.",
    construction: "Policy decisions, not statistics: FRED records the range on every day it applies. IORB is an administered rate the Board sets, normally inside the target range.",
    schedule: "Federal Open Market Committee: eight scheduled meetings a year; statements at 2:00 p.m. ET, with the Summary of Economic Projections four times a year, and minutes three weeks after each meeting. Unscheduled moves are possible.",
    whyMarkets: "The anchor for all US short-term rates; markets price its expected path through fed funds futures and SOFR futures, and every other release is read through its implications for this range.",
    interpretation: US_RATES_INTERP,
    pitfalls: [
      "The rate actually traded is the effective federal funds rate, which normally sits a few basis points inside the range.",
      "The range changes only at decisions; 'no change' days carry information about the expected path, which this series does not show.",
      "Before December 2008 the Fed targeted a single rate, not a range.",
    ],
    glossary: ["policy_rate", "bp", "reserves"],
    docs: [
      FOMC_PAGE,
      { title: "Federal Reserve: Policy tools (interest on reserve balances)", url: "https://www.federalreserve.gov/monetarypolicy/reserve-balances.htm", kind: "central bank" },
      { title: "Federal Reserve: Summary of Economic Projections", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", kind: "central bank" },
      MPR, BEIGE,
    ],
    feed: FED_POLICY_FEED, calendar: FOMC_CAL,
  },
  "us.effr": {
    measures: "The effective federal funds rate: the volume-weighted median rate on overnight unsecured loans of reserves between depository institutions and other eligible lenders.",
    construction: "Market data collected by the Federal Reserve Bank of New York from banks' daily transaction reports (FR 2420).",
    schedule: "Federal Reserve Bank of New York, published each business day at about 9:00 a.m. ET for the previous business day.",
    whyMarkets: "Shows where the policy rate actually trades within the FOMC's target range; drift towards the top of the range is read as a sign of tighter reserve conditions.",
    interpretation: US_RATES_INTERP,
    pitfalls: [
      "Month-end and quarter-end moves are often technical.",
      "Fed funds volume is now dominated by a few lenders (Federal Home Loan Banks), so it is a narrow market.",
    ],
    glossary: ["policy_rate", "bp", "reserves"],
    docs: [
      { title: "NY Fed: Effective Federal Funds Rate", url: "https://www.newyorkfed.org/markets/reference-rates/effr", kind: "release" },
    ],
    calendar: { url: "https://www.newyorkfed.org/markets/reference-rates/effr", label: "NY Fed reference rates (published each business day)" },
  },
  "us.sofr": {
    measures: "The Secured Overnight Financing Rate: a broad measure of the cost of borrowing cash overnight collateralised by Treasury securities.",
    construction: "Market data: the New York Fed computes the volume-weighted median of overnight Treasury repo transactions (tri-party, general collateral and bilateral cleared trades).",
    schedule: "Federal Reserve Bank of New York, each business day at about 8:00 a.m. ET for the previous business day.",
    whyMarkets: "The main US dollar reference rate for derivatives and loans since the end of LIBOR; spikes relative to the Fed's administered rates are read as a sign of funding pressure.",
    interpretation: US_RATES_INTERP,
    pitfalls: [
      "Month-end, quarter-end and Treasury settlement dates produce temporary spikes.",
      "It is secured (repo) borrowing, so it can sit below or above the unsecured fed funds rate depending on collateral supply.",
    ],
    glossary: ["policy_rate", "bp", "rrp"],
    docs: [
      { title: "NY Fed: Secured Overnight Financing Rate", url: "https://www.newyorkfed.org/markets/reference-rates/sofr", kind: "release" },
      { title: "NY Fed: Reference rates methodology", url: "https://www.newyorkfed.org/markets/reference-rates/additional-information-about-reference-rates", kind: "methodology" },
    ],
    calendar: { url: "https://www.newyorkfed.org/markets/reference-rates/sofr", label: "NY Fed reference rates (published each business day)" },
  },
  "us.treasury": {
    measures: "Market yields on US Treasury securities at constant maturities of 2, 5, 10 and 30 years.",
    construction: "Market data: the U.S. Treasury fits a par yield curve each day from indicative closing bid prices of recently issued securities; the Federal Reserve Board republishes these yields in its H.15 release.",
    schedule: "Daily on business days; FRED updates them from the H.15 release.",
    whyMarkets: "The benchmark for global dollar borrowing costs. The 2-year mostly tracks the expected path of the federal funds rate; the 10-year and 30-year add inflation expectations and a term premium.",
    interpretation: US_RATES_INTERP,
    pitfalls: [
      "These are end-of-day fitted yields, not traded prices at a specific time.",
      "Long-end moves can reflect supply (auction sizes), term premium or inflation expectations: the yield alone does not say which.",
    ],
    glossary: ["cmt", "bp", "term_premium", "par_yield"],
    docs: [
      { title: "Federal Reserve: H.15 Selected Interest Rates", url: "https://www.federalreserve.gov/releases/h15/", kind: "release" },
      { title: "U.S. Treasury: Daily Treasury Par Yield Curve Rates", url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve", kind: "data" },
      { title: "U.S. Treasury: Interest rate statistics methodology", url: "https://home.treasury.gov/policy-issues/financing-the-government/interest-rate-statistics/treasury-yield-curve-methodology", kind: "methodology" },
    ],
    calendar: FED_STATS_CAL,
  },
  "us.tips10": {
    measures: "The 10-year real yield: the yield on 10-year Treasury Inflation-Protected Securities, whose principal is indexed to CPI-U.",
    construction: "Market data: Treasury real par yield curve, republished in the Board's H.15 release at constant maturity.",
    schedule: "Daily on business days, via H.15.",
    whyMarkets: "Real yields are widely read as the cleanest measure of how restrictive financial conditions are, and as a key driver of gold and long-duration equity valuations.",
    interpretation: US_RATES_INTERP,
    pitfalls: [
      "The TIPS market is less liquid than nominal Treasuries; in stress, real yields can jump for liquidity reasons.",
      "Indexation lag: TIPS reference CPI with about a three-month lag.",
    ],
    glossary: ["real_nominal", "breakeven", "cmt", "bp"],
    docs: [
      { title: "Federal Reserve: H.15 Selected Interest Rates", url: "https://www.federalreserve.gov/releases/h15/", kind: "release" },
      { title: "U.S. Treasury: Daily Treasury Par Real Yield Curve Rates", url: "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_real_yield_curve", kind: "data" },
    ],
    calendar: FED_STATS_CAL,
  },
  "us.tp10": {
    measures: "An estimate of the term premium on a 10-year zero-coupon Treasury: the part of the yield not explained by the expected path of short-term rates.",
    construction: "Model estimate from the Federal Reserve Board's Kim-Wright three-factor arbitrage-free term-structure model (Kim and Wright, 2005), fitted to Treasury yields and survey forecasts. It is NOT the New York Fed's ACM estimate, which is listed under Coverage gaps.",
    schedule: "Board of Governors of the Federal Reserve System; FRED updates it roughly weekly.",
    whyMarkets: "Used to separate 'policy expectations' from 'compensation for duration risk' when long yields move, for example in debates about fiscal supply.",
    interpretation: US_RATES_INTERP,
    pitfalls: [
      "Unobservable: different models (Kim-Wright, ACM) give different levels and sometimes different directions.",
      "Estimates for past dates can change when the model is re-estimated.",
    ],
    glossary: ["term_premium", "cmt", "proxy"],
    docs: [
      { title: "Federal Reserve Board: Kim and Wright (2005), An Arbitrage-Free Three-Factor Term Structure Model (FEDS 2005-33)", url: "https://www.federalreserve.gov/pubs/feds/2005/200533/200533abs.html", kind: "methodology" },
    ],
    calendar: FED_STATS_CAL,
  },
  "us.curve": {
    measures: "The slope of the Treasury yield curve: 10-year minus 2-year, and 10-year minus 3-month constant-maturity yields, in percentage points.",
    construction: "Computed daily by FRED (Federal Reserve Bank of St. Louis) from the Board's H.15 constant-maturity yields.",
    schedule: "Daily on business days, computed by FRED once the H.15 yields for that day are available.",
    whyMarkets: "Inversions (negative values) have preceded US recessions in past cycles, which is why the curve is watched; the 3-month/10-year spread is the version most studied in Federal Reserve research.",
    interpretation: {
      currency: "Not a direct dollar driver; read through the relative rate moves behind it.",
      rates: "Steepening can come from rising long yields (term premium, inflation) or falling short yields (expected cuts): the two have very different readings, so look at which end moved.",
      equities: "Commentary has linked prolonged inversion to recession risk; the timing between inversion and recession has varied widely and the signal has given false alarms.",
      gold: "No stable relationship; read through real yields.",
    },
    pitfalls: [
      "A historical regularity with few observations (a handful of recessions), not a law.",
      "Quantitative easing and term-premium changes can alter the curve's level of 'normal' slope.",
    ],
    glossary: ["cmt", "pp", "nber"],
    docs: [
      { title: "Federal Reserve: H.15 Selected Interest Rates", url: "https://www.federalreserve.gov/releases/h15/", kind: "release" },
      { title: "NY Fed: The yield curve as a leading indicator", url: "https://www.newyorkfed.org/research/capital_markets/ycfaq", kind: "methodology" },
    ],
    calendar: FED_STATS_CAL,
  },

  // ═════════ fiscal and external ═════════
  "us.debt": {
    measures: "Total public debt outstanding of the US federal government at the close of each business day: debt held by the public plus intragovernmental holdings.",
    construction: "Accounting data from the Bureau of the Fiscal Service (Debt to the Penny), in dollars.",
    schedule: "U.S. Treasury, Bureau of the Fiscal Service, each business day for the previous business day.",
    whyMarkets: "Context for Treasury supply and the fiscal outlook; debt-limit episodes, when the level stays flat, have been sources of market stress.",
    interpretation: {
      currency: "Rarely a release-day driver; part of the longer-run fiscal debate.",
      rates: "Commentary links rising debt to more Treasury supply and potentially higher term premia; the size of that effect is debated.",
      equities: "Background context; debt-limit standoffs have been associated with episodes of volatility.",
      gold: "Fiscal concerns are sometimes cited in longer-run arguments for gold; no release-day link.",
    },
    pitfalls: [
      "Includes debt held by government trust funds (intragovernmental), which is not market debt; debt held by the public is the market-relevant part.",
      "Under a binding debt limit the total stays flat while the Treasury uses extraordinary measures.",
    ],
    glossary: ["tga"],
    docs: [
      { title: "FiscalData: Debt to the Penny", url: "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/", kind: "data" },
      { title: "U.S. Treasury: Monthly Statement of the Public Debt", url: "https://fiscaldata.treasury.gov/datasets/monthly-statement-public-debt/", kind: "release" },
    ],
    calendar: FISCALDATA_CAL,
  },
  "us.tga": {
    measures: "The closing balance of the Treasury General Account, the US Treasury's operating cash account at the Federal Reserve, each business day.",
    construction: "Accounting data from the Daily Treasury Statement (Bureau of the Fiscal Service), in millions of dollars.",
    schedule: "U.S. Treasury, Daily Treasury Statement, published each business day around 4:00 p.m. ET for the previous business day.",
    whyMarkets: "Changes in the TGA move bank reserves one-for-one in the opposite direction, all else equal, so its swings around tax dates, debt-limit episodes and refunding are watched for money-market liquidity.",
    interpretation: US_MONEY_INTERP,
    pitfalls: [
      "Large daily swings around tax dates and auction settlements are normal.",
      "The DTS line name changed in April 2022; this history starts there.",
    ],
    glossary: ["tga", "reserves", "rrp"],
    docs: [
      { title: "FiscalData: Daily Treasury Statement", url: "https://fiscaldata.treasury.gov/datasets/daily-treasury-statement/", kind: "data" },
      { title: "Federal Reserve: H.4.1 Factors Affecting Reserve Balances", url: "https://www.federalreserve.gov/releases/h41/", kind: "release" },
    ],
    calendar: FISCALDATA_CAL,
  },
  "us.deficit": {
    measures: "The federal government's surplus or deficit (receipts minus outlays) for a single month; negative values are deficits.",
    construction: "Accounting data from the Monthly Treasury Statement (Bureau of the Fiscal Service), not seasonally adjusted, millions of dollars.",
    schedule: "U.S. Treasury, Monthly Treasury Statement, around the eighth business day of the following month, 2:00 p.m. ET.",
    whyMarkets: "The fiscal deficit drives Treasury borrowing needs and auction sizes; the running fiscal-year total is the figure most often cited.",
    interpretation: {
      currency: "Not a release-day driver; part of the fiscal and twin-deficit debate.",
      rates: "Larger deficits imply more issuance, which commentary links to term premia at the long end.",
      equities: "Background context.",
      gold: "Fiscal deterioration is sometimes cited in longer-run arguments for gold.",
    },
    pitfalls: [
      "Not seasonally adjusted: tax months (April, June, September, December) show surpluses or small deficits; compare with the same month a year earlier.",
      "Calendar shifts move payments between months when the first of a month falls on a weekend.",
    ],
    glossary: ["nsa"],
    docs: [
      { title: "FiscalData: Monthly Treasury Statement", url: "https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/", kind: "release" },
    ],
    calendar: FISCALDATA_CAL,
  },
  "us.tic": {
    measures: "Foreign investors' net purchases of US Treasury securities (long- and short-term) in a month, from the Treasury International Capital (TIC) system; positive values are net foreign buying.",
    construction: "Reported transaction data collected by the Federal Reserve Bank of New York for the U.S. Treasury from US-resident custodians and dealers; not seasonally adjusted, millions of dollars.",
    schedule: "U.S. Treasury, monthly, around the middle of the second month after the reference month, 4:00 p.m. ET.",
    whyMarkets: "Part of the debate on foreign demand for Treasuries and on the financing of the US external deficit.",
    interpretation: {
      currency: "Commentary uses foreign flows in the dollar-funding debate; monthly figures rarely move the dollar on release.",
      rates: "Read for foreign demand for Treasuries, including official (central-bank) holders.",
      equities: "Little direct relevance.",
      gold: "Sometimes cited in discussions of central banks diversifying reserves; no release-day link.",
    },
    pitfalls: [
      "Custodial bias: purchases are attributed to the country of the custodian (e.g. Belgium, Cayman Islands, United Kingdom), not the ultimate owner.",
      "Monthly flows are volatile and revised with annual benchmark surveys.",
    ],
    glossary: ["nsa", "revision"],
    docs: [
      { title: "U.S. Treasury: Treasury International Capital (TIC) System", url: "https://home.treasury.gov/data/treasury-international-capital-tic-system", kind: "release" },
    ],
    calendar: { url: "https://home.treasury.gov/data/treasury-international-capital-tic-system", label: "U.S. Treasury TIC release schedule (on the TIC page)" },
  },
  "us.ca": {
    measures: "The US current-account balance for the quarter: trade in goods and services plus primary income (investment income) and secondary income (transfers); negative values are deficits.",
    construction: "Hard data assembled by the Bureau of Economic Analysis (International Transactions Accounts), seasonally adjusted, millions of dollars.",
    schedule: "U.S. Bureau of Economic Analysis, quarterly, near the end of the third month after the quarter, 8:30 a.m. ET.",
    whyMarkets: "Shows how much the US borrows from the rest of the world each quarter; part of long-run dollar valuation debates rather than a release-day driver.",
    interpretation: {
      currency: "Large deficits are cited in long-run dollar debates; there is little reliable release-day effect.",
      rates: "Linked to foreign financing of US deficits; background only.",
      equities: "Little direct relevance.",
      gold: "Little direct relevance.",
    },
    pitfalls: [
      "Quarterly and published with a long lag.",
      "Annual revisions in June can change past quarters substantially.",
    ],
    glossary: ["sa", "revision"],
    docs: [
      { title: "BEA: U.S. International Transactions", url: "https://www.bea.gov/data/intl-trade-investment/international-transactions", kind: "release" },
    ],
    feed: { institutions: ["U.S. Bureau of Economic Analysis"], match: /International Transactions/i }, calendar: BEA_CAL,
  },
  "us.auction": {
    measures: "Results of US Treasury 10-year note auctions (new issues and reopenings; TIPS excluded): the high (stop-out) yield accepted and the bid-to-cover ratio.",
    construction: "Official auction results published by the U.S. Treasury (Bureau of the Fiscal Service, Treasury Securities Auctions Data).",
    schedule: "10-year notes are auctioned about once a month: new issues in February, May, August and November, reopenings in the other months. Results are published shortly after the 1:00 p.m. ET close.",
    whyMarkets: "Auctions are where new supply meets demand; commentary compares the high yield with the market yield just before the auction ('tail' or 'stop-through') and watches bid-to-cover and the share taken by dealers.",
    interpretation: US_RATES_INTERP,
    pitfalls: [
      "The comparison that commentary uses (high yield versus the when-issued yield at 1:00 p.m.) needs intraday data that are not free; it is not computed here.",
      "Bid-to-cover moves with auction size and bidding behaviour; on its own it is a weak gauge of demand.",
      "Reopenings and new issues differ in remaining maturity.",
    ],
    glossary: ["high_yield", "bid_to_cover", "bp"],
    docs: [
      { title: "TreasuryDirect: Auction results", url: "https://www.treasurydirect.gov/auctions/auction-query/", kind: "release" },
      { title: "FiscalData: Treasury Securities Auctions Data", url: "https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/", kind: "data" },
      { title: "TreasuryDirect: Upcoming auctions", url: "https://www.treasurydirect.gov/auctions/upcoming/", kind: "calendar" },
    ],
    calendar: { url: "https://www.treasurydirect.gov/auctions/upcoming/", label: "TreasuryDirect: upcoming auctions" },
  },

  // ═════════ regional Fed surveys ═════════
  "us.regional": {
    measures: "Diffusion indexes of current general business activity from regional Federal Reserve Bank manufacturing surveys: New York (Empire State), Philadelphia (Third District) and Dallas (Texas).",
    construction: "Survey data: each bank asks a panel of manufacturers in its district whether activity increased, decreased or was unchanged versus the previous month; the index is the percentage reporting an increase minus the percentage reporting a decrease, seasonally adjusted. Panels are small (roughly 100–200 firms) and regional.",
    schedule: "Monthly, early in the reference month's second half: Empire State around the 15th (8:30 a.m. ET), Philadelphia on the third Thursday (8:30 a.m. ET), Dallas on the last Monday of the month (10:30 a.m. ET).",
    whyMarkets: "They are the earliest manufacturing readings for each month, released before national data and before the proprietary ISM survey, so they are read as early hints of factory conditions.",
    interpretation: US_GROWTH_INTERP,
    pitfalls: [
      "Small regional panels make them noisy; a swing of 10–20 points in one month is not unusual.",
      "A diffusion index measures breadth, not size: a reading of +10 does not mean output rose 10%.",
      "Each district's industrial mix differs (Texas: energy-related manufacturing).",
    ],
    glossary: ["diffusion", "sa"],
    docs: [
      { title: "NY Fed: Empire State Manufacturing Survey", url: "https://www.newyorkfed.org/survey/empire/empiresurvey_overview", kind: "release" },
      { title: "Philadelphia Fed: Manufacturing Business Outlook Survey", url: "https://www.philadelphiafed.org/surveys-and-data/regional-economic-analysis/manufacturing-business-outlook-survey", kind: "release" },
      { title: "Dallas Fed: Texas Manufacturing Outlook Survey", url: "https://www.dallasfed.org/research/surveys/tmos", kind: "release" },
      BEIGE,
    ],
    calendar: { url: "https://www.newyorkfed.org/survey/empire/empiresurvey_overview", label: "Each bank publishes its survey calendar on its survey page" },
  },
};

