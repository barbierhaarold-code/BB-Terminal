// Country intelligence profiles (MAP > Country Intel layer) — a geopolitical /
// macro-risk profile per country, built only from free official sources:
//   World Bank API       macro snapshot
//   Transparency Intl    Corruption Perceptions Index (CPI)
//   UNDP                 Human Development Index (HDI)
//   US Treasury OFAC     SDN-list addresses located in the country
//   US State Department  travel advisory level
// Deliberately NOT company/market fundamentals: Equity Research, KEY, FA and
// the Markets screens already own those. Each source loads independently
// and is reported with its own status, so a dead source blanks one section
// instead of the whole profile.
import type { Plugin } from "vite";
import { errMessage, fetchWithTimeout, middlewarePlugin, readZip, sendJson } from "./shared";

const WB = "https://api.worldbank.org/v2";
const CPI_URL = "https://images.transparencycdn.org/images/CPI2025_Results.xlsx";
const HDI_URL = "https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Composite_indices_complete_time_series.csv";
const OFAC_ADD_URL = "https://www.treasury.gov/ofac/downloads/add.csv";
const STATE_URL = "https://cadataapi.state.gov/api/TravelAdvisories";
const BOUNDARIES_URL = "https://gisco-services.ec.europa.eu/distribution/v2/countries/geojson/CNTR_RG_60M_2020_4326.geojson";

const HOURS = 3_600_000;

// Process-lifetime memo with TTL; failures are not cached so the next request retries.
const memo = new Map<string, { value: unknown; expires: number }>();
const pending = new Map<string, Promise<unknown>>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  let p = pending.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load().then((v) => { memo.set(key, { value: v, expires: Date.now() + ttlMs }); return v; }).finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

async function getText(url: string, timeoutMs = 40_000): Promise<string> {
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": "BB-Terminal/1.0" } }, timeoutMs);
  if (!r.ok) throw new Error(`${new URL(url).host} returned HTTP ${r.status}`);
  return r.text();
}

// ── World Bank ──────────────────────────────────────────────────────────
interface WbCountry { iso3: string; iso2: string; name: string; capital: string; region: string; income: string }

const loadWbCountries = () => cached("wb-countries", 24 * HOURS, async () => {
  const j = JSON.parse(await getText(`${WB}/country?format=json&per_page=400`));
  const out = new Map<string, WbCountry>();
  for (const c of j[1] ?? []) {
    if (c.region?.value === "Aggregates") continue;
    out.set(c.id, { iso3: c.id, iso2: c.iso2Code, name: c.name, capital: c.capitalCity, region: c.region?.value ?? "", income: c.incomeLevel?.value ?? "" });
  }
  return out;
});

export const WB_INDICATORS = {
  gdp: "NY.GDP.MKTP.CD",
  gdpGrowth: "NY.GDP.MKTP.KD.ZG",
  gdpPerCapita: "NY.GDP.PCAP.CD",
  inflation: "FP.CPI.TOTL.ZG",
  unemployment: "SL.UEM.TOTL.ZS",
  population: "SP.POP.TOTL",
  militaryPctGdp: "MS.MIL.XPND.GD.ZS",
} as const;

type WbPoint = { value: number; year: string };
const loadWbIndicator = (id: string) => cached(`wb-ind-${id}`, 12 * HOURS, async () => {
  const j = JSON.parse(await getText(`${WB}/country/all/indicator/${id}?format=json&mrnev=1&per_page=400`));
  const m = new Map<string, WbPoint>();
  for (const row of j[1] ?? []) if (row.value != null && row.countryiso3code) m.set(row.countryiso3code, { value: row.value, year: row.date });
  return m;
});

