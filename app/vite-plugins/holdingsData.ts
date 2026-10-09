import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";
import { MANAGERS, MAX_EXITED, MAX_ROWS, TOP_HOLDERS } from "../src/lib/holdings/config";
import { aggregateRows, diffPositions, nameKey, previousQuarterEnd, secDateToIso, totalValue, type RawRow } from "../src/lib/holdings/math";
import type { FilingRef, HolderList, ManagerPortfolio } from "../src/lib/holdings/types";

// ────────────────────────────────────────────────────────────
// HOLD data pipeline. Everything comes from the SEC's own published files:
//   • the Form 13F bulk data sets (quarterly zips: SUBMISSION, COVERPAGE, SUMMARYPAGE, INFOTABLE),
//   • data.sec.gov/submissions/CIK##########.json (per-manager filing list),
// plus OpenFIGI's documented mapping API for CUSIP → ticker (exact CUSIP match only).
// Rate discipline: ≤ 2 requests/second to sec.gov (the SEC allows 10), one download per data set, OpenFIGI paced
// under its keyless limit of 25 requests/minute. Nothing is scraped: the data-set file names follow the documented
// pattern and are probed with HEAD requests.
// ────────────────────────────────────────────────────────────

export interface IndexFile {
  version: 1;
  builtAt: string;
  latestPeriod: string;
  dataSets: string[];
  managers: Record<string, ManagerPortfolio>;
  /** per CUSIP: aggregate over ALL 13F-HR filers of the latest period + the top holders */
  holders: Record<string, { issuer: string; total: number; holderCount: number; top: Array<{ cik: string; name: string; value: number; shares: number }> }>;
}
export interface CusipEntry { ticker: string | null; name: string | null; at: string }
export type CusipMap = Record<string, CusipEntry>;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

// ───────────── streaming zip (central directory + inflate), for files too big to hold in memory ─────────────

export interface ZipEntry { name: string; method: number; compressedSize: number; size: number; dataStart: number }

export async function readZipDirectory(file: string): Promise<Map<string, ZipEntry>> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 66_000);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("not a ZIP archive (no end-of-central-directory record)");
    const count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset === 0xffffffff || count === 0xffff) throw new Error("ZIP64 archives are not supported");
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const out = new Map<string, ZipEntry>();
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt ZIP central directory");
      const method = cd.readUInt16LE(p + 10), compressedSize = cd.readUInt32LE(p + 20), fsize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32), localOffset = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nameLen);
      const lh = Buffer.alloc(30);
      await fh.read(lh, 0, 30, localOffset);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error("corrupt ZIP local header");
      out.set(name, { name, method, compressedSize, size: fsize, dataStart: localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28) });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally { await fh.close(); }
}

/** Lines of one zip entry, streamed (deflate or stored). The header line is included. */
export async function* zipLines(file: string, entry: ZipEntry): AsyncGenerator<string> {
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`unsupported ZIP compression method ${entry.method}`);
  const raw = createReadStream(file, { start: entry.dataStart, end: entry.dataStart + entry.compressedSize - 1 });
  const src: Readable = entry.method === 8 ? raw.pipe(createInflateRaw()) : raw;
  const dec = new TextDecoder("utf-8");
  let carry = "";
  for await (const chunk of src) {
    const text = carry + dec.decode(chunk as Buffer, { stream: true });
    let start = 0, nl: number;
    while ((nl = text.indexOf("\n", start)) >= 0) { yield text.slice(start, nl).replace(/\r$/, ""); start = nl + 1; }
    carry = text.slice(start);
  }
  carry += dec.decode();
  if (carry) yield carry.replace(/\r$/, "");
}

/** Rows of a tab-separated table as column-name → value objects (no quoting in the SEC files). */
export async function* tsvObjects(file: string, entry: ZipEntry): AsyncGenerator<Record<string, string>> {
  let head: string[] | null = null;
  for await (const line of zipLines(file, entry)) {
    if (!head) { head = line.split("\t"); continue; }
    if (!line) continue;
    const cells = line.split("\t");
    const o: Record<string, string> = {};
    for (let i = 0; i < head.length; i++) o[head[i]] = cells[i] ?? "";
    yield o;
  }
}

