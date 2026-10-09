import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { middlewarePlugin, sendJson, errMessage } from "./shared";
import { MANAGERS } from "../src/lib/holdings/config";
import { displayTicker } from "../src/lib/holdings/math";
import type { FilingRef, HoldStatus, ManagerListItem } from "../src/lib/holdings/types";
import {
  applyTickers, buildIndex, holderListFor, loadJson, mapCusips, saveJson,
  type CusipMap, type Fetcher, type IndexFile,
} from "./holdingsData";

// ────────────────────────────────────────────────────────────
// /holdings-proxy — Institutional Holdings (SEC Form 13F-HR).
//
// Data: the SEC's own Form 13F bulk data sets (downloaded once per data set, cached on disk), data.sec.gov
// submissions JSON for the curated managers, and OpenFIGI (exact CUSIP match) for tickers. The SEC asks for a
// declared User-Agent with contact information and at most 10 requests/second: this plugin sends
// "AbdelKhaderTerminal/1.0 (<SEC_CONTACT_EMAIL>)" ONLY to sec.gov, spaces its sec.gov requests ≥ 500 ms apart (2/s)
// and rebuilds its index at most once per 24 h. Without SEC_CONTACT_EMAIL it makes no sec.gov request at all and
// reports "contact email missing". Errors are honest and redacted of the contact address.
// ────────────────────────────────────────────────────────────

const INDEX_TTL_MS = 24 * 60 * 60_000;
const FAILURE_COOLDOWN_MS = 60_000;
const SEC_MIN_INTERVAL_MS = 500;
const TOP_MAPPED = 1500;