// ── CPI (xlsx) ──────────────────────────────────────────────────────────
interface CpiRow { score: number; rank: number }
const loadCpi = () => cached("cpi", 24 * HOURS, async () => {
  const r = await fetchWithTimeout(CPI_URL, { headers: { "User-Agent": "BB-Terminal/1.0" } }, 40_000);
  if (!r.ok) throw new Error(`Transparency International CPI file returned HTTP ${r.status}`);
  const zip = readZip(Buffer.from(await r.arrayBuffer()));
  const sst = zip.get("xl/sharedStrings.xml")?.toString("utf8");
  const sheet = zip.get("xl/worksheets/sheet1.xml")?.toString("utf8");
  if (!sst || !sheet) throw new Error("CPI workbook layout changed (sheet1/sharedStrings missing)");
  const strings = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
  const year = strings.join(" ").match(/Corruption Perceptions Index (\d{4})/)?.[1] ?? "";
  const byIso = new Map<string, CpiRow>();
  for (const row of sheet.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: Record<string, string> = {};
    for (const c of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = c[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (v == null) continue;
      cells[c[1]] = /t="s"/.test(c[2]) ? strings[Number(v)] : v;
    }
    // Header row names the columns; data rows have a 3-letter ISO3 in B and numeric score/rank in D/E.
    if (cells.B && /^[A-Z]{3}$/.test(cells.B) && Number.isFinite(Number(cells.D)) && Number.isFinite(Number(cells.E))) {
      byIso.set(cells.B, { score: Number(cells.D), rank: Number(cells.E) });
    }
  }
  if (byIso.size < 100) throw new Error(`CPI parse produced only ${byIso.size} countries — workbook layout likely changed`);
  return { year, byIso };
});

// ── HDI (UNDP csv) ──────────────────────────────────────────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const loadHdi = () => cached("hdi", 24 * HOURS, async () => {
  const rows = parseCsv(await getText(HDI_URL, 60_000));
  const header = rows[0] ?? [];
  const years = header.map((h) => h.match(/^hdi_(\d{4})$/)?.[1]).filter((y): y is string => !!y).sort();
  const year = years[years.length - 1];
  const iIso = header.indexOf("iso3"), iVal = header.indexOf(`hdi_${year}`), iRank = header.indexOf(`hdi_rank_${year}`), iGroup = header.indexOf("hdicode");
  if (!year || iIso < 0 || iVal < 0) throw new Error("UNDP HDI file layout changed");
  const byIso = new Map<string, { hdi: number; rank: number | null; group: string }>();
  for (const r of rows.slice(1)) {
    const v = Number(r[iVal]);
    if (r[iIso] && Number.isFinite(v) && r[iVal] !== "") byIso.set(r[iIso], { hdi: v, rank: iRank >= 0 && r[iRank] ? Number(r[iRank]) : null, group: r[iGroup] ?? "" });
  }
  return { year, byIso };
});