// ───────────── data-set discovery and download ─────────────

/** Documented window pattern: 01dec–28/29feb, 01mar–31may, 01jun–31aug, 01sep–30nov. Newest first, windows that have not started yet excluded. */
export function dataSetWindows(now: Date, count = 4): string[] {
  const feb = (y: number) => new Date(Date.UTC(y, 2, 0)).getUTCDate();
  const wins: Array<{ file: string; start: number }> = [];
  for (let yy = now.getUTCFullYear() + 1; yy >= now.getUTCFullYear() - 3; yy--) {
    wins.push({ file: `01dec${yy - 1}-${feb(yy)}feb${yy}_form13f.zip`, start: Date.UTC(yy - 1, 11, 1) });
    wins.push({ file: `01mar${yy}-31may${yy}_form13f.zip`, start: Date.UTC(yy, 2, 1) });
    wins.push({ file: `01jun${yy}-31aug${yy}_form13f.zip`, start: Date.UTC(yy, 5, 1) });
    wins.push({ file: `01sep${yy}-30nov${yy}_form13f.zip`, start: Date.UTC(yy, 8, 1) });
  }
  return wins.filter((w) => w.start <= now.getTime()).sort((a, b) => b.start - a.start).slice(0, count).map((w) => w.file);
}
export const DATASET_FOLDERS = ["datastandardsinnovation", "structureddata"];
const datasetUrl = (folder: string, file: string) => `https://www.sec.gov/files/${folder}/data/form-13f-data-sets/${file}`;

export async function findDataSets(fetcher: Fetcher, now: Date, wanted = 2): Promise<Array<{ file: string; url: string }>> {
  const found: Array<{ file: string; url: string }> = [];
  for (const file of dataSetWindows(now, 5)) {
    for (const folder of DATASET_FOLDERS) {
      const url = datasetUrl(folder, file);
      const res = await fetcher(url, { method: "HEAD" }).catch(() => null);
      if (res?.ok) { found.push({ file, url }); break; }
    }
    if (found.length >= wanted) break;
  }
  return found;
}

