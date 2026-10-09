import { canonicalPeriod, periodStart } from "../src/lib/macro/math";
import type { AdapterId, AdapterSeries, ErrorKind, Observation, SeriesDef } from "../src/lib/macro/types";
import { AdapterError, RateLimitedError, USER_AGENT, type MacroAdapter } from "./macroAdapters";
import { fetchWithTimeout } from "./shared";

// ────────────────────────────────────────────────────────────
// Direct, primary-source macro adapters. One adapter per provider, each returning the
// same normalized shape as the DBnomics adapter (canonical period, finite value,
// provider, source URL, refreshed-at, retrieved-at) and NOTHING else: no maths here.
// Documented APIs only (JSON / CSV / SDMX / JSON-stat): no HTML scraping, no logins, no
// bot-challenge bypassing. If a provider blocks us the error says so and the series stays
// a visible gap.
//
// Keys (BLS_API_KEY, FRED_API_KEY) are read from the env object the plugin is given and
// are used only to build the upstream request. They are never logged, never placed in an
// error message (every message goes through `scrub`) and never sent anywhere else. BLS in
// particular echoes the key back in its "invalid key" message, which is why `scrub` exists.
//
// Cache sizing (the plugin honours `cacheMs`): daily sources (BoC, BoE, SNB, BIS) 6 h;
// monthly/quarterly sources 12 h. Documented limits: BLS v2 500 queries/day and 50 series
// per query (this adapter: 1 query per refresh, so ≤ 2/day); FRED 120 requests/minute
// (≤ 3 per refresh). The other providers publish no limit that could be confirmed on
// 2026-10-09; the budget there is one request per series per refresh.
// ────────────────────────────────────────────────────────────

const TIMEOUT_MS = 30_000;
const KEEP: Record<SeriesDef["frequency"], number> = { daily: 1300, monthly: 360, quarterly: 160 };
const HALF_DAY = 12 * 60 * 60_000;
const SIX_HOURS = 6 * 60 * 60_000;

// ───────────── shared helpers ─────────────

/** Removes any secret from text before it can reach a message, a log line or the browser. */
export function scrub(text: string, secrets: Array<string | undefined>): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[key]");
  return out;
}

const snippet = (text: string, n = 160) => text.replace(/\s+/g, " ").trim().slice(0, n);
const looksLikeBotChallenge = (status: number, text: string) =>
  (status === 403 || status === 503) && /just a moment|cf-chl|challenge-platform|attention required/i.test(text.slice(0, 4000));

interface GetOptions { label: string; secrets?: Array<string | undefined>; init?: RequestInit }

/** One upstream request with a timeout, a real-cause error, a 429 → RateLimitedError, and bot-challenge detection. */
export async function httpText(url: string, o: GetOptions): Promise<{ status: number; text: string; headers: Headers }> {
  const secrets = o.secrets ?? [];
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { ...o.init, headers: { "user-agent": USER_AGENT, ...(o.init?.headers as Record<string, string> | undefined) } }, TIMEOUT_MS);
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const why = e.name === "TimeoutError" ? `no answer within ${TIMEOUT_MS / 1000}s` : (e.cause?.code ?? e.message);
    throw new Error(scrub(`${o.label} unreachable (${why}).`, secrets));
  }
  const text = await res.text();
  if (looksLikeBotChallenge(res.status, text)) {
    throw new AdapterError(`${o.label} answered HTTP ${res.status} with a bot challenge (Cloudflare "Just a moment"). This terminal does not bypass bot challenges, so this source is unavailable from here.`, "blocked");
  }
  if (!res.ok) {
    const cause = snippet(scrub(text, secrets));
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      throw new RateLimitedError(`${o.label} answered HTTP 429 Too Many Requests${cause ? `: ${cause}` : ""}.`, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 60 * 60_000);
    }
    throw new Error(`${o.label} answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}${cause ? `: ${cause}` : ""}.`);
  }
  return { status: res.status, text, headers: res.headers };
}

async function httpJson<T>(url: string, o: GetOptions): Promise<T> {
  const { text, status } = await httpText(url, o);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`${o.label} answered HTTP ${status} but the body was not JSON (${snippet(scrub(text, o.secrets ?? []), 100) || "empty"}).`); }
}

/** Minimal RFC-4180 CSV parser (quoted fields may contain the delimiter, quotes and newlines). */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const retrievedIso = (nowMs: number) => new Date(nowMs).toISOString();

