import type { DocLink, Explanation, GlossaryId } from "./explainBase";

// Euro Area, United Kingdom, Japan, Canada, Australia, New Zealand, Switzerland.
// Static, reviewed text (2026-10-13). The construction, schedule, pitfalls and documents are written per series;
// the "why markets follow it" and "how it has typically been read" paragraphs are shared per indicator type, with
// the economy's currency and central bank named. Descriptive only: no predictions, no trade ideas.

interface Who { econ: string; ccy: string; cb: string; feedInstitution: string }

const W: Record<string, Who> = {
  EA: { econ: "the euro area", ccy: "the euro", cb: "the ECB", feedInstitution: "European Central Bank" },
  UK: { econ: "the UK", ccy: "sterling", cb: "the Bank of England", feedInstitution: "Bank of England" },
  JP: { econ: "Japan", ccy: "the yen", cb: "the Bank of Japan", feedInstitution: "Bank of Japan" },
  CA: { econ: "Canada", ccy: "the Canadian dollar", cb: "the Bank of Canada", feedInstitution: "Bank of Canada" },
  AU: { econ: "Australia", ccy: "the Australian dollar", cb: "the RBA", feedInstitution: "Reserve Bank of Australia" },
  NZ: { econ: "New Zealand", ccy: "the New Zealand dollar", cb: "the RBNZ", feedInstitution: "Reserve Bank of New Zealand" },
  CH: { econ: "Switzerland", ccy: "the Swiss franc", cb: "the SNB", feedInstitution: "Swiss National Bank" },
};

type Kind = "policy" | "cpi" | "core" | "unemp" | "gdp" | "y10";

function shared(kind: Kind, w: Who): Pick<Explanation, "whyMarkets" | "interpretation"> & { pitfalls: string[]; glossary: GlossaryId[] } {
  switch (kind) {
    case "policy": return {
      whyMarkets: `The anchor for short-term interest rates in ${w.econ}. Markets price the expected path of the rate, and almost every other release is read through what it implies for ${w.cb}'s next decisions.`,
      interpretation: {
        currency: `A higher policy rate relative to other central banks has typically been associated in commentary with a firmer ${w.ccy.replace(/^the /, "")}, mainly through the surprise relative to what was priced rather than the decision itself.`,
        rates: "Short-dated government yields track the expected policy path most closely; the decision and the accompanying guidance move them most.",
        equities: "Easier policy is usually read as supportive for equities through lower discount rates, unless it signals a weaker economy.",
        gold: "Gold, which pays no interest, has typically been framed as benefiting from lower real rates and suffering from higher ones, mostly through US rates and the dollar.",
      },
      pitfalls: ["A decision that matches market pricing is rarely news; the guidance and projections that come with it often matter more than the rate itself."],
      glossary: ["policy_rate", "bp"],
    };
    case "cpi": case "core": return {
      whyMarkets: `Price stability is ${w.cb}'s mandate, so inflation releases shape expectations for its policy rate. ${kind === "core" ? "Core measures are read as the more persistent part of inflation." : "Headline inflation is the measure most central banks define their target on."}`,
      interpretation: {
        currency: `Higher-than-anticipated inflation has typically been read as raising the odds of tighter policy from ${w.cb}, which commentary links to a firmer ${w.ccy.replace(/^the /, "")}.`,
        rates: "Front-end yields respond most, through the expected policy path.",
        equities: "Hotter inflation is usually framed as a headwind through higher discount rates; the reading depends on growth.",
        gold: "Local inflation releases rarely matter for gold, which is priced mainly off US real yields and the dollar.",
      },
      pitfalls: ["Year-on-year rates carry base effects from a year earlier.", "Consensus forecasts are not free, so this page cannot show surprises; it shows published values and changes."],
      glossary: ["yoy", "base_effect", kind === "core" ? "core" : "nsa"],
    };
    case "unemp": return {
      whyMarkets: `The headline measure of labour-market slack in ${w.econ}; a tightening labour market is read as a source of wage and services inflation.`,
      interpretation: {
        currency: `A stronger labour market has typically been read as supporting tighter policy and a firmer ${w.ccy.replace(/^the /, "")}.`,
        rates: "Read through the policy path; front-end yields respond most.",
        equities: "Ambiguous: strength supports earnings but can imply tighter policy.",
        gold: "Little direct relevance outside the US.",
      },
      pitfalls: ["Survey-based rates carry sampling error of a few tenths of a point.", "The rate can fall because people leave the labour force rather than find work."],
      glossary: ["ilo", "sa", "participation"],
    };
    case "gdp": return {
      whyMarkets: `The broadest measure of activity in ${w.econ}. Because monthly indicators arrive first, the quarterly release often confirms rather than surprises, but large revisions or composition shifts can change the narrative.`,
      interpretation: {
        currency: `Stronger growth has typically been read as supportive for ${w.ccy} through expectations of relatively higher rates.`,
        rates: "Activity surprises move expected policy; stronger growth is usually read as pushing yields up.",
        equities: "Usually read positively through earnings, unless strength implies tighter policy.",
        gold: "Little direct relevance outside the US.",
      },
      pitfalls: ["Quarterly growth is revised as more complete data arrive.", "Growth bases differ across economies (q/q, q/q annualised, y/y): compare like with like."],
      glossary: ["chain", "real_nominal", "revision", "sa"],
    };
    case "y10": return {
      whyMarkets: `The benchmark long-term borrowing cost in ${w.econ}, combining the expected path of policy rates, inflation compensation and a term premium; it also reflects global yields.`,
      interpretation: {
        currency: `Wider yield spreads over other economies have typically been associated in commentary with a firmer ${w.ccy.replace(/^the /, "")}, though long-end spreads matter less than short-end ones.`,
        rates: "This is itself a rate: read it against the policy rate, inflation and other countries' 10-year yields.",
        equities: "Higher long yields raise discount rates, a headwind usually emphasised for long-duration sectors.",
        gold: "Gold is priced mainly off US real yields; local yields matter little.",
      },
      pitfalls: ["Fitted or interpolated yields differ slightly from the yield of any single traded bond.", "Monthly averages (where noted) smooth over intra-month moves."],
      glossary: ["cmt", "bp", "term_premium"],
    };
  }
}