// ── OFAC SDN addresses ──────────────────────────────────────────────────
// OFAC's name → World Bank name where the two differ.
const OFAC_ALIASES: Record<string, string> = {
  "russia": "russian federation", "iran": "iran, islamic rep.", "syria": "syrian arab republic", "burma": "myanmar",
  "korea, north": "korea, dem. people's rep.", "korea, south": "korea, rep.", "venezuela": "venezuela, rb",
  "egypt": "egypt, arab rep.", "yemen": "yemen, rep.", "laos": "lao pdr", "vietnam": "viet nam", "turkey": "turkiye",
  "hong kong": "hong kong sar, china", "macau": "macao sar, china", "gambia, the": "gambia, the", "bahamas, the": "bahamas, the",
  "congo, democratic republic of the": "congo, dem. rep.", "congo, republic of the": "congo, rep.", "cote d'ivoire": "cote d'ivoire",
  "kyrgyzstan": "kyrgyz republic", "slovakia": "slovak republic", "czech republic": "czechia", "brunei": "brunei darussalam",
  "cabo verde": "cabo verde", "macedonia": "north macedonia", "swaziland": "eswatini", "gaza strip": "west bank and gaza", "west bank": "west bank and gaza",
  "saint lucia": "st. lucia", "saint kitts and nevis": "st. kitts and nevis", "saint vincent and the grenadines": "st. vincent and the grenadines",
  "south korea": "korea, rep.", "north korea": "korea, dem. people's rep.", "burma (myanmar)": "myanmar", "the bahamas": "bahamas, the",
  "the gambia": "gambia, the", "republic of the congo": "congo, rep.", "democratic republic of the congo": "congo, dem. rep.",
  "turkey (turkiye)": "turkiye", "cote d'ivoire (ivory coast)": "cote d'ivoire", "ivory coast": "cote d'ivoire", "micronesia": "micronesia, fed. sts.",
  "east timor": "timor-leste", "cape verde": "cabo verde",
};
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Resolves a free-text country name (OFAC / State Dept style) to an ISO3 code via World Bank names plus the alias table. */
async function loadNameIndex(): Promise<(name: string) => string | undefined> {
  const countries = await loadWbCountries();
  const byName = new Map<string, string>();
  for (const c of countries.values()) byName.set(norm(c.name), c.iso3);
  return (name) => { const n = norm(name); return byName.get(OFAC_ALIASES[n] ?? n); };
}

const loadOfac = () => cached("ofac", 12 * HOURS, async () => {
  const rows = parseCsv(await getText(OFAC_ADD_URL, 60_000));
  const resolve = await loadNameIndex();
  const addrs = new Map<string, number>();
  const ents = new Map<string, Set<string>>();
  let total = 0, unmatched = 0;
  for (const r of rows) {
    // add.csv: ent_num, add_num, address, city/state/zip, country, remarks
    const country = (r[4] ?? "").trim();
    if (!country || country === "-0-") continue;
    total++;
    const iso = resolve(country);
    if (!iso) { unmatched++; continue; }
    addrs.set(iso, (addrs.get(iso) ?? 0) + 1);
    (ents.get(iso) ?? ents.set(iso, new Set()).get(iso)!).add(r[0]);
  }
  return { addrs, ents, total, unmatched };
});