/** Provider rows → canonical, finite, ascending, de-duplicated observations (no future periods, NA dropped, never filled). */
export function toObservations(def: SeriesDef, raw: Array<[string, number | string | null | undefined]>, nowMs: number): Observation[] {
  const seen = new Map<string, number>();
  for (const [period, v] of raw) {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
    if (!Number.isFinite(n)) continue;
    const p = canonicalPeriod(period, def.frequency);
    if (!p) continue;
    if (Date.parse(`${periodStart(p)}T00:00:00Z`) > nowMs) continue;
    seen.set(p, n); // a later duplicate of the same period replaces the earlier one
  }
  return [...seen].map(([period, value]) => ({ period, value })).sort((a, b) => a.period.localeCompare(b.period)).slice(-KEEP[def.frequency]);
}

interface Meta { sourceUrl: string; refreshedAt?: string | null }
function okSeries(def: SeriesDef, obs: Observation[], nowMs: number, meta: Meta, emptyMessage: string): AdapterSeries {
  return {
    id: def.id, ok: obs.length > 0, error: obs.length ? undefined : emptyMessage, observations: obs,
    provider: def.provider, sourceUrl: meta.sourceUrl, refreshedAt: meta.refreshedAt ?? null, retrievedAt: retrievedIso(nowMs),
  };
}
function failedSeries(def: SeriesDef, nowMs: number, message: string, kind: ErrorKind = "error", sourceUrl = ""): AdapterSeries {
  return { id: def.id, ok: false, error: message, errorKind: kind, observations: [], provider: def.provider, sourceUrl, refreshedAt: null, retrievedAt: retrievedIso(nowMs) };
}
const keyMissing = (defs: SeriesDef[], nowMs: number, envVar: string, who: string): AdapterSeries[] =>
  defs.map((d) => failedSeries(d, nowMs, `API key missing: ${envVar} is not set. Add it to app/.env (see .env.example) and restart the dev server; ${who} data cannot be loaded without it.`, "key_missing"));

const yearsAgo = (nowMs: number, y: number) => new Date(nowMs).getUTCFullYear() - y;
/** "2026-10-02T11:00:00+0200" → ISO with a colon in the offset, which every JS engine parses. */
const fixOffset = (s: string) => s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

// ───────────── BLS (U.S. Bureau of Labor Statistics, Public Data API v2 with a key, v1 without) ─────────────
//
// Documented limits (bls.gov/developers/api_faqs.htm, read 2026-10-09):
//   v2 (registered key): 500 queries/day, 50 series/query, 20 years/query.
//   v1 (no key):          25 queries/day, 25 series/query, 10 years/query.
// This adapter sends ONE batched query per refresh and is cached 24 h, so at most 1-2 queries/day
// (v2 attempt, then v1 if the key is missing or rejected), far inside both limits. The plugin
// single-flights the refresh. With a missing/rejected key the series are served from v1 and carry a
// small non-blocking `notice`; they are NOT reported as errors.

const BLS_V1_NOTE = "using BLS's keyless v1 endpoint (25 queries/day, 25 series/query, 10 years/query; this terminal makes one query per day)";