interface Spec {
  measures: string; construction: string; schedule: string; pitfalls?: string[]; glossary?: GlossaryId[];
  docs: DocLink[]; calendar: { url: string; label: string }; feedMatch?: RegExp;
}

function make(econ: keyof typeof W, kind: Kind, s: Spec): Explanation {
  const w = W[econ];
  const b = shared(kind, w);
  return {
    measures: s.measures, construction: s.construction, schedule: s.schedule,
    whyMarkets: b.whyMarkets, interpretation: b.interpretation,
    pitfalls: [...(s.pitfalls ?? []), ...b.pitfalls],
    glossary: [...new Set([...(s.glossary ?? []), ...b.glossary])],
    docs: s.docs, calendar: s.calendar,
    feed: s.feedMatch ? { institutions: [w.feedInstitution], match: s.feedMatch } : undefined,
  };
}

// ───────────── shared official links ─────────────
const ECB_DECISIONS: DocLink = { title: "ECB: Monetary policy decisions", url: "https://www.ecb.europa.eu/press/govcdec/mopo/html/index.en.html", kind: "central bank" };
const ECB_BULLETIN: DocLink = { title: "ECB: Economic Bulletin", url: "https://www.ecb.europa.eu/press/economic-bulletin/html/index.en.html", kind: "central bank" };
const ECB_CAL = { url: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html", label: "ECB Governing Council meeting calendar" };
const EUROSTAT_CAL = { url: "https://ec.europa.eu/eurostat/news/release-calendar", label: "Eurostat release calendar" };
const ONS_CAL = { url: "https://www.ons.gov.uk/releasecalendar", label: "ONS release calendar" };
const BOE_MPR: DocLink = { title: "Bank of England: Monetary Policy Report", url: "https://www.bankofengland.co.uk/monetary-policy-report/monetary-policy-report", kind: "central bank" };
const BOE_CAL = { url: "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates", label: "Bank of England: upcoming MPC dates" };
const BOJ_OUTLOOK: DocLink = { title: "Bank of Japan: Outlook for Economic Activity and Prices", url: "https://www.boj.or.jp/en/mopo/outlook/index.htm", kind: "central bank" };
const BOJ_CAL = { url: "https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm", label: "Bank of Japan: Monetary Policy Meeting schedule" };
const STATJP_CAL = { url: "https://www.stat.go.jp/english/info/guide/index.html", label: "Statistics Bureau of Japan (release schedule linked from each survey page)" };
const BOC_MPR: DocLink = { title: "Bank of Canada: Monetary Policy Report", url: "https://www.bankofcanada.ca/publications/mpr/", kind: "central bank" };
const BOC_CAL = { url: "https://www.bankofcanada.ca/press/upcoming-events/", label: "Bank of Canada: upcoming events (rate announcements)" };
const STATCAN_CAL = { url: "https://www150.statcan.gc.ca/n1/dai-quo/cal2-eng.htm", label: "Statistics Canada release schedule (The Daily)" };
const RBA_SMP: DocLink = { title: "RBA: Statement on Monetary Policy", url: "https://www.rba.gov.au/publications/smp/", kind: "central bank" };
const RBA_CAL = { url: "https://www.rba.gov.au/schedules-events/", label: "RBA: schedules and events (Monetary Policy Board meetings)" };
const ABS_CAL = { url: "https://www.abs.gov.au/release-calendar/future-releases", label: "ABS future releases calendar" };
const RBNZ_MPS: DocLink = { title: "RBNZ: Monetary Policy Statement", url: "https://www.rbnz.govt.nz/monetary-policy/monetary-policy-statement", kind: "central bank" };
const RBNZ_CAL = { url: "https://www.rbnz.govt.nz/news-and-events/events", label: "RBNZ: upcoming events (OCR announcements)" };
const STATSNZ_CAL = { url: "https://www.stats.govt.nz/release-calendar/", label: "Stats NZ release calendar" };
const SNB_DECISIONS: DocLink = { title: "SNB: Monetary policy assessments", url: "https://www.snb.ch/en/the-snb/mandates-goals/monetary-policy/decisions", kind: "central bank" };
const SNB_CAL = { url: "https://www.snb.ch/en/services-events/digital-services/event-schedule", label: "SNB event schedule (monetary policy assessments)" };
const FSO_CAL = { url: "https://www.bfs.admin.ch/bfs/en/home/news/agenda.html", label: "Swiss Federal Statistical Office agenda" };
const OECD_LTR: DocLink = { title: "OECD: Long-term interest rates (indicator)", url: "https://www.oecd.org/en/data/indicators/long-term-interest-rates.html", kind: "data" };

const POLICY_FEED = /monetary policy|policy rate|interest rate|bank rate|cash rate|official cash rate|press conference|decision|minutes|statement/i;

export const INTL_EXPLAIN: Record<string, Explanation> = {
  // ═════════ Euro Area ═════════
  "ea.policy": make("EA", "policy", {
    measures: "The ECB deposit facility rate: the rate banks earn on overnight deposits at the Eurosystem. With ample liquidity, it is the rate that steers euro money-market rates, and the ECB communicates its stance through it.",
    construction: "A policy decision by the ECB Governing Council, recorded daily in the ECB's financial-markets statistics (republished by DBnomics).",
    schedule: "European Central Bank: monetary policy meetings about every six weeks; decisions at 14:15 CET, followed by a press conference at 14:45 CET.",
    pitfalls: ["The ECB also sets the main refinancing and marginal lending rates; headlines sometimes quote the refinancing rate."],
    docs: [ECB_DECISIONS, { title: "ECB: Key ECB interest rates", url: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.en.html", kind: "data" }, ECB_BULLETIN],
    calendar: ECB_CAL, feedMatch: POLICY_FEED,
  }),
  "ea.cpi": make("EA", "cpi", {
    measures: "Harmonised Index of Consumer Prices (HICP) for the euro area, all items, annual rate of change.",
    construction: "Hard data: national statistical institutes collect prices under harmonised EU rules; Eurostat aggregates them with country weights. Published annual rate (not recomputed here). ECOICOP version 2 classification.",
    schedule: "Eurostat: flash estimate at the end of the reference month or the first working day after, final figures about two to three weeks later, 11:00 CET.",
    pitfalls: ["Owner-occupied housing costs are not included in the HICP, unlike some national CPIs.", "The flash estimate can be revised in the final release, usually by at most 0.1 point."],
    docs: [{ title: "Eurostat: Harmonised Index of Consumer Prices", url: "https://ec.europa.eu/eurostat/web/hicp", kind: "release" }, { title: "Eurostat: HICP methodology", url: "https://ec.europa.eu/eurostat/web/hicp/methodology", kind: "methodology" }, ECB_BULLETIN],
    calendar: EUROSTAT_CAL,
  }),
  "ea.core": make("EA", "core", {
    measures: "Euro-area HICP excluding energy, food, alcohol and tobacco, annual rate of change: the most widely quoted 'core' measure for the euro area.",
    construction: "Hard data from the same HICP price collection, aggregated by Eurostat excluding the volatile groups; published annual rate (ECOICOP version 2).",
    schedule: "Eurostat: included in the flash HICP estimate at the end of the reference month and in the final release, 11:00 CET.",
    pitfalls: ["Services inflation, a large part of core, is watched separately by the ECB for persistence.", "Package holidays and other seasonal items can move core in specific months (Easter timing)."],
    docs: [{ title: "Eurostat: Harmonised Index of Consumer Prices", url: "https://ec.europa.eu/eurostat/web/hicp", kind: "release" }, { title: "Eurostat: HICP methodology", url: "https://ec.europa.eu/eurostat/web/hicp/methodology", kind: "methodology" }, ECB_BULLETIN],
    calendar: EUROSTAT_CAL,
  }),
  "ea.unemp": make("EA", "unemp", {
    measures: "Unemployment rate of the euro area (21 members), persons aged 15–74, seasonally adjusted, ILO definition.",
    construction: "Survey and administrative data: Eurostat combines national Labour Force Survey results with monthly registered-unemployment data to produce monthly estimates.",
    schedule: "Eurostat: monthly, about one month after the reference month (euro indicators release), 11:00 CET.",
    pitfalls: ["Monthly figures for some countries are interpolated from quarterly surveys and revised later."],
    docs: [{ title: "Eurostat: Employment and unemployment (LFS)", url: "https://ec.europa.eu/eurostat/web/lfs", kind: "release" }],
    calendar: EUROSTAT_CAL,
  }),
  "ea.gdp": make("EA", "gdp", {
    measures: "Real GDP growth of the euro area (21 members, fixed composition), year-on-year.",
    construction: "Hard data: national accounts compiled by national statistical institutes and aggregated by Eurostat; chain-linked volumes, seasonally and calendar adjusted. This row uses the ECB's republication (MNA dataset) for the EA21 composition: the EA20 series was not extended after Bulgaria joined in 2026.",
    schedule: "Eurostat: preliminary flash about 30 days after the quarter, flash estimate about 45 days, full estimate with employment about 65 days.",
    pitfalls: ["Ireland's GDP swings with multinational accounting and can move the aggregate noticeably.", "Year-on-year growth lags turning points compared with quarter-on-quarter growth."],
    docs: [{ title: "Eurostat: National accounts (GDP)", url: "https://ec.europa.eu/eurostat/web/national-accounts", kind: "release" }, ECB_BULLETIN],
    calendar: EUROSTAT_CAL,
  }),
  "ea.y10": make("EA", "y10", {
    measures: "The 10-year spot yield on the ECB's euro-area yield curve estimated from AAA-rated central government bonds.",
    construction: "Model estimate: the ECB fits a Svensson yield curve each TARGET business day to AAA-rated euro-area government bonds. It is not the yield of a single bond (for example the German Bund).",
    schedule: "European Central Bank, each TARGET business day (republished by DBnomics with a short delay).",
    pitfalls: ["AAA-only: it does not reflect spreads of lower-rated members such as Italy or France."],
    docs: [{ title: "ECB: Euro area yield curves", url: "https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_area_yield_curves/html/index.en.html", kind: "data" }],
    calendar: ECB_CAL,
  }),

  // ═════════ United Kingdom ═════════
  "uk.policy": make("UK", "policy", {
    measures: "Bank Rate: the rate the Bank of England pays on reserves held by commercial banks, set by the Monetary Policy Committee.",
    construction: "A policy decision, recorded daily in the Bank of England's statistical database (series IUDBEDR).",
    schedule: "Bank of England Monetary Policy Committee: eight scheduled decisions a year, announced at 12:00 UK time, with a Monetary Policy Report four times a year.",
    pitfalls: ["MPC votes are published with each decision; a split vote can carry as much information as the decision."],
    docs: [{ title: "Bank of England: Bank Rate", url: "https://www.bankofengland.co.uk/monetary-policy/the-interest-rate-bank-rate", kind: "central bank" }, BOE_MPR],
    calendar: BOE_CAL, feedMatch: POLICY_FEED,
  }),
  "uk.cpi": make("UK", "cpi", {
    measures: "UK Consumer Prices Index, all items, 12-month rate as published by the ONS.",
    construction: "Hard data: the ONS collects prices of a basket of goods and services (in-store, online and from administrative sources), weighted by household spending; index 2015 = 100. The Bank of England's 2% target is defined on this CPI.",
    schedule: "Office for National Statistics: monthly, usually on a Wednesday in the middle of the following month, 07:00 UK time.",
    pitfalls: ["Regulated prices (the Ofgem energy price cap, water bills) change at fixed dates and create predictable steps in April and October.", "The ONS's preferred measure, CPIH, includes owner occupiers' housing costs and can differ from CPI."],
    docs: [{ title: "ONS: Consumer price inflation (latest bulletin)", url: "https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/consumerpriceinflation/latest", kind: "release" }, { title: "ONS: Consumer prices methodology", url: "https://www.ons.gov.uk/economy/inflationandpriceindices/methodologies/consumerpriceinflationincludesall3indicescpihcpiandrpiqmi", kind: "methodology" }, BOE_MPR],
    calendar: ONS_CAL,
  }),
  "uk.core": make("UK", "core", {
    measures: "UK CPI excluding energy, food, alcoholic beverages and tobacco, 12-month rate (ONS series DKO8).",
    construction: "Hard data from the same ONS CPI collection, excluding the volatile groups; published rate.",
    schedule: "Office for National Statistics: with headline CPI, monthly, 07:00 UK time.",
    pitfalls: ["The Bank of England also watches services CPI separately as a gauge of domestic inflation pressure."],
    docs: [{ title: "ONS: Consumer price inflation (latest bulletin)", url: "https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/consumerpriceinflation/latest", kind: "release" }, BOE_MPR],
    calendar: ONS_CAL,
  }),
  "uk.unemp": make("UK", "unemp", {
    measures: "UK unemployment rate, people aged 16 and over, seasonally adjusted (ILO definition); each figure is a rolling three-month average.",
    construction: "Survey data from the ONS Labour Force Survey. The ONS has flagged the LFS as affected by low response rates since 2023 and has been introducing a transformed survey; treat changes with caution.",
    schedule: "Office for National Statistics: monthly labour market release, usually on a Tuesday in the middle of the month, 07:00 UK time, covering the three months ending about six weeks earlier.",
    pitfalls: ["Each value overlaps two months with the previous one (three-month rolling average), which smooths and delays turns.", "Low LFS response rates since 2023 mean larger uncertainty than the headline suggests."],
    docs: [{ title: "ONS: Labour market overview (latest bulletin)", url: "https://www.ons.gov.uk/employmentandlabourmarket/peopleinwork/employmentandemployeetypes/bulletins/uklabourmarket/latest", kind: "release" }],
    calendar: ONS_CAL,
  }),
  "uk.gdp": make("UK", "gdp", {
    measures: "UK real GDP growth, quarter-on-quarter (chained volume measures, seasonally adjusted).",
    construction: "Hard data: ONS output, expenditure and income approaches balanced into a single estimate; chained volume measures. The ONS also publishes monthly GDP estimates.",
    schedule: "Office for National Statistics: first quarterly estimate about 40 days after the quarter, quarterly national accounts about 90 days after, 07:00 UK time.",
    pitfalls: ["Quarter-on-quarter, not annualised: 0.5% here is roughly 2% in US-style annualised terms."],
    docs: [{ title: "ONS: GDP first quarterly estimate (latest)", url: "https://www.ons.gov.uk/economy/grossdomesticproductgdp/bulletins/gdpfirstquarterlyestimateuk/latest", kind: "release" }, BOE_MPR],
    calendar: ONS_CAL,
  }),
  "uk.y10": make("UK", "y10", {
    measures: "The 10-year nominal par yield from the Bank of England's estimated gilt yield curve.",
    construction: "Model estimate: the Bank fits nominal yield curves daily to gilt prices (variable roughness penalty method); the par yield is the coupon at which a 10-year gilt would price at par. Not the yield of a single benchmark gilt.",
    schedule: "Bank of England, each business day (Interactive Statistical Database, series IUDMNPY).",
    pitfalls: ["Benchmark 10-year gilt yields quoted by data vendors can differ by a few basis points from this fitted par yield."],
    glossary: ["par_yield"],
    docs: [{ title: "Bank of England: Yield curves", url: "https://www.bankofengland.co.uk/statistics/yield-curves", kind: "data" }],
    calendar: { url: "https://www.bankofengland.co.uk/statistics/yield-curves", label: "Bank of England yield curves (updated each business day)" },
  }),

  // ═════════ Japan ═════════
  "jp.policy": make("JP", "policy", {
    measures: "The Bank of Japan's policy rate: its target for the uncollateralised overnight call rate.",
    construction: "A policy decision by the Bank of Japan Policy Board, taken here from the BIS central-bank policy-rate dataset (the BoJ's own API publishes the market call rate rather than the target).",
    schedule: "Bank of Japan: eight Monetary Policy Meetings a year; the statement is released at the end of the meeting (time varies, usually around midday JST), with the Outlook Report four times a year.",
    pitfalls: ["Japan's policy rate stayed at or below zero for many years; small changes are historically significant there."],
    docs: [{ title: "Bank of Japan: Statements on monetary policy", url: "https://www.boj.or.jp/en/mopo/mpmdeci/index.htm", kind: "central bank" }, BOJ_OUTLOOK],
    calendar: BOJ_CAL, feedMatch: POLICY_FEED,
  }),
  "jp.cpi": make("JP", "cpi", {
    measures: "Japan's consumer price index, all items, year-on-year change computed by this terminal from the published index.",
    construction: "Hard data: the Statistics Bureau of Japan collects prices nationwide; index base 2020 = 100. The index is published rounded to one decimal, so the computed rate can differ from the official one by about 0.1 point.",
    schedule: "Statistics Bureau of Japan: nationwide CPI monthly, on a Friday in the second half of the following month, 08:30 JST; the Tokyo-area CPI for the current month is published about three weeks earlier.",
    pitfalls: ["Government energy subsidies and education-fee policies have moved the index in specific months."],
    docs: [{ title: "Statistics Bureau of Japan: Consumer Price Index", url: "https://www.stat.go.jp/english/data/cpi/index.html", kind: "release" }, BOJ_OUTLOOK],
    calendar: STATJP_CAL,
  }),
  "jp.core": make("JP", "core", {
    measures: "Japan's CPI excluding fresh food and energy (often called 'core-core'), year-on-year change computed from the published index.",
    construction: "Hard data from the Statistics Bureau's CPI; base 2020 = 100; computed y/y from an index rounded to one decimal (about ±0.1 point).",
    schedule: "Statistics Bureau of Japan: with the nationwide CPI, monthly, 08:30 JST.",
    pitfalls: ["In Japan 'core CPI' usually means excluding fresh food only; this row excludes fresh food AND energy, so it is not the figure most headlines call core."],
    docs: [{ title: "Statistics Bureau of Japan: Consumer Price Index", url: "https://www.stat.go.jp/english/data/cpi/index.html", kind: "release" }, BOJ_OUTLOOK],
    calendar: STATJP_CAL,
  }),
  "jp.unemp": make("JP", "unemp", {
    measures: "Japan's unemployment rate, both sexes, seasonally adjusted.",
    construction: "Survey data from the Statistics Bureau of Japan's Labour Force Survey, ILO-consistent definitions.",
    schedule: "Statistics Bureau of Japan: monthly, at the end of the following month, 08:30 JST.",
    pitfalls: ["Japan's rate moves in a narrow band; a 0.1 point change is often within noise."],
    docs: [{ title: "Statistics Bureau of Japan: Labour Force Survey", url: "https://www.stat.go.jp/english/data/roudou/index.html", kind: "release" }],
    calendar: STATJP_CAL,
  }),
  "jp.gdp": make("JP", "gdp", {
    measures: "Japan's real GDP growth, year-on-year, computed by this terminal from the seasonally adjusted real GDP level.",
    construction: "Hard data from the Cabinet Office's quarterly national accounts (chained volumes), retrieved from FRED (series JPNRGDPEXP). The Cabinet Office's own headline is quarter-on-quarter annualised.",
    schedule: "Cabinet Office, Government of Japan: first preliminary estimate about 45 days after the quarter, second preliminary estimate about a month later; FRED republishes after release.",
    pitfalls: ["The second preliminary estimate often revises the first noticeably as corporate investment data arrive."],
    docs: [{ title: "Cabinet Office (ESRI): Quarterly estimates of GDP", url: "https://www.esri.cao.go.jp/en/sna/sokuhou/sokuhou_top.html", kind: "release" }, BOJ_OUTLOOK],
    calendar: { url: "https://www.esri.cao.go.jp/en/sna/sokuhou/sokuhou_top.html", label: "Cabinet Office (ESRI) release schedule (on the GDP page)" },
  }),
  "jp.y10": make("JP", "y10", {
    measures: "The 10-year Japanese Government Bond constant-maturity yield published by the Ministry of Finance.",
    construction: "Market data: the Ministry of Finance publishes daily yields by maturity estimated from JGB market prices (jgbcme.csv).",
    schedule: "Ministry of Finance Japan, each business day; history up to the previous month and the current month are published as separate files.",
    pitfalls: ["The Bank of Japan's yield-curve control (2016–2024) capped this yield for years, so history before 2024 reflects policy limits."],
    docs: [{ title: "Ministry of Finance Japan: JGB interest rates", url: "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/index.htm", kind: "data" }],
    calendar: { url: "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/index.htm", label: "Ministry of Finance (published each business day)" },
  }),

  // ═════════ Canada ═════════
  "ca.policy": make("CA", "policy", {
    measures: "The Bank of Canada's target for the overnight rate (its policy interest rate).",
    construction: "A policy decision by the Bank of Canada's Governing Council, recorded daily (Valet series V39079).",
    schedule: "Bank of Canada: eight fixed announcement dates a year at 9:45 a.m. ET, four of them with a Monetary Policy Report.",
    docs: [{ title: "Bank of Canada: Policy interest rate", url: "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/", kind: "central bank" }, BOC_MPR],
    calendar: BOC_CAL, feedMatch: POLICY_FEED,
  }),
  "ca.cpi": make("CA", "cpi", {
    measures: "Canada's consumer price index, all items, year-on-year change computed by this terminal from the published (not seasonally adjusted) index.",
    construction: "Hard data: Statistics Canada collects prices of a fixed basket; index 2002 = 100, published rounded to one decimal (computed y/y can differ by about 0.1 point).",
    schedule: "Statistics Canada: monthly, usually on the third Tuesday of the following month, 8:30 a.m. ET.",
    pitfalls: ["Mortgage interest cost is part of Canadian CPI, so rate hikes can raise measured inflation mechanically."],
    docs: [{ title: "Statistics Canada: Consumer price indexes", url: "https://www150.statcan.gc.ca/n1/en/subjects/prices_and_price_indexes/consumer_price_indexes", kind: "release" }, BOC_MPR],
    calendar: STATCAN_CAL,
  }),
  "ca.core": make("CA", "core", {
    measures: "CPI-trim: one of the Bank of Canada's preferred measures of core inflation, a trimmed mean that excludes the 20% of components with the most extreme price changes each month.",
    construction: "Hard data computed by Statistics Canada from CPI components (Table 18-10-0256-01); published year-over-year rate.",
    schedule: "Statistics Canada: with the CPI, monthly, 8:30 a.m. ET.",
    pitfalls: ["The Bank of Canada also watches CPI-median; the two can differ by several tenths.", "Core measures are revised as seasonal factors are updated."],
    glossary: ["trimmed_mean"],
    docs: [{ title: "Bank of Canada: Price indexes and core inflation measures", url: "https://www.bankofcanada.ca/rates/price-indexes/cpi/", kind: "central bank" }, BOC_MPR],
    calendar: STATCAN_CAL,
  }),
  "ca.unemp": make("CA", "unemp", {
    measures: "Canada's unemployment rate, persons 15 and over, seasonally adjusted.",
    construction: "Survey data from Statistics Canada's Labour Force Survey (Table 14-10-0287-01).",
    schedule: "Statistics Canada: monthly, usually the first Friday of the following month (often the same morning as the US jobs report), 8:30 a.m. ET.",
    docs: [{ title: "Statistics Canada: Labour Force Survey (survey description)", url: "https://www23.statcan.gc.ca/imdb/p2SV.pl?Function=getSurvey&SDDS=3701", kind: "methodology" }, { title: "Statistics Canada: Employment and unemployment", url: "https://www150.statcan.gc.ca/n1/en/subjects/labour_/employment_and_unemployment", kind: "release" }],
    calendar: STATCAN_CAL,
  }),
  "ca.gdp": make("CA", "gdp", {
    measures: "Canada's real GDP growth, year-on-year, computed by this terminal from seasonally adjusted chained (2017) dollar levels.",
    construction: "Hard data: Statistics Canada quarterly national accounts, expenditure-based (Table 36-10-0104-01). Statistics Canada's own headline is the quarterly change at an annualised rate.",
    schedule: "Statistics Canada: quarterly, about two months after the quarter, 8:30 a.m. ET; a monthly GDP-by-industry estimate is also published.",
    docs: [{ title: "Statistics Canada: Gross domestic product, expenditure-based (Table 36-10-0104-01)", url: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=3610010401", kind: "data" }, BOC_MPR],
    calendar: STATCAN_CAL,
  }),
  "ca.y10": make("CA", "y10", {
    measures: "The yield on the Government of Canada 10-year benchmark bond.",
    construction: "Market data published by the Bank of Canada (Valet series BD.CDN.10YR.DQ.YLD).",
    schedule: "Bank of Canada, each business day.",
    docs: [{ title: "Bank of Canada: Government of Canada bond yields", url: "https://www.bankofcanada.ca/rates/interest-rates/canadian-bonds/", kind: "data" }],
    calendar: { url: "https://www.bankofcanada.ca/rates/interest-rates/canadian-bonds/", label: "Bank of Canada (published each business day)" },
  }),

  // ═════════ Australia ═════════
  "au.policy": make("AU", "policy", {
    measures: "The RBA cash rate target: the RBA's target for the interest rate on unsecured overnight loans between banks.",
    construction: "A policy decision, from the RBA's statistical table A2 (republished by DBnomics). The observation date is the date a new rate took effect.",
    schedule: "Reserve Bank of Australia Monetary Policy Board: eight meetings a year; decisions at 2:30 p.m. Sydney time, with a Statement on Monetary Policy four times a year.",
    docs: [{ title: "RBA: Cash rate target", url: "https://www.rba.gov.au/statistics/cash-rate/", kind: "central bank" }, RBA_SMP],
    calendar: RBA_CAL, feedMatch: POLICY_FEED,
  }),
  "au.cpi": make("AU", "cpi", {
    measures: "Australia's consumer price index, year-ended inflation as published, quarterly series.",
    construction: "Hard data from the Australian Bureau of Statistics, republished by the RBA in table G1. The ABS moved to a complete monthly CPI as its main measure in late 2025; this row shows the quarterly series the RBA republishes.",
    schedule: "Australian Bureau of Statistics: quarterly CPI about four weeks after the quarter, 11:30 a.m. Canberra time (the monthly CPI is published separately).",
    pitfalls: ["Government rebates (electricity, rent assistance) have moved headline CPI in specific quarters."],
    docs: [{ title: "ABS: Consumer Price Index, Australia", url: "https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia", kind: "release" }, RBA_SMP],
    calendar: ABS_CAL,
  }),
  "au.core": make("AU", "core", {
    measures: "Trimmed-mean inflation: the RBA's preferred measure of underlying inflation, excluding the components with the largest price changes each quarter (and interest charges and tax changes).",
    construction: "Hard data computed by the ABS, republished by the RBA in table G1; year-ended rate as published.",
    schedule: "Australian Bureau of Statistics: with the CPI, 11:30 a.m. Canberra time.",
    glossary: ["trimmed_mean"],
    docs: [{ title: "ABS: Consumer Price Index, Australia", url: "https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia", kind: "release" }, RBA_SMP],
    calendar: ABS_CAL,
  }),
  "au.unemp": make("AU", "unemp", {
    measures: "Australia's unemployment rate, seasonally adjusted.",
    construction: "Survey data from the ABS Labour Force Survey, republished by the RBA in table H5.",
    schedule: "Australian Bureau of Statistics: monthly, about three weeks after the month (usually a Thursday), 11:30 a.m. Canberra time.",
    pitfalls: ["Rotation of the survey sample can create noise in individual months."],
    docs: [{ title: "ABS: Labour Force, Australia", url: "https://www.abs.gov.au/statistics/labour/employment-and-unemployment/labour-force-australia", kind: "release" }],
    calendar: ABS_CAL,
  }),
  "au.gdp": make("AU", "gdp", {
    measures: "Australia's real GDP growth, year-ended, chain volume measures.",
    construction: "Hard data from the ABS Australian National Accounts, republished by the RBA in table H1.",
    schedule: "Australian Bureau of Statistics: quarterly, early in the third month after the quarter (usually a Wednesday), 11:30 a.m. Canberra time.",
    docs: [{ title: "ABS: Australian National Accounts", url: "https://www.abs.gov.au/statistics/economy/national-accounts/australian-national-accounts-national-income-expenditure-and-product", kind: "release" }, RBA_SMP],
    calendar: ABS_CAL,
  }),
  "au.y10": make("AU", "y10", {
    measures: "The Australian Government 10-year bond yield.",
    construction: "Market data: indicative mid-market yields published by the RBA in table F2 (republished by DBnomics).",
    schedule: "Reserve Bank of Australia, each business day (DBnomics mirror with a short delay).",
    docs: [{ title: "RBA: Statistical tables (interest rates)", url: "https://www.rba.gov.au/statistics/tables/", kind: "data" }],
    calendar: { url: "https://www.rba.gov.au/statistics/tables/", label: "RBA statistical tables (updated each business day)" },
  }),

  // ═════════ New Zealand ═════════
  "nz.policy": make("NZ", "policy", {
    measures: "The Official Cash Rate (OCR) set by the Reserve Bank of New Zealand.",
    construction: "A policy decision, taken here from the BIS central-bank policy-rate dataset (reported by the RBNZ).",
    schedule: "Reserve Bank of New Zealand Monetary Policy Committee: seven decisions a year at 2:00 p.m. NZ time, four with a Monetary Policy Statement.",
    docs: [{ title: "RBNZ: The Official Cash Rate", url: "https://www.rbnz.govt.nz/monetary-policy/about-monetary-policy/the-official-cash-rate", kind: "central bank" }, RBNZ_MPS],
    calendar: RBNZ_CAL, feedMatch: POLICY_FEED,
  }),
  "nz.cpi": make("NZ", "cpi", {
    measures: "New Zealand's consumer price index, all items, annual change, quarterly.",
    construction: "Hard data from Stats NZ, taken here from the IMF CPI dataset (compiled from national statistics), annual rate as published by the IMF.",
    schedule: "Stats NZ: quarterly, about three weeks after the quarter, 10:45 a.m. NZ time.",
    pitfalls: ["Quarterly frequency: each figure is up to four months old by the time the next is published."],
    docs: [{ title: "Stats NZ: Consumers price index", url: "https://www.stats.govt.nz/topics/consumers-price-index", kind: "release" }, RBNZ_MPS],
    calendar: STATSNZ_CAL,
  }),
  "nz.unemp": make("NZ", "unemp", {
    measures: "New Zealand's unemployment rate, persons 15 and over, harmonised, quarterly.",
    construction: "Survey data from the Stats NZ Household Labour Force Survey, harmonised by the OECD and retrieved from FRED.",
    schedule: "Stats NZ: quarterly, about five weeks after the quarter, 10:45 a.m. NZ time; the OECD/FRED republication follows.",
    docs: [{ title: "Stats NZ: Employment and unemployment", url: "https://www.stats.govt.nz/topics/employment-and-unemployment", kind: "release" }],
    calendar: STATSNZ_CAL,
  }),
  "nz.y10": make("NZ", "y10", {
    measures: "New Zealand long-term (10-year) government bond yield, monthly average.",
    construction: "Market data averaged over the month, from the OECD Main Economic Indicators (based on RBNZ data), retrieved from FRED (IRLTLT01NZM156N). The RBNZ's own daily file server refused automated requests (HTTP 403) when checked.",
    schedule: "OECD, monthly, a few weeks after the month ends; FRED republishes.",
    docs: [OECD_LTR, { title: "RBNZ: Wholesale interest rates (B2)", url: "https://www.rbnz.govt.nz/statistics/series/exchange-and-interest-rates/wholesale-interest-rates", kind: "data" }],
    calendar: { url: "https://www.oecd.org/en/data/indicators/long-term-interest-rates.html", label: "OECD long-term interest rates (monthly)" },
  }),

  // ═════════ Switzerland ═════════
  "ch.policy": make("CH", "policy", {
    measures: "The SNB policy rate: the rate the Swiss National Bank sets to steer short-term Swiss franc money-market rates; the SNB aims to keep SARON, the secured overnight reference rate, close to it.",
    construction: "A policy decision by the Swiss National Bank, from the SNB data portal (daily series).",
    schedule: "Swiss National Bank: quarterly monetary policy assessments (March, June, September, December), announced at 9:30 a.m. Zurich time.",
    pitfalls: ["The SNB also uses foreign-exchange interventions as a policy tool, which this rate does not show."],
    docs: [SNB_DECISIONS],
    calendar: SNB_CAL, feedMatch: POLICY_FEED,
  }),
  "ch.cpi": make("CH", "cpi", {
    measures: "Switzerland's national consumer price index, year-on-year change as published.",
    construction: "Hard data from the Swiss Federal Statistical Office (FSO), published through the SNB data portal; the index is rebased periodically by the FSO.",
    schedule: "Swiss Federal Statistical Office: monthly, in the first days of the following month, 8:30 a.m. Zurich time.",
    pitfalls: ["Swiss inflation is low and moves in tenths; the strong franc dampens imported inflation."],
    docs: [{ title: "FSO: Consumer price index", url: "https://www.bfs.admin.ch/bfs/en/home/statistics/prices/consumer-price-index.html", kind: "release" }, SNB_DECISIONS],
    calendar: FSO_CAL,
  }),
  "ch.core": make("CH", "core", {
    measures: "The SNB's trimmed-mean core inflation measure, year-on-year.",
    construction: "Computed by the Swiss National Bank from CPI components and published on its data portal.",
    schedule: "Swiss National Bank data portal, after the FSO's monthly CPI release.",
    pitfalls: ["The FSO publishes its own 'core' (excluding fresh and seasonal products, energy and fuel), which differs from the SNB trimmed mean."],
    glossary: ["trimmed_mean"],
    docs: [{ title: "SNB data portal", url: "https://data.snb.ch/en", kind: "data" }, SNB_DECISIONS],
    calendar: FSO_CAL,
  }),
  "ch.gdp": make("CH", "gdp", {
    measures: "Switzerland's real GDP growth, year-on-year, computed by this terminal from chain-linked volumes.",
    construction: "Hard data: quarterly GDP estimates by the State Secretariat for Economic Affairs (SECO), retrieved via Eurostat's republication on FRED.",
    schedule: "SECO: quarterly, about two months after the quarter; Eurostat and FRED republish later.",
    pitfalls: ["SECO also publishes GDP adjusted for major sporting events, which can differ noticeably in event years."],
    docs: [{ title: "SECO: Quarterly GDP estimates", url: "https://www.seco.admin.ch/seco/en/home/wirtschaftslage---wirtschaftspolitik/Wirtschaftslage/bip-quartalsschaetzungen-.html", kind: "release" }],
    calendar: { url: "https://www.seco.admin.ch/seco/en/home/wirtschaftslage---wirtschaftspolitik/Wirtschaftslage/bip-quartalsschaetzungen-.html", label: "SECO GDP release dates (on the GDP page)" },
  }),
  "ch.unemp": make("CH", "unemp", {
    measures: "Switzerland's unemployment rate, persons 15 and over, harmonised (ILO-based), quarterly.",
    construction: "Survey data (Swiss Labour Force Survey) harmonised by the OECD, retrieved from FRED. SECO's monthly registered-unemployment rate is a different, lower measure.",
    schedule: "FSO quarterly labour-force results, then OECD/FRED republication.",
    pitfalls: ["Do not compare with SECO's registered unemployment rate, which counts only people registered at job centres."],
    docs: [{ title: "FSO: Unemployment according to the ILO", url: "https://www.bfs.admin.ch/bfs/en/home/statistics/work-income/unemployment-underemployment.html", kind: "release" }],
    calendar: FSO_CAL,
  }),
  "ch.y10": make("CH", "y10", {
    measures: "Swiss long-term (10-year) government bond yield, monthly average.",
    construction: "Market data averaged over the month, from the OECD Main Economic Indicators (based on SNB data), retrieved from FRED (IRLTLT01CHM156N). The SNB's own bond-yield cube on its data portal had not been updated since 2025 when checked.",
    schedule: "OECD, monthly, a few weeks after the month ends; FRED republishes.",
    docs: [OECD_LTR, { title: "SNB data portal", url: "https://data.snb.ch/en", kind: "data" }],
    calendar: { url: "https://www.oecd.org/en/data/indicators/long-term-interest-rates.html", label: "OECD long-term interest rates (monthly)" },
  }),
};