export interface HoldingsOptions {
  dir?: string;
  secFetch?: Fetcher;
  figiFetch?: Fetcher;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export function holdingsProxyPlugin(contactEmail: string | undefined, o: HoldingsOptions = {}): Plugin {
  const email = contactEmail?.trim();
  const dir = o.dir ?? path.resolve(process.cwd(), ".hold-cache");
  const now = o.now ?? (() => new Date());
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const redact = (t: string) => (email ? t.split(email).join("[contact]") : t);

  // sec.gov: one request at a time, ≥ 500 ms apart, declared User-Agent.
  let lastSec = 0;
  let secChain: Promise<unknown> = Promise.resolve();
  const secFetch: Fetcher = o.secFetch ?? ((url, init) => {
    const run = async () => {
      const wait = lastSec + SEC_MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastSec = Date.now();
      return fetch(url, { ...init, headers: { "user-agent": `AbdelKhaderTerminal/1.0 (${email})`, accept: "*/*", ...(init?.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(init?.method === "HEAD" ? 20_000 : 600_000) });
    };
    const p = secChain.then(run, run);
    secChain = p.catch(() => undefined);
    return p;
  });
  const figiFetch: Fetcher = o.figiFetch ?? ((url, init) => fetch(url, { ...init, headers: { "user-agent": "AbdelKhaderTerminal/1.0 (personal market-data terminal; maps CUSIPs to tickers)", ...(init?.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(30_000) }));

  let index: IndexFile | null = null;
  let cusipMap: CusipMap = {};
  let building: Promise<void> | null = null;
  let mapping: Promise<void> | null = null;
  let phase = "Not started";
  let error: string | null = null;
  let failedAt = 0;
  let progress = { done: 0, total: 0 };
  let loadedDisk = false;
  let mappingChecked = false;
  const submissionsCache = new Map<string, { at: number; latest: FilingRef | null }>();

  const tickerOf = (cusip: string) => cusipMap[cusip]?.ticker ?? null;

  async function submissionsFor(cik: string): Promise<{ latest: FilingRef | null }> {
    const hit = submissionsCache.get(cik);
    if (hit && Date.now() - hit.at < INDEX_TTL_MS) return { latest: hit.latest };
    const res = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
    if (!res.ok) throw new Error(`data.sec.gov answered HTTP ${res.status} for CIK ${cik}`);
    const j = (await res.json()) as { filings?: { recent?: { form: string[]; filingDate: string[]; reportDate: string[]; accessionNumber: string[] } } };
    const r = j.filings?.recent;
    let latest: FilingRef | null = null;
    if (r) for (let i = 0; i < r.form.length; i++) if (r.form[i] === "13F-HR") { latest = { accession: r.accessionNumber[i], filingDate: r.filingDate[i], periodOfReport: r.reportDate[i] }; break; }
    submissionsCache.set(cik, { at: Date.now(), latest });
    return { latest };
  }

  function startMapping() {
    if (mapping || !index) return;
    const idx = index;
    const list = new Map<string, string>();
    for (const [c, h] of Object.entries(idx.holders).sort((a, b) => b[1].total - a[1].total).slice(0, TOP_MAPPED)) list.set(c, h.issuer);
    for (const m of Object.values(idx.managers)) for (const r of [...m.rows, ...m.exited]) if (!list.has(r.cusip)) list.set(r.cusip, r.issuer);
    mapping = (async () => {
      try {
        let sinceApply = 0;
        await mapCusips([...list].map(([cusip, issuer]) => ({ cusip, issuer })), cusipMap, figiFetch, now,
          (done, total) => { progress = { done, total }; if (++sinceApply >= 5) { index = applyTickers(index!, tickerOf); sinceApply = 0; } },
          (m) => saveJson(path.join(dir, "cusip-map.json"), m), sleep);
        index = applyTickers(index!, tickerOf);
        await saveJson(path.join(dir, "index.json"), index);
      } catch (err) {
        console.warn(`[holdings-proxy] CUSIP mapping stopped: ${redact(errMessage(err))}`);
        error = `Ticker mapping stopped: ${redact(errMessage(err))}`;
      } finally { mapping = null; }
    })();
  }

  async function ensure(): Promise<void> {
    if (!email) return;
    if (!loadedDisk) {
      loadedDisk = true;
      cusipMap = (await loadJson<CusipMap>(path.join(dir, "cusip-map.json"))) ?? {};
      const disk = await loadJson<IndexFile>(path.join(dir, "index.json"));
      if (disk?.version === 1) { index = applyTickers(disk, tickerOf); }
    }
    const fresh = index && now().getTime() - Date.parse(index.builtAt) < INDEX_TTL_MS;
    if (fresh) { if (!mapping && !mappingChecked) { mappingChecked = true; startMapping(); } return; }
    if (building || (failedAt && Date.now() - failedAt < FAILURE_COOLDOWN_MS)) return;
    building = (async () => {
      try {
        error = null;
        const built = await buildIndex({ dir, fetcher: secFetch, now: now(), phase: (p) => { phase = p; }, tickerOf }, submissionsFor);
        index = applyTickers(built, tickerOf);
        await saveJson(path.join(dir, "index.json"), index);
        phase = "Ready";
        failedAt = 0;
        mappingChecked = true;
        startMapping();
      } catch (err) {
        error = redact(errMessage(err));
        failedAt = Date.now();
        console.warn(`[holdings-proxy] index build failed: ${error}`);
      } finally { building = null; }
    })();
  }

  function status(): HoldStatus {
    if (!email) return { state: "missing_contact", message: "SEC contact email missing: SEC_CONTACT_EMAIL is not set in app/.env. The SEC requires a declared contact in the User-Agent, so no request was made. Add it (see .env.example) and restart the dev server." };
    const state = building ? "building" : error && !index ? "error" : mapping ? "mapping" : index ? "ready" : "idle";
    return { state, phase: building ? phase : mapping ? `Mapping CUSIPs to tickers (OpenFIGI, ${progress.done}/${progress.total})` : phase, message: error ?? undefined, builtAt: index?.builtAt ?? null, mapping: progress, latestPeriod: index?.latestPeriod ?? null, dataSets: index?.dataSets ?? [] };
  }

  const nowMsg = (msg: string, status = 503) => ({ status, body: { results: null, warnings: [{ message: msg }] } });

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    const url = new URL(req.url ?? "", "http://x");
    if (!url.pathname.startsWith("/holdings-proxy/")) { next(); return; }
    if (req.method !== "GET") { next(); return; }
    const route = url.pathname.slice("/holdings-proxy/".length);
    res.setHeader("cache-control", "no-store");
    try {
      if (route === "retry") { failedAt = 0; error = null; await ensure(); sendJson(res, { results: status() }); return; }
      await ensure();
      if (route === "status") { sendJson(res, { results: status() }); return; }
      const st = status();
      if (st.state === "missing_contact") { const r = nowMsg(st.message); sendJson(res, r.body, r.status); return; }
      if (!index) {
        const r = nowMsg(error ? `The holdings index could not be built: ${error}` : `The holdings index is being built (${phase}). This takes a few minutes the first time; it is built once per day.`, error ? 502 : 503);
        sendJson(res, r.body, r.status); return;
      }
      const idx = index;
      if (route === "managers") {
        const items: ManagerListItem[] = MANAGERS.filter((m) => idx.managers[m.cik]).map((m) => {
          const p = idx.managers[m.cik];
          return { cik: m.cik, name: p.name, group: m.group, filing: p.filing, totalValue: p.totalValue, positionCount: p.positionCount, newerFiling: p.newerFiling };
        });
        sendJson(res, { results: { latestPeriod: idx.latestPeriod, builtAt: idx.builtAt, dataSets: idx.dataSets, managers: items, missing: MANAGERS.filter((m) => !idx.managers[m.cik]).map((m) => m.name) } });
        return;
      }
      if (route === "manager") {
        const cik = (url.searchParams.get("cik") ?? "").padStart(10, "0");
        const m = idx.managers[cik];
        if (!m) { sendJson(res, { results: null, warnings: [{ message: `No curated manager with CIK ${cik} in the latest data set.` }] }, 404); return; }
        sendJson(res, { results: m });
        return;
      }
      if (route === "tickers") {
        const seen = new Map<string, number>();
        for (const [c, e] of Object.entries(cusipMap)) { const h = idx.holders[c]; if (e.ticker && h) seen.set(displayTicker(e.ticker), Math.max(seen.get(displayTicker(e.ticker)) ?? 0, h.total)); }
        sendJson(res, { results: { tickers: [...seen].sort((a, b) => b[1] - a[1]).map(([t]) => t), mapping: progress, mappingDone: !mapping } });
        return;
      }
      if (route === "holders") {
        const want = (url.searchParams.get("ticker") ?? "").trim().toUpperCase().replace(/[/-]/g, ".");
        if (!want) { sendJson(res, { results: null, warnings: [{ message: "ticker is required" }] }, 400); return; }
        const cands = Object.entries(cusipMap).filter(([c, e]) => e.ticker && displayTicker(e.ticker).toUpperCase() === want && idx.holders[c]).sort((a, b) => idx.holders[b[0]].total - idx.holders[a[0]].total);
        if (cands.length === 0) {
          const why = mapping ? `${want} has no high-confidence CUSIP match yet: ticker mapping is still running (${progress.done}/${progress.total}). Try again in a few minutes.` : `${want} has no high-confidence CUSIP match among the ${TOP_MAPPED} largest 13F securities, so no holder list is shown (a ticker is never guessed).`;
          sendJson(res, { results: null, warnings: [{ message: why }] }, 404); return;
        }
        sendJson(res, { results: { ...holderListFor(idx, cands[0][0], want), note: cands.length > 1 ? `${cands.length} CUSIPs map to ${want} (share classes); showing the largest.` : null } });
        return;
      }
      sendJson(res, { results: null, warnings: [{ message: `Unknown holdings route "${route}".` }] }, 404);
    } catch (err) {
      sendJson(res, { results: null, warnings: [{ message: redact(errMessage(err)) }] }, 502);
    }
  }

  return middlewarePlugin("bbterminal-holdings-proxy", handle);
}
