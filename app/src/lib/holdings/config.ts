import type { ManagerRef } from "./types";

// ────────────────────────────────────────────────────────────
// Curated managers. CIKs were resolved from the SEC's own Form 13F bulk data set (COVERPAGE name + SUBMISSION CIK,
// period 30-JUN-2026, 13F-HR) on 2026-10-09 and the name below is the filer name as filed. The server re-checks
// each CIK against data.sec.gov/submissions at run time. Left out on purpose: Baupost and Duquesne (reported
// total value of about $5 million for a multi-billion portfolio, i.e. a filer units error that would be shown as fact).
// ────────────────────────────────────────────────────────────

export const MANAGERS: ManagerRef[] = [
  { cik: "0001067983", name: "Berkshire Hathaway Inc", group: "Holding company / family office" },
  { cik: "0000060086", name: "Loews Corp", group: "Holding company / family office" },
  { cik: "0001350694", name: "Bridgewater Associates, LP", group: "Hedge fund" },
  { cik: "0001037389", name: "Renaissance Technologies LLC", group: "Hedge fund" },
  { cik: "0001423053", name: "Citadel Advisors LLC", group: "Hedge fund" },
  { cik: "0001179392", name: "Two Sigma Investments, LP", group: "Hedge fund" },
  { cik: "0001009207", name: "D. E. Shaw & Co., Inc.", group: "Hedge fund" },
  { cik: "0001167557", name: "AQR Capital Management LLC", group: "Hedge fund" },
  { cik: "0001273087", name: "Millennium Management LLC", group: "Hedge fund" },
  { cik: "0001603466", name: "Point72 Asset Management, L.P.", group: "Hedge fund" },
  { cik: "0001167483", name: "Tiger Global Management LLC", group: "Hedge fund" },
  { cik: "0001135730", name: "Coatue Management LLC", group: "Hedge fund" },
  { cik: "0001103804", name: "Viking Global Investors LP", group: "Hedge fund" },
  { cik: "0001061165", name: "Lone Pine Capital LLC", group: "Hedge fund" },
  { cik: "0000934639", name: "Maverick Capital Ltd", group: "Hedge fund" },
  { cik: "0001517857", name: "Soroban Capital Partners LP", group: "Hedge fund" },
  { cik: "0001029160", name: "Soros Fund Management LLC", group: "Hedge fund" },
  { cik: "0001656456", name: "Appaloosa LP", group: "Hedge fund" },
  { cik: "0001040273", name: "Third Point LLC", group: "Activist" },
  { cik: "0002026053", name: "Pershing Square Inc.", group: "Activist" },
  { cik: "0001791786", name: "Elliott Investment Management L.P.", group: "Activist" },
  { cik: "0000921669", name: "Icahn Carl C", group: "Activist" },
  { cik: "0001647251", name: "TCI Fund Management Ltd", group: "Activist" },
  { cik: "0001418814", name: "ValueAct Holdings, L.P.", group: "Activist" },
  { cik: "0002012383", name: "BlackRock, Inc.", group: "Asset manager" },
  { cik: "0000093751", name: "State Street Corp", group: "Asset manager" },
  { cik: "0000315066", name: "FMR LLC", group: "Asset manager" },
  { cik: "0000902219", name: "Wellington Management Group LLP", group: "Asset manager" },
  { cik: "0000200217", name: "Dodge & Cox", group: "Asset manager" },
  { cik: "0001374170", name: "Norges Bank", group: "Sovereign fund" },
];

export const MANAGER_BY_CIK: Record<string, ManagerRef> = Object.fromEntries(MANAGERS.map((m) => [m.cik, m]));

/** Shown on the page and repeated in the Copilot output. */
export const THIRTEEN_F_NOTE =
  "Form 13F covers US-listed long positions held by institutional managers above $100 million, reported as of quarter end and filed up to 45 days later. "
  + "It excludes short positions, most non-US holdings and cash, and it is not a real-time view and not a signal. "
  + "Options appear as separate Put/Call lines. Values are as filed (whole US dollars).";

export const MAX_ROWS = 100;
export const MAX_EXITED = 25;
export const TOP_HOLDERS = 25;