export function blsAdapter(key?: string): MacroAdapter {
  type Body = { status?: string; message?: string[]; Results?: { series?: Array<{ seriesID: string; data: Array<{ year: string; period: string; value: string }> }> } };
  async function query(defs: SeriesDef[], nowMs: number, useKey: string | undefined): Promise<Body> {
    const year = new Date(nowMs).getUTCFullYear();
    const years = useKey ? 14 : 9; // v1 allows 10 calendar years per query
    const body = JSON.stringify({ seriesid: defs.map((d) => d.code), startyear: String(year - years), endyear: String(year), ...(useKey ? { registrationkey: useKey } : {}) });
    const json = await httpJson<Body>(`https://api.bls.gov/publicAPI/${useKey ? "v2" : "v1"}/timeseries/data/`,
      { label: "BLS", secrets: [key], init: { method: "POST", headers: { "content-type": "application/json" }, body } });
    const msg = scrub((json.message ?? []).join(" "), [key]);
    if (json.status && json.status !== "REQUEST_SUCCEEDED") {
      if (/key/i.test(msg) && /invalid|not valid|unregistered|not.*registered/i.test(msg)) throw new AdapterError(`BLS rejected the API key (${snippet(msg, 120)})`, "key_rejected");
      if (/threshold|limit/i.test(msg)) throw new RateLimitedError(`BLS daily request limit reached (${snippet(msg, 120)}).`, 6 * 60 * 60_000);
      throw new Error(`BLS did not process the request (${json.status}): ${snippet(msg, 160) || "no message"}.`);
    }
    return json;
  }
  return {
    id: "bls", cacheMs: 24 * 60 * 60_000,
    async fetchSeries(defs, nowMs) {
      let json: Body | null = null;
      let notice: { kind: "key_missing" | "key_rejected"; message: string } | undefined;
      if (key?.trim()) {
        try { json = await query(defs, nowMs, key); }
        catch (err) {
          if (!(err instanceof AdapterError) || err.kind !== "key_rejected") throw err;
          notice = { kind: "key_rejected", message: `API key rejected: BLS rejected BLS_API_KEY (it must be activated through BLS's confirmation e-mail); ${BLS_V1_NOTE}.` };
        }
      } else notice = { kind: "key_missing", message: `API key missing: BLS_API_KEY is not set in app/.env; ${BLS_V1_NOTE}.` };
      if (!json) json = await query(defs, nowMs, undefined);
      const msg = scrub((json.message ?? []).join(" "), [key]);
      const byId = new Map((json.Results?.series ?? []).map((s) => [s.seriesID, s]));
      return defs.map((def) => {
        const s = byId.get(def.code);
        const meta = { sourceUrl: `https://data.bls.gov/timeseries/${def.code}` };
        if (!s) return failedSeries(def, nowMs, `BLS did not return ${def.code}${msg ? ` (${snippet(msg, 100)})` : ""}.`, "error", meta.sourceUrl);
        const raw: Array<[string, string]> = [];
        for (const r of s.data) { const m = /^M(0[1-9]|1[0-2])$/.exec(r.period); if (m) raw.push([`${r.year}-${m[1]}`, r.value]); } // M13 (annual average) and non-monthly periods are not observations
        const out = okSeries(def, toObservations(def, raw, nowMs), nowMs, meta, "BLS returned the series but it has no monthly values.");
        return notice ? { ...out, notice } : out;
      });
    },
  };
}

// ───────────── FRED (Federal Reserve Bank of St. Louis API, key) ─────────────