export async function downloadTo(fetcher: Fetcher, url: string, dest: string): Promise<void> {
  const res = await fetcher(url);
  if (!res.ok || !res.body) throw new Error(`SEC answered HTTP ${res.status} for the data set download`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  await rename(tmp, dest);
}

// ───────────── index build ─────────────

export interface BuildDeps {
  dir: string;
  fetcher: Fetcher;
  now: Date;
  /** progress callback: phase text */
  phase: (p: string) => void;
  tickerOf: (cusip: string) => string | null;
}

interface SubRow { acc: string; filingDate: string; type: string; cik: string; period: string }

async function loadTables(zipFile: string) {
  const dir = await readZipDirectory(zipFile);
  const need = (n: string) => { const e = dir.get(n); if (!e) throw new Error(`${path.basename(zipFile)} has no ${n}`); return e; };
  const subs: SubRow[] = [];
  for await (const r of tsvObjects(zipFile, need("SUBMISSION.tsv"))) {
    const filingDate = secDateToIso(r.FILING_DATE), period = secDateToIso(r.PERIODOFREPORT);
    if (filingDate && period) subs.push({ acc: r.ACCESSION_NUMBER, filingDate, type: r.SUBMISSIONTYPE, cik: r.CIK, period });
  }
  const names = new Map<string, string>();
  for await (const r of tsvObjects(zipFile, need("COVERPAGE.tsv"))) names.set(r.ACCESSION_NUMBER, r.FILINGMANAGER_NAME);
  return { dir, subs, names, infotable: need("INFOTABLE.tsv") };
}

const rowOf = (r: Record<string, string>): RawRow => ({
  cusip: r.CUSIP, issuer: r.NAMEOFISSUER, titleOfClass: r.TITLEOFCLASS, putCall: r.PUTCALL ?? "", sharesType: r.SSHPRNAMTTYPE ?? "SH",
  shares: Number(r.SSHPRNAMT), value: Number(r.VALUE),
});

/** Walks INFOTABLE once and hands every row of the wanted accessions to `onRow`. */
async function scanInfotable(zipFile: string, entry: ZipEntry, onRow: (acc: string, r: Record<string, string>) => void) {
  for await (const r of tsvObjects(zipFile, entry)) onRow(r.ACCESSION_NUMBER, r);
}

export async function buildIndex(deps: BuildDeps, submissionsFor: (cik: string) => Promise<{ latest: FilingRef | null } | null>): Promise<IndexFile> {
  const { dir, fetcher, now, phase } = deps;
  await mkdir(dir, { recursive: true });
  phase("Looking for the newest Form 13F data sets (HEAD requests on the documented file names)");
  const sets = await findDataSets(fetcher, now, 2);
  if (sets.length === 0) throw new Error("No Form 13F data set was found at the documented SEC download location.");
  const files: string[] = [];
  for (const s of sets) {
    const dest = path.join(dir, s.file);
    const have = await stat(dest).then((x) => x.size > 0).catch(() => false);
    if (!have) { phase(`Downloading ${s.file} from sec.gov (one request, about 100 MB)`); await downloadTo(fetcher, s.url, dest); }
    files.push(dest);
  }
  // drop older cached data sets
  for (const f of await readdir(dir)) if (f.endsWith("_form13f.zip") && !sets.some((s) => s.file === f)) await rm(path.join(dir, f), { force: true });

  phase("Reading submissions and cover pages");
  const tables = await Promise.all(files.map(loadTables));
  const allSubs = tables.flatMap((t, i) => t.subs.map((s) => ({ ...s, zip: i })));
  const nameByAcc = new Map<string, string>();
  tables.forEach((t) => t.names.forEach((n, a) => nameByAcc.set(a, n)));

  // latest period = the one with the most initial 13F-HR filings in the newest data set
  const counts = new Map<string, number>();
  for (const s of tables[0].subs) if (s.type === "13F-HR") counts.set(s.period, (counts.get(s.period) ?? 0) + 1);
  const latestPeriod = [...counts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
  if (!latestPeriod) throw new Error("The newest Form 13F data set contains no 13F-HR filings.");
  const prevPeriod = previousQuarterEnd(latestPeriod)!;

  const wantedCiks = new Set(MANAGERS.map((m) => m.cik));
  const latestAcc = new Map<string, { sub: SubRow; zip: number }>();   // manager → filing of the latest period
  const prevAcc = new Map<string, { sub: SubRow; zip: number }>();
  const holdersAcc = new Map<string, string>();                          // accession → cik, ALL filers of the latest period
  for (const s of allSubs) {
    if (s.type !== "13F-HR") continue;
    if (s.period === latestPeriod) {
      holdersAcc.set(s.acc, s.cik);
      if (wantedCiks.has(s.cik)) { const cur = latestAcc.get(s.cik); if (!cur || s.filingDate > cur.sub.filingDate) latestAcc.set(s.cik, { sub: s, zip: s.zip }); }
    } else if (s.period === prevPeriod && wantedCiks.has(s.cik)) {
      const cur = prevAcc.get(s.cik); if (!cur || s.filingDate > cur.sub.filingDate) prevAcc.set(s.cik, { sub: s, zip: s.zip });
    }
  }

  // Pass 1 over the zip(s) holding the latest period: totals per CUSIP, rows of the curated managers.
  phase("Reading all holdings of the latest quarter (pass 1: totals per security and curated managers)");
  const cusipTotal = new Map<string, { issuer: string; total: number }>();
  const mgrRows = new Map<string, RawRow[]>();     // cik → rows (latest)
  const accToMgr = new Map([...latestAcc].map(([cik, v]) => [v.sub.acc, cik]));
  const prevRows = new Map<string, RawRow[]>();
  const prevAccToMgr = new Map([...prevAcc].map(([cik, v]) => [v.sub.acc, cik]));
  for (let i = 0; i < files.length; i++) {
    await scanInfotable(files[i], tables[i].infotable, (acc, r) => {
      const isLatestFiler = holdersAcc.has(acc);
      const m = accToMgr.get(acc), pm = prevAccToMgr.get(acc);
      if (!isLatestFiler && !pm) return;
      const row = rowOf(r);
      if (isLatestFiler && !row.putCall && row.sharesType !== "PRN" && Number.isFinite(row.value)) {
        const c = cusipTotal.get(row.cusip); if (c) c.total += row.value; else cusipTotal.set(row.cusip, { issuer: row.issuer, total: row.value });
      }
      if (m) { const a = mgrRows.get(m); if (a) a.push(row); else mgrRows.set(m, [row]); }
      if (pm) { const a = prevRows.get(pm); if (a) a.push(row); else prevRows.set(pm, [row]); }
    });
  }

  // Pass 2: top holders of the biggest securities.
  phase("Finding the largest holders of each major security (pass 2)");
  const TOP_SECURITIES = 1500;
  const topCusips = new Set([...cusipTotal].sort((a, b) => b[1].total - a[1].total).slice(0, TOP_SECURITIES).map(([c]) => c));
  const perCusip = new Map<string, Map<string, { value: number; shares: number }>>();
  for (let i = 0; i < files.length; i++) {
    await scanInfotable(files[i], tables[i].infotable, (acc, r) => {
      const cik = holdersAcc.get(acc);
      if (!cik || !topCusips.has(r.CUSIP) || r.PUTCALL || r.SSHPRNAMTTYPE === "PRN") return;
      const v = Number(r.VALUE), sh = Number(r.SSHPRNAMT);
      if (!Number.isFinite(v) || !Number.isFinite(sh)) return;
      let m = perCusip.get(r.CUSIP); if (!m) perCusip.set(r.CUSIP, (m = new Map()));
      const h = m.get(cik); if (h) { h.value += v; h.shares += sh; } else m.set(cik, { value: v, shares: sh });
    });
  }
  const cikName = new Map<string, string>();
  for (const s of allSubs) if (holdersAcc.get(s.acc) === s.cik && !cikName.has(s.cik)) cikName.set(s.cik, nameByAcc.get(s.acc) ?? s.cik);
  const holders: IndexFile["holders"] = {};
  for (const [cusip, m] of perCusip) {
    const top = [...m].sort((a, b) => b[1].value - a[1].value).slice(0, TOP_HOLDERS).map(([cik, h]) => ({ cik, name: cikName.get(cik) ?? cik, value: h.value, shares: h.shares }));
    holders[cusip] = { issuer: cusipTotal.get(cusip)!.issuer, total: cusipTotal.get(cusip)!.total, holderCount: m.size, top };
  }

  // Managers
  phase("Checking each curated manager against data.sec.gov submissions");
  const managers: Record<string, ManagerPortfolio> = {};
  for (const ref of MANAGERS) {
    const la = latestAcc.get(ref.cik);
    if (!la) continue;
    const cur = aggregateRows(mgrRows.get(ref.cik) ?? []);
    const prevRaw = prevRows.get(ref.cik);
    const prev = prevRaw ? aggregateRows(prevRaw) : null;
    const d = diffPositions(cur, prev, deps.tickerOf, MAX_ROWS, MAX_EXITED);
    const pa = prevAcc.get(ref.cik);
    const filing: FilingRef = { accession: la.sub.acc, filingDate: la.sub.filingDate, periodOfReport: la.sub.period };
    let newer: FilingRef | null = null;
    const live = await submissionsFor(ref.cik).catch(() => null);
    if (live?.latest && live.latest.periodOfReport > filing.periodOfReport) newer = live.latest;
    managers[ref.cik] = {
      cik: ref.cik, name: nameByAcc.get(la.sub.acc) ?? ref.name, group: ref.group, filing,
      previousFiling: pa ? { accession: pa.sub.acc, filingDate: pa.sub.filingDate, periodOfReport: pa.sub.period } : null,
      totalValue: totalValue(cur), positionCount: cur.length, rows: d.rows, exited: d.exited, newerFiling: newer,
    };
  }
  return { version: 1, builtAt: now.toISOString(), latestPeriod, dataSets: sets.map((s) => s.file), managers, holders };
}

/** Re-applies tickers to an index (after the CUSIP map grew) without touching the SEC again. */
export function applyTickers(index: IndexFile, tickerOf: (cusip: string) => string | null): IndexFile {
  const managers: IndexFile["managers"] = {};
  for (const [cik, m] of Object.entries(index.managers)) managers[cik] = { ...m, rows: m.rows.map((r) => ({ ...r, ticker: tickerOf(r.cusip) })), exited: m.exited.map((r) => ({ ...r, ticker: tickerOf(r.cusip) })) };
  return { ...index, managers };
}

// ───────────── CUSIP → ticker (OpenFIGI, exact CUSIP match, keyless 25 requests/minute, 10 per request) ─────────────

interface FigiRow { ticker?: string; name?: string; exchCode?: string; securityType?: string; marketSector?: string }
const OK_TYPES = new Set(["Common Stock", "ETP", "ADR", "REIT", "Depositary Receipt", "Closed-End Fund", "MLP"]);

/** High-confidence only: every US-composite listing returned for the exact CUSIP agrees on one ticker, the security type is an equity-like one, and the issuer names share their first word. */
export function pickTicker(issuer13f: string, rows: FigiRow[] | undefined): { ticker: string | null; name: string | null } {
  const us = (rows ?? []).filter((r) => r.exchCode === "US" && r.marketSector === "Equity" && r.ticker && OK_TYPES.has(r.securityType ?? ""));
  if (us.length === 0) return { ticker: null, name: null };
  const tickers = new Set(us.map((r) => r.ticker!));
  const name = us[0].name ?? null;
  if (tickers.size !== 1) return { ticker: null, name };
  if (!name || nameKey(name) !== nameKey(issuer13f)) return { ticker: null, name };
  return { ticker: [...tickers][0], name };
}

export const FIGI_MIN_INTERVAL_MS = 2_600; // 23 requests/minute, under the documented keyless 25/minute

export async function mapCusips(
  cusips: Array<{ cusip: string; issuer: string }>, map: CusipMap, fetcher: Fetcher, now: () => Date,
  onProgress: (done: number, total: number) => void, save: (m: CusipMap) => Promise<void>, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<void> {
  const NULL_TTL = 30 * 24 * 3_600_000;
  const todo = cusips.filter((c) => { const e = map[c.cusip]; return !e || (e.ticker == null && now().getTime() - Date.parse(e.at) > NULL_TTL); });
  let done = 0;
  onProgress(0, todo.length);
  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10);
    const res = await fetcher("https://api.openfigi.com/v3/mapping", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch.map((b) => ({ idType: "ID_CUSIP", idValue: b.cusip }))) });
    if (res.status === 429) { const ra = Number(res.headers.get("retry-after")); await sleep((Number.isFinite(ra) && ra > 0 ? ra : 60) * 1000); i -= 10; continue; }
    if (!res.ok) throw new Error(`OpenFIGI answered HTTP ${res.status}`);
    const body = (await res.json()) as Array<{ data?: FigiRow[]; warning?: string; error?: string }>;
    batch.forEach((b, k) => { const p = pickTicker(b.issuer, body[k]?.data); map[b.cusip] = { ticker: p.ticker, name: p.name, at: now().toISOString() }; });
    done += batch.length;
    onProgress(done, todo.length);
    await save(map);
    await sleep(FIGI_MIN_INTERVAL_MS);
  }
}

export async function loadJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return null; }
}
export async function saveJson(file: string, v: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(v));
  await rename(tmp, file);
}

export function holderListFor(index: IndexFile, cusip: string, ticker: string): HolderList | null {
  const h = index.holders[cusip];
  if (!h) return null;
  return { cusip, ticker, issuer: h.issuer, totalValueAllFilers: h.total, holderCount: h.holderCount, holders: h.top.map((t) => ({ ...t })), periodOfReport: index.latestPeriod };
}
