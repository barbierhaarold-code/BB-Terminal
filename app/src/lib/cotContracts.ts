// ────────────────────────────────────────────────────────────
// CFTC Commitments of Traders — contract registry + dataset schemas.
//
// Shared by the server proxy (vite-plugins/cot.ts) and the client module
// (lib/cot.ts). Every dataset id, contract code and field name below was
// discovered from the CFTC's own Socrata metadata
// (https://publicreporting.cftc.gov/api/views/<id>.json) and checked with live
// queries — not recalled from memory. Note the CFTC's field names are not
// uniform (e.g. `swap__positions_short_all` has a double underscore,
// `tot_rept_positions_short` has no `_all`), so they are spelled out literally.
//
// Basis: FUTURES ONLY. That is what the previous Tradingster-based feed showed
// (its URL was /cot/legacy-futures/…), so numbers stay comparable. The six
// datasets are futures-only + combined for each of Legacy / Disaggregated / TFF.
// ────────────────────────────────────────────────────────────

export type CotReportType = "tff" | "disagg";

export const COT_SOCRATA_HOST = "https://publicreporting.cftc.gov";

export interface CotDatasetDef {
  id: string;
  name: string;
  report: CotReportType;
}

export const COT_DATASETS: Record<CotReportType, CotDatasetDef> = {
  tff: { id: "gpe5-46if", name: "Traders in Financial Futures (TFF) — Futures Only", report: "tff" },
  disagg: { id: "72hh-3qpy", name: "Disaggregated — Futures Only", report: "disagg" },
};

/** Legacy futures-only dataset. NOT used by the app at runtime — only by the evidence scripts to compare against the old Tradingster feed. */
export const COT_LEGACY_FUTURES_ONLY_ID = "6dca-aqww";

export interface CotCategoryDef {
  id: string;
  label: string;
  /** one-line plain-English description (also reused by the ABOUT note) */
  desc: string;
  longField: string;
  shortField: string;
  changeLongField: string;
  changeShortField: string;
}

export const COT_CATEGORIES: Record<CotReportType, CotCategoryDef[]> = {
  tff: [
    {
      id: "dealer", label: "Dealer / Intermediary",
      desc: "Sell-side banks and dealers that make markets and hedge client flow. Usually the mirror image of the other groups.",
      longField: "dealer_positions_long_all", shortField: "dealer_positions_short_all",
      changeLongField: "change_in_dealer_long_all", changeShortField: "change_in_dealer_short_all",
    },
    {
      id: "asset_mgr", label: "Asset Manager / Institutional",
      desc: "Pension funds, insurers, mutual funds and other institutional investors. Slower, longer-horizon positioning.",
      longField: "asset_mgr_positions_long", shortField: "asset_mgr_positions_short",
      changeLongField: "change_in_asset_mgr_long", changeShortField: "change_in_asset_mgr_short",
    },
    {
      id: "lev_money", label: "Leveraged Funds",
      desc: "Hedge funds and other money managers using leverage; the fastest-moving speculative group in financial futures.",
      longField: "lev_money_positions_long", shortField: "lev_money_positions_short",
      changeLongField: "change_in_lev_money_long", changeShortField: "change_in_lev_money_short",
    },
    {
      id: "other_rept", label: "Other Reportables",
      desc: "Large traders that fit none of the groups above (e.g. corporates, some proprietary firms).",
      longField: "other_rept_positions_long", shortField: "other_rept_positions_short",
      changeLongField: "change_in_other_rept_long", changeShortField: "change_in_other_rept_short",
    },
    {
      id: "nonrept", label: "Non-reportable",
      desc: "Small traders below the CFTC reporting threshold; derived as the remainder of open interest.",
      longField: "nonrept_positions_long_all", shortField: "nonrept_positions_short_all",
      changeLongField: "change_in_nonrept_long_all", changeShortField: "change_in_nonrept_short_all",
    },
  ],
  disagg: [
    {
      id: "prod_merc", label: "Producer / Merchant",
      desc: "Producers, processors, merchants and users of the physical commodity; they hold futures mainly to hedge.",
      longField: "prod_merc_positions_long", shortField: "prod_merc_positions_short",
      changeLongField: "change_in_prod_merc_long", changeShortField: "change_in_prod_merc_short",
    },
    {
      id: "swap", label: "Swap Dealers",
      desc: "Dealers that hold futures to hedge swap business with clients (index funds, hedgers).",
      longField: "swap_positions_long_all", shortField: "swap__positions_short_all",
      changeLongField: "change_in_swap_long_all", changeShortField: "change_in_swap_short_all",
    },
    {
      id: "m_money", label: "Managed Money",
      desc: "Commodity trading advisors, commodity pool operators and hedge funds trading on behalf of clients; the main speculative group.",
      longField: "m_money_positions_long_all", shortField: "m_money_positions_short_all",
      changeLongField: "change_in_m_money_long_all", changeShortField: "change_in_m_money_short_all",
    },
    {
      id: "other_rept", label: "Other Reportables",
      desc: "Large traders that fit none of the groups above.",
      longField: "other_rept_positions_long", shortField: "other_rept_positions_short",
      changeLongField: "change_in_other_rept_long", changeShortField: "change_in_other_rept_short",
    },
    {
      id: "nonrept", label: "Non-reportable",
      desc: "Small traders below the CFTC reporting threshold; derived as the remainder of open interest.",
      longField: "nonrept_positions_long_all", shortField: "nonrept_positions_short_all",
      changeLongField: "change_in_nonrept_long_all", changeShortField: "change_in_nonrept_short_all",
    },
  ],
};