export function fredAdapter(key?: string): MacroAdapter {
  return {
    id: "fred", cacheMs: HALF_DAY,
    async fetchSeries(defs, nowMs) {
      if (!key?.trim()) return keyMissing(defs, nowMs, "FRED_API_KEY", "FRED");
      const out: AdapterSeries[] = [];
      for (const def of defs) {
        const sourceUrl = `https://fred.stlouisfed.org/series/${def.code}`;
        try {
          const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(def.code)}&api_key=${encodeURIComponent(key)}&file_type=json&observation_start=${yearsAgo(nowMs, 15)}-01-01`;
          const j = await httpJson<{ observations?: Array<{ date: string; value: string }>; error_code?: number; error_message?: string }>(url, { label: "FRED", secrets: [key] });
          if (j.error_message) throw new Error(`FRED: ${snippet(scrub(j.error_message, [key]))}`);
          out.push(okSeries(def, toObservations(def, (j.observations ?? []).map((o) => [o.date, o.value]), nowMs), nowMs, { sourceUrl }, "FRED returned the series but it has no values."));
        } catch (err) {
          if (err instanceof RateLimitedError) throw err;
          const m = scrub(String((err as Error).message), [key]);
          const rejected = /api[_ ]key/i.test(m) && /(not|invalid)/i.test(m);
          out.push(failedSeries(def, nowMs, rejected ? `FRED rejected the API key (${snippet(m, 120)}). Check FRED_API_KEY in app/.env.` : m, rejected ? "key_rejected" : "error", sourceUrl));
        }
      }
      return out;
    },
  };
}

// ───────────── Eurostat (dissemination API, JSON-stat) ─────────────

interface JsonStat { id: string[]; size: number[]; value: Record<string, number> | Array<number | null>; dimension: Record<string, { category: { index: Record<string, number> | string[] } }>; updated?: string; error?: unknown }

export const eurostatAdapter: MacroAdapter = {
  id: "eurostat", cacheMs: HALF_DAY,
  async fetchSeries(defs, nowMs) {
    const out: AdapterSeries[] = [];
    for (const def of defs) {
      const [dataset] = def.code.split("?");
      const sourceUrl = `https://ec.europa.eu/eurostat/databrowser/view/${dataset}/default/table`;
      try {
        const j = await httpJson<JsonStat>(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${def.code}&sinceTimePeriod=${yearsAgo(nowMs, 15)}-01&format=JSON`, { label: "Eurostat" });
        const t = j.dimension?.time?.category?.index;
        if (!t || !j.id || !j.size) throw new Error("Eurostat answered but the body was not a JSON-stat dataset.");
        // The filters in `code` must pin every dimension except time, so the flat value index IS the time position.
        const timePos = j.id.indexOf("time");
        if (timePos !== j.id.length - 1 || j.size.slice(0, -1).some((n) => n !== 1)) throw new Error(`Eurostat returned more than one series for ${def.code}; the filters do not pin a single series.`);
        const periods = Array.isArray(t) ? t.map((p, i) => [p, i] as const) : Object.entries(t);
        const raw: Array<[string, number | null | undefined]> = periods.map(([p, i]) => [p, Array.isArray(j.value) ? j.value[i] : j.value[String(i)]]);
        out.push(okSeries(def, toObservations(def, raw, nowMs), nowMs, { sourceUrl, refreshedAt: j.updated ? new Date(fixOffset(j.updated)).toISOString() : null }, "Eurostat returned the series but it has no values."));
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
        out.push(failedSeries(def, nowMs, String((err as Error).message), (err as AdapterError).kind ?? "error", sourceUrl));
      }
    }
    return out;
  },
};

// ───────────── Statistics Canada (Web Data Service, vector API) ─────────────

export const statcanAdapter: MacroAdapter = {
  id: "statcan", cacheMs: HALF_DAY,
  async fetchSeries(defs, nowMs) {
    const j = await httpJson<Array<{ status: string; object: { vectorId?: number; productId?: number; vectorDataPoint?: Array<{ refPer: string; value: number | null; releaseTime?: string }> } | string }>>(
      "https://www150.statcan.gc.ca/t1/wds/rest/getDataFromVectorsAndLatestNPeriods",
      { label: "Statistics Canada", init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(defs.map((d) => ({ vectorId: Number(d.code), latestN: 200 }))) } },
    );
    if (!Array.isArray(j)) throw new Error("Statistics Canada answered but the body was not the expected list.");
    return defs.map((def, i) => {
      const r = j.find((x) => typeof x.object === "object" && String(x.object.vectorId) === def.code) ?? j[i];
      const sourceUrl = `https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=${typeof r?.object === "object" ? (r.object.productId ?? "") : ""}`;
      if (!r || r.status !== "SUCCESS" || typeof r.object !== "object") return failedSeries(def, nowMs, `Statistics Canada did not return vector ${def.code} (${r ? snippet(JSON.stringify(r.object)) : "missing from the answer"}).`, "error", sourceUrl);
      const pts = r.object.vectorDataPoint ?? [];
      const last = pts[pts.length - 1];
      return okSeries(def, toObservations(def, pts.map((p) => [p.refPer, p.value]), nowMs), nowMs, { sourceUrl, refreshedAt: last?.releaseTime ? `${last.releaseTime.slice(0, 10)}T00:00:00.000Z` : null }, "Statistics Canada returned the vector but it has no values.");
    });
  },
};

// ───────────── Bank of Canada (Valet API) ─────────────

export const bocAdapter: MacroAdapter = {
  id: "boc", cacheMs: SIX_HOURS,
  async fetchSeries(defs, nowMs) {
    const out: AdapterSeries[] = [];
    for (const def of defs) {
      const sourceUrl = `https://www.bankofcanada.ca/valet/series/${def.code}`;
      try {
        const j = await httpJson<{ observations?: Array<Record<string, { v?: string } | string>> }>(`https://www.bankofcanada.ca/valet/observations/${def.code}/json?recent=${KEEP.daily}`, { label: "Bank of Canada" });
        if (!j.observations) throw new Error("Bank of Canada answered but the body had no observations.");
        const raw: Array<[string, string | undefined]> = j.observations.map((o) => [String(o.d), (o[def.code] as { v?: string } | undefined)?.v]);
        out.push(okSeries(def, toObservations(def, raw, nowMs), nowMs, { sourceUrl }, "Bank of Canada returned the series but it has no values."));
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
        out.push(failedSeries(def, nowMs, String((err as Error).message), (err as AdapterError).kind ?? "error", sourceUrl));
      }
    }
    return out;
  },
};

// ───────────── Bank of England (Interactive Statistical Database, CSV download endpoint) ─────────────

const BOE_MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
const BOE_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const boeAdapter: MacroAdapter = {
  id: "boe", cacheMs: SIX_HOURS,
  async fetchSeries(defs, nowMs) {
    const from = `01/${BOE_MON[0]}/${yearsAgo(nowMs, 5)}`;
    const url = `https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${from}&Dateto=now&SeriesCodes=${defs.map((d) => d.code).join(",")}&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`;
    const { text } = await httpText(url, { label: "Bank of England" });
    const rows = parseCsv(text);
    const head = rows[0];
    if (!head || head[0]?.trim().toUpperCase() !== "DATE") throw new Error(`Bank of England answered but not with the expected CSV (${snippet(text, 100) || "empty"}).`);
    return defs.map((def) => {
      const sourceUrl = "https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp";
      const col = head.findIndex((h) => h.trim() === def.code);
      if (col < 0) return failedSeries(def, nowMs, `Bank of England did not return ${def.code}.`, "error", sourceUrl);
      const raw: Array<[string, string]> = [];
      for (const r of rows.slice(1)) {
        const m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec((r[0] ?? "").trim());
        if (m && BOE_MONTHS[m[2]]) raw.push([`${m[3]}-${BOE_MONTHS[m[2]]}-${m[1].padStart(2, "0")}`, r[col]]);
      }
      return okSeries(def, toObservations(def, raw, nowMs), nowMs, { sourceUrl }, "Bank of England returned the series but it has no values.");
    });
  },
};

// ───────────── Swiss National Bank (data portal cubes, CSV) ─────────────

export const snbAdapter: MacroAdapter = {
  id: "snb", cacheMs: SIX_HOURS,
  async fetchSeries(defs, nowMs) {
    const cubes = [...new Set(defs.map((d) => d.code.split(":")[0]))];
    const parsed = new Map<string, { rows: string[][]; published: string | null }>();
    for (const cube of cubes) {
      const daily = defs.some((d) => d.code.startsWith(`${cube}:`) && d.frequency === "daily");
      const { text } = await httpText(`https://data.snb.ch/api/cube/${cube}/data/csv/en?fromDate=${daily ? `${yearsAgo(nowMs, 5)}-01-01` : `${yearsAgo(nowMs, 15)}-01`}`, { label: "Swiss National Bank" });
      const rows = parseCsv(text, ";");
      const start = rows.findIndex((r) => r[0] === "Date");
      if (start < 0) throw new Error(`Swiss National Bank answered but cube ${cube} was not in the expected CSV format (${snippet(text, 100) || "empty"}).`);
      const pub = rows.find((r) => r[0] === "PublishingDate")?.[1];
      parsed.set(cube, { rows: rows.slice(start + 1), published: pub ? `${pub.replace(" ", "T")}:00+01:00` : null });
    }
    return defs.map((def) => {
      const [cube, item] = def.code.split(":");
      const p = parsed.get(cube)!;
      const sourceUrl = `https://data.snb.ch/en/topics/snb/cube/${cube}`;
      const raw: Array<[string, string]> = p.rows.filter((r) => r[1] === item).map((r) => [r[0], r[2]]);
      return okSeries(def, toObservations(def, raw, nowMs), nowMs, { sourceUrl, refreshedAt: p.published ? new Date(p.published).toISOString() : null }, `Swiss National Bank returned cube ${cube} but item ${item} has no values.`);
    });
  },
};

// ───────────── BIS (central bank policy rates dataset, SDMX CSV) ─────────────

export const bisAdapter: MacroAdapter = {
  id: "bis", cacheMs: SIX_HOURS,
  async fetchSeries(defs, nowMs) {
    const areas = defs.map((d) => d.code.split(".")[1]);
    const { text } = await httpText(`https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.${areas.join("+")}?startPeriod=${yearsAgo(nowMs, 5)}-01-01&format=csv`, { label: "BIS" });
    const rows = parseCsv(text);
    const head = rows[0] ?? [];
    const ci = (n: string) => head.indexOf(n);
    if (ci("REF_AREA") < 0 || ci("TIME_PERIOD") < 0 || ci("OBS_VALUE") < 0) throw new Error(`BIS answered but not with the expected CSV (${snippet(text, 100) || "empty"}).`);
    return defs.map((def) => {
      const area = def.code.split(".")[1];
      const raw: Array<[string, string]> = rows.slice(1).filter((r) => r[ci("REF_AREA")] === area).map((r) => [r[ci("TIME_PERIOD")], r[ci("OBS_VALUE")]]);
      return okSeries(def, toObservations(def, raw, nowMs), nowMs, { sourceUrl: "https://data.bis.org/topics/CBPOL" }, `BIS returned no policy-rate values for ${area}.`);
    });
  },
};

// ───────────── Statistics Bureau of Japan (Statistics Dashboard API, keyless) ─────────────

export const jpstatAdapter: MacroAdapter = {
  id: "jpstat", cacheMs: HALF_DAY,
  async fetchSeries(defs, nowMs) {
    const out: AdapterSeries[] = [];
    for (const def of defs) {
      const sourceUrl = "https://dashboard.e-stat.go.jp/en/";
      try {
        const j = await httpJson<{ GET_STATS?: { RESULT?: { status?: string; errorMsg?: string }; STATISTICAL_DATA?: { DATA_INF?: { DATA_OBJ?: Array<{ VALUE: Record<string, string> }> } } } }>(
          `https://dashboard.e-stat.go.jp/api/1.0/Json/getData?Lang=EN&IndicatorCode=${encodeURIComponent(def.code)}&RegionCode=00000`, { label: "Statistics Bureau of Japan" });
        const status = j.GET_STATS?.RESULT?.status;
        if (status !== "0") throw new Error(`Statistics Bureau of Japan dashboard error: ${snippet(j.GET_STATS?.RESULT?.errorMsg ?? "no message")}.`);
        const raw: Array<[string, string]> = [];
        for (const o of j.GET_STATS?.STATISTICAL_DATA?.DATA_INF?.DATA_OBJ ?? []) {
          const v = o.VALUE;
          // monthly cycle ("2026" "08" "00"), seasonally adjusted (@isSeasonal=2; 1 is the original series)
          const m = /^(\d{4})(\d{2})00$/.exec(v["@time"] ?? "");
          if (m && v["@cycle"] === "1" && v["@isSeasonal"] === "2" && +m[2] >= 1 && +m[2] <= 12) raw.push([`${m[1]}-${m[2]}`, v.$]);
        }
        out.push(okSeries(def, toObservations(def, raw, nowMs), nowMs, { sourceUrl }, "The Statistics Dashboard returned the indicator but it has no monthly seasonally adjusted values."));
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
        out.push(failedSeries(def, nowMs, String((err as Error).message), (err as AdapterError).kind ?? "error", sourceUrl));
      }
    }
    return out;
  },
};

// ───────────── IMF (SDMX 2.1 data API, keyless) ─────────────

export const imfAdapter: MacroAdapter = {
  id: "imf", cacheMs: HALF_DAY,
  async fetchSeries(defs, nowMs) {
    const out: AdapterSeries[] = [];
    for (const def of defs) {
      const [flow] = def.code.split("/");
      const sourceUrl = `https://data.imf.org/en/datasets/IMF.STA:${flow}`;
      try {
        const { text } = await httpText(`https://api.imf.org/external/sdmx/2.1/data/IMF.STA,${def.code}?startPeriod=${yearsAgo(nowMs, 15)}`, { label: "IMF" });
        if (!/<(?:\w+:)?StructureSpecificData|<(?:\w+:)?DataSet/i.test(text)) throw new Error(`IMF answered but not with SDMX data (${snippet(text, 100) || "empty"}).`);
        const raw: Array<[string, string]> = [];
        for (const m of text.matchAll(/<Obs\b[^>]*?TIME_PERIOD="([^"]+)"[^>]*?OBS_VALUE="([^"]+)"/g)) raw.push([m[1], m[2]]);
        const upd = /UPDATE_DATE="([^"]+)"/.exec(text)?.[1];
        out.push(okSeries(def, toObservations(def, raw, nowMs), nowMs, { sourceUrl, refreshedAt: upd ? new Date(upd).toISOString() : null }, "IMF returned the dataset but no observations for this series."));
      } catch (err) {
        if (err instanceof RateLimitedError) throw err;
        out.push(failedSeries(def, nowMs, String((err as Error).message), (err as AdapterError).kind ?? "error", sourceUrl));
      }
    }
    return out;
  },
};

/** Every direct adapter, with the two keys taken from the env object the plugin was given. */
export function directAdapters(env: Record<string, string | undefined>): MacroAdapter[] {
  return [blsAdapter(env.BLS_API_KEY), fredAdapter(env.FRED_API_KEY), eurostatAdapter, statcanAdapter, bocAdapter, boeAdapter, snbAdapter, bisAdapter, jpstatAdapter, imfAdapter];
}

export const DIRECT_ADAPTER_IDS: AdapterId[] = ["bls", "fred", "eurostat", "statcan", "boc", "boe", "snb", "bis", "jpstat", "imf"];
