import sp500Raw from "@/data/sp500.json";
import nasdaq100Raw from "@/data/nasdaq100.json";
import dow30Raw from "@/data/dow30.json";

// ────────────────────────────────────────────────────────────
// Constituent universe — static membership (checked-in JSON, refreshed by
// hand) + live price/change from the Yahoo pipeline elsewhere. Sector/industry
// are baked in so QCARD grouping and the HEAT treemap need no per-ticker
// profile fan-out; market cap is fetched live (see `fetchQuotes`).
// ────────────────────────────────────────────────────────────

export type IndexId = "sp500" | "nasdaq100" | "dow30";

export interface Constituent {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  /** Market-cap snapshot (USD) — hand-refreshed, used for treemap sizing / sort. */
  marketCap: number;
  /** which of the tracked indices this ticker belongs to */
  indices: IndexId[];
}

interface RawConstituent { symbol: string; name: string; sector: string; industry: string; marketCap: number; }

const sp500 = sp500Raw as RawConstituent[];
const nasdaq100 = nasdaq100Raw as string[];
const dow30 = dow30Raw as string[];

/** Metadata for Nasdaq-100 members that are not in the S&P 500 base list. */
const EXTRA: RawConstituent[] = [
  { symbol: "ARM",  name: "Arm Holdings",                   sector: "Information Technology", industry: "Semiconductors",                       marketCap: 270545403904 },
  { symbol: "ASML", name: "ASML Holding",                   sector: "Information Technology", industry: "Semiconductor Materials & Equipment",  marketCap: 692524613632 },
  { symbol: "AZN",  name: "AstraZeneca",                    sector: "Health Care",            industry: "Pharmaceuticals",                      marketCap: 248296833024 },
  { symbol: "TEAM", name: "Atlassian",                      sector: "Information Technology", industry: "Application Software",                  marketCap: 41261625344 },
  { symbol: "CCEP", name: "Coca-Cola Europacific Partners", sector: "Consumer Staples",       industry: "Soft Drinks & Non-alcoholic Beverages", marketCap: 47480168448 },
  { symbol: "EA",   name: "Electronic Arts",                sector: "Communication Services", industry: "Interactive Home Entertainment",       marketCap: 52925640704 },
  { symbol: "GFS",  name: "GlobalFoundries",                sector: "Information Technology", industry: "Semiconductors",                       marketCap: 27380174848 },
  { symbol: "MELI", name: "MercadoLibre",                   sector: "Consumer Discretionary", industry: "Broadline Retail",                     marketCap: 90196705280 },
  { symbol: "MSTR", name: "Strategy (MicroStrategy)",       sector: "Information Technology", industry: "Application Software",                  marketCap: 36756496384 },
  { symbol: "PDD",  name: "PDD Holdings",                   sector: "Consumer Discretionary", industry: "Broadline Retail",                     marketCap: 124219809792 },
  { symbol: "ZS",   name: "Zscaler",                        sector: "Information Technology", industry: "Systems Software",                     marketCap: 30029457408 },
];

const spSet = new Set(sp500.map((c) => c.symbol));
const nqSet = new Set(nasdaq100);
const dowSet = new Set(dow30);

function membership(symbol: string): IndexId[] {
  const ids: IndexId[] = [];
  if (spSet.has(symbol)) ids.push("sp500");
  if (nqSet.has(symbol)) ids.push("nasdaq100");
  if (dowSet.has(symbol)) ids.push("dow30");
  return ids;
}

// Merge base + extras into one keyed universe, then attach membership tags.
const bySymbol = new Map<string, RawConstituent>();
for (const c of [...sp500, ...EXTRA]) if (!bySymbol.has(c.symbol)) bySymbol.set(c.symbol, c);

export const UNIVERSE: Constituent[] = Array.from(bySymbol.values())
  .map((c) => ({ ...c, indices: membership(c.symbol) }))
  .filter((c) => c.indices.length > 0)
  .sort((a, b) => (a.symbol < b.symbol ? -1 : 1));

export const CONSTITUENT_BY_SYMBOL: Record<string, Constituent> = Object.fromEntries(
  UNIVERSE.map((c) => [c.symbol, c])
);

/** Sorted distinct sectors present in the universe. */
export const UNIVERSE_SECTORS: string[] = Array.from(new Set(UNIVERSE.map((c) => c.sector))).sort();

/** Sorted distinct industries, optionally scoped to one sector. */
export function industriesForSector(sector?: string): string[] {
  const pool = sector ? UNIVERSE.filter((c) => c.sector === sector) : UNIVERSE;
  return Array.from(new Set(pool.map((c) => c.industry))).sort();
}

export const INDEX_LABELS: Record<IndexId, string> = {
  sp500: "S&P 500",
  nasdaq100: "Nasdaq 100",
  dow30: "Dow 30",
};

/** Filter the universe to one index membership. */
export function membersOf(index: IndexId): Constituent[] {
  return UNIVERSE.filter((c) => c.indices.includes(index));
}
