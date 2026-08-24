/**
 * Curated list of major institutional 13F filers, each CIK verified live
 * against the SEC's free `form_13f` endpoint (real, non-empty holdings —
 * not just a name match) before being added here. SEC's `institutions_search`
 * often returns several near-duplicate entities per manager (holding co,
 * regional subsidiary, small captive fund); picking the wrong one silently
 * returns a tiny, wrong portfolio instead of erroring, so every CIK below
 * was checked against its actual top-holding value for plausibility.
 */
export interface FundEntry {
  cik: string;
  name: string;
}

export const FUND_UNIVERSE: FundEntry[] = [
  { cik: "0000102909", name: "Vanguard Group" },
  { cik: "0001364742", name: "BlackRock" },
  { cik: "0000093751", name: "State Street Corp" },
  { cik: "0000315066", name: "FMR LLC (Fidelity)" },
  { cik: "0001067983", name: "Berkshire Hathaway" },
  { cik: "0001214717", name: "Geode Capital Management" },
  { cik: "0000019617", name: "JPMorgan Chase & Co" },
  { cik: "0000895421", name: "Morgan Stanley" },
  { cik: "0000886982", name: "Goldman Sachs Group" },
  { cik: "0000902219", name: "Wellington Management Group" },
  { cik: "0000073124", name: "Northern Trust Corp" },
  { cik: "0000914208", name: "Invesco" },
  { cik: "0000070858", name: "Bank of America Corp" },
  { cik: "0001422849", name: "Capital World Investors" },
  { cik: "0001374170", name: "Norges Bank" },
  { cik: "0001273087", name: "Millennium Management" },
  { cik: "0001350694", name: "Bridgewater Associates" },
  { cik: "0001423053", name: "Citadel Advisors" },
  { cik: "0001037389", name: "Renaissance Technologies" },
  { cik: "0001179392", name: "Two Sigma Investments" },
  { cik: "0001603466", name: "Point72 Asset Management" },
];