/** The category shown by default per report: the speculative group the old feed's "non-commercial" most resembles. */
export const COT_PRIMARY_CATEGORY: Record<CotReportType, string> = { tff: "lev_money", disagg: "m_money" };

export type CotGroup = "FX" | "Index" | "Crypto" | "Metals" | "Energy";

export interface CotContractDef {
  key: string;
  name: string;
  short: string;
  /** CFTC contract-market code (cftc_contract_market_code) */
  code: string;
  report: CotReportType;
  group: CotGroup;
  /** sanity check on the exchange/contract name the CFTC returns for this code */
  nameMatch: RegExp;
}

export const COT_CONTRACTS: CotContractDef[] = [
  { key: "eur",    name: "Euro FX",            short: "EUR", code: "099741", report: "tff",    group: "FX",     nameMatch: /^EURO FX - CHICAGO MERCANTILE/i },
  { key: "gbp",    name: "British Pound",      short: "GBP", code: "096742", report: "tff",    group: "FX",     nameMatch: /^BRITISH POUND - CHICAGO MERCANTILE/i },
  { key: "jpy",    name: "Japanese Yen",       short: "JPY", code: "097741", report: "tff",    group: "FX",     nameMatch: /^JAPANESE YEN - CHICAGO MERCANTILE/i },
  { key: "aud",    name: "Australian Dollar",  short: "AUD", code: "232741", report: "tff",    group: "FX",     nameMatch: /^AUSTRALIAN DOLLAR - CHICAGO MERCANTILE/i },
  { key: "cad",    name: "Canadian Dollar",    short: "CAD", code: "090741", report: "tff",    group: "FX",     nameMatch: /^CANADIAN DOLLAR - CHICAGO MERCANTILE/i },
  { key: "chf",    name: "Swiss Franc",        short: "CHF", code: "092741", report: "tff",    group: "FX",     nameMatch: /^SWISS FRANC - CHICAGO MERCANTILE/i },
  { key: "nzd",    name: "New Zealand Dollar", short: "NZD", code: "112741", report: "tff",    group: "FX",     nameMatch: /^NZ DOLLAR - CHICAGO MERCANTILE/i },
  { key: "dxy",    name: "US Dollar Index",    short: "DXY", code: "098662", report: "tff",    group: "FX",     nameMatch: /^USD INDEX - ICE FUTURES U\.S\./i },
  { key: "es",     name: "E-mini S&P 500",     short: "ES",  code: "13874A", report: "tff",    group: "Index",  nameMatch: /^E-MINI S&P 500 - CHICAGO MERCANTILE/i },
  { key: "nq",     name: "E-mini Nasdaq-100",  short: "NQ",  code: "209742", report: "tff",    group: "Index",  nameMatch: /^NASDAQ MINI - CHICAGO MERCANTILE/i },
  { key: "btc",    name: "Bitcoin (CME)",      short: "BTC", code: "133741", report: "tff",    group: "Crypto", nameMatch: /^BITCOIN - CHICAGO MERCANTILE/i },
  { key: "gold",   name: "Gold",               short: "GC",  code: "088691", report: "disagg", group: "Metals", nameMatch: /^GOLD - COMMODITY EXCHANGE/i },
  { key: "silver", name: "Silver",             short: "SI",  code: "084691", report: "disagg", group: "Metals", nameMatch: /^SILVER - COMMODITY EXCHANGE/i },
  { key: "wti",    name: "WTI Crude Oil",      short: "CL",  code: "067651", report: "disagg", group: "Energy", nameMatch: /^WTI-PHYSICAL - NEW YORK MERCANTILE/i },
];

export const COT_CONTRACT_BY_KEY: Record<string, CotContractDef> = Object.fromEntries(COT_CONTRACTS.map((c) => [c.key, c]));

/** Weekly observations per lookback (52 reports/year). */
export const COT_LOOKBACKS = { y3: 156, y5: 260 } as const;