// ── State Department travel advisories ──────────────────────────────────
const loadAdvisories = () => cached("state", 6 * HOURS, async () => {
  const j = JSON.parse(await getText(STATE_URL));
  if (!Array.isArray(j)) throw new Error("State Department advisories feed had an unexpected format");
  // The feed's Category codes are FIPS 10-4 (Germany = GM, Russia = RS, South Korea = KS), not ISO — so join on the country name in the title instead.
  const resolve = await loadNameIndex();
  const byIso = new Map<string, { level: number; title: string; link: string; updated: string | null; summary: string }>();
  for (const a of j) {
    const level = Number(String(a.Title ?? "").match(/Level (\d)/)?.[1]);
    if (!Number.isFinite(level)) continue;
    const iso = resolve(String(a.Title).split(" - Level")[0]);
    if (!iso) continue;
    const summary = String(a.Summary ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    if (!byIso.has(iso)) byIso.set(iso, { level, title: a.Title, link: a.Link, updated: a.Updated ?? a.Published ?? null, summary: summary.slice(0, 360) });
  }
  return byIso;
});

// ── Boundaries ──────────────────────────────────────────────────────────
const loadBoundaries = () => cached("boundaries", 7 * 24 * HOURS, async () => {
  const j = JSON.parse(await getText(BOUNDARIES_URL, 40_000));
  return {
    type: "FeatureCollection",
    features: (j.features ?? [])
      .filter((f: any) => f.properties?.ISO3_CODE && f.properties.ISO3_CODE !== "ATA")
      .map((f: any) => ({ type: "Feature", geometry: f.geometry, properties: { iso3: f.properties.ISO3_CODE, name: f.properties.NAME_ENGL } })),
  };
});

// ── Profile assembly ────────────────────────────────────────────────────
type Section<T> = { status: "ok"; data: T } | { status: "error"; error: string } | { status: "empty"; note: string };

async function section<T>(fn: () => Promise<T | null>, emptyNote: string): Promise<Section<T>> {
  try {
    const data = await fn();
    return data == null ? { status: "empty", note: emptyNote } : { status: "ok", data };
  } catch (err) {
    return { status: "error", error: errMessage(err) };
  }
}

async function buildProfile(iso3: string) {
  const countries = await loadWbCountries();
  const c = countries.get(iso3);
  if (!c) return null;

  const [macro, governance, sanctions, travel] = await Promise.all([
    section(async () => {
      const entries = await Promise.allSettled(Object.entries(WB_INDICATORS).map(async ([k, id]) => [k, (await loadWbIndicator(id)).get(iso3) ?? null] as const));
      const ok = entries.filter((e): e is PromiseFulfilledResult<readonly [string, WbPoint | null]> => e.status === "fulfilled");
      if (ok.length === 0) throw new Error("World Bank API unreachable");
      const data: Record<string, WbPoint | null> = Object.fromEntries(ok.map((e) => e.value));
      return Object.values(data).some((v) => v) ? data : null;
    }, "World Bank has no recent indicators for this country."),
    section(async () => {
      const [cpi, hdi] = await Promise.allSettled([loadCpi(), loadHdi()]);
      const out: { cpi: (CpiRow & { year: string }) | null; hdi: { hdi: number; rank: number | null; group: string; year: string } | null; errors: string[] } = { cpi: null, hdi: null, errors: [] };
      if (cpi.status === "fulfilled") { const r = cpi.value.byIso.get(iso3); if (r) out.cpi = { ...r, year: cpi.value.year }; }
      else out.errors.push(`CPI: ${errMessage(cpi.reason)}`);
      if (hdi.status === "fulfilled") { const r = hdi.value.byIso.get(iso3); if (r) out.hdi = { ...r, year: hdi.value.year }; }
      else out.errors.push(`HDI: ${errMessage(hdi.reason)}`);
      if (!out.cpi && !out.hdi && out.errors.length === 2) throw new Error(out.errors.join(" · "));
      return out.cpi || out.hdi || out.errors.length ? out : null;
    }, "Neither CPI nor HDI covers this country."),
    section(async () => {
      const o = await loadOfac();
      return { addresses: o.addrs.get(iso3) ?? 0, entities: o.ents.get(iso3)?.size ?? 0 };
    }, ""),
    section(async () => (await loadAdvisories()).get(iso3) ?? null, "No State Department travel advisory is published for this country."),
  ]);

  return { iso3, iso2: c.iso2, name: c.name, capital: c.capital, region: c.region, incomeLevel: c.income, macro, governance, sanctions, travel };
}

export function countryIntelProxyPlugin(): Plugin {
  return middlewarePlugin("bbterminal-country-intel-proxy", async (req, res, next) => {
    if (!req.url?.startsWith("/country-intel-proxy/") || req.method !== "GET") { next(); return; }
    const u = new URL(req.url, "http://internal");
    try {
      if (u.pathname === "/country-intel-proxy/boundaries") { sendJson(res, await loadBoundaries()); return; }
      if (u.pathname === "/country-intel-proxy/profile") {
        const iso3 = (u.searchParams.get("iso3") ?? "").toUpperCase();
        if (!/^[A-Z]{3}$/.test(iso3)) { sendJson(res, { warnings: [{ message: "iso3 query parameter required" }] }, 400); return; }
        const profile = await buildProfile(iso3);
        if (!profile) { sendJson(res, { warnings: [{ message: `No profile data for ${iso3} (not in the World Bank country list)` }] }, 404); return; }
        sendJson(res, profile);
        return;
      }
      next();
    } catch (err) {
      sendJson(res, { warnings: [{ message: errMessage(err) }] }, 502);
    }
  });
}
