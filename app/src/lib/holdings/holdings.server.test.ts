import { afterEach, describe, expect, it, vi } from "vitest";
import connect from "connect";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { dataSetWindows, mapCusips, pickTicker, readZipDirectory, tsvObjects, zipLines, type CusipMap } from "../../../vite-plugins/holdingsData";
import { holdingsProxyPlugin } from "../../../vite-plugins/holdings";

// Minimal ZIP writer (deflate or stored), enough to exercise the streaming reader the way the SEC files are read.
function makeZip(files: Record<string, string>, stored = false): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8"), comp = stored ? data : deflateRawSync(data), nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(stored ? 0 : 8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(stored ? 0 : 8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nm);
    offset += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central), eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length / 2, 8); eocd.writeUInt16LE(central.length / 2, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

const dirs: string[] = [];
const servers: Server[] = [];
async function tmp() { const d = await mkdtemp(path.join(tmpdir(), "hold-test-")); dirs.push(d); return d; }
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  vi.restoreAllMocks();
});

describe("streaming zip reader", () => {
  it("reads deflated and stored entries, handles CRLF and a final line without newline", async () => {
    const d = await tmp(), f = path.join(d, "t.zip");
    await writeFile(f, makeZip({ "A.tsv": "H1\tH2\r\n1\tx\r\n2\ty", "B.tsv": "K\nv\n" }));
    const dir = await readZipDirectory(f);
    expect([...dir.keys()]).toEqual(["A.tsv", "B.tsv"]);
    const lines: string[] = [];
    for await (const l of zipLines(f, dir.get("A.tsv")!)) lines.push(l);
    expect(lines).toEqual(["H1\tH2", "1\tx", "2\ty"]);
    const rows: Record<string, string>[] = [];
    for await (const r of tsvObjects(f, dir.get("A.tsv")!)) rows.push(r);
    expect(rows).toEqual([{ H1: "1", H2: "x" }, { H1: "2", H2: "y" }]);
    await writeFile(f, makeZip({ "S.tsv": "a\tb\n1\t2\n" }, true));
    const d2 = await readZipDirectory(f);
    const out: string[] = [];
    for await (const l of zipLines(f, d2.get("S.tsv")!)) out.push(l);
    expect(out).toEqual(["a\tb", "1\t2"]);
  });
  it("copes with a multi-megabyte entry spanning many chunks (no line is lost or split)", async () => {
    const d = await tmp(), f = path.join(d, "big.zip");
    const body = "ID\tV\n" + Array.from({ length: 200_000 }, (_, i) => `${i}\t${"x".repeat(20)}`).join("\n") + "\n";
    await writeFile(f, makeZip({ "BIG.tsv": body }));
    let n = 0, last = "";
    for await (const r of tsvObjects(f, (await readZipDirectory(f)).get("BIG.tsv")!)) { n++; last = r.ID; }
    expect(n).toBe(200_000);
    expect(last).toBe("199999");
  });
  it("refuses a file that is not a zip", async () => {
    const d = await tmp(), f = path.join(d, "x.zip");
    await writeFile(f, "not a zip at all");
    await expect(readZipDirectory(f)).rejects.toThrow(/not a ZIP/);
  });
});

describe("data set discovery", () => {
  it("follows the documented window names, newest first, and never lists a window that has not started", () => {
    expect(dataSetWindows(new Date("2026-10-09T00:00:00Z"), 3)).toEqual(["01sep2026-30nov2026_form13f.zip", "01jun2026-31aug2026_form13f.zip", "01mar2026-31may2026_form13f.zip"]);
    expect(dataSetWindows(new Date("2026-08-20T00:00:00Z"), 2)).toEqual(["01jun2026-31aug2026_form13f.zip", "01mar2026-31may2026_form13f.zip"]);
    expect(dataSetWindows(new Date("2026-03-05T00:00:00Z"), 2)).toEqual(["01mar2026-31may2026_form13f.zip", "01dec2025-28feb2026_form13f.zip"]);
    expect(dataSetWindows(new Date("2028-03-05T00:00:00Z"), 2)[1]).toBe("01dec2027-29feb2028_form13f.zip"); // leap year
  });
});

describe("pickTicker (exact CUSIP match, high confidence only)", () => {
  const us = (ticker: string, name: string, type = "Common Stock") => ({ ticker, name, exchCode: "US", securityType: type, marketSector: "Equity" });
  it("accepts one agreed US ticker whose issuer name matches", () => {
    expect(pickTicker("NVIDIA CORPORATION", [us("NVDA", "NVIDIA CORP"), { ticker: "NVDA", name: "NVIDIA CORP", exchCode: "UN", securityType: "Common Stock", marketSector: "Equity" }])).toEqual({ ticker: "NVDA", name: "NVIDIA CORP" });
  });
  it("refuses: no US listing, ambiguous tickers, a different issuer name, an unsuitable security type, or no data", () => {
    expect(pickTicker("X", [{ ticker: "X", name: "X", exchCode: "LN", securityType: "Common Stock", marketSector: "Equity" }]).ticker).toBeNull();
    expect(pickTicker("ALPHA INC", [us("AAA", "ALPHA INC"), us("BBB", "ALPHA INC")]).ticker).toBeNull();
    expect(pickTicker("APPLE INC", [us("AMAT", "APPLIED MATERIALS INC")]).ticker).toBeNull();
    expect(pickTicker("ALPHA INC", [us("AAA", "ALPHA INC", "Preferred")]).ticker).toBeNull();
    expect(pickTicker("ALPHA INC", undefined).ticker).toBeNull();
  });
});

describe("mapCusips", () => {
  const list = Array.from({ length: 23 }, (_, i) => ({ cusip: `C${String(i).padStart(8, "0")}`, issuer: `ISSUER ${i}` }));
  it("batches 10 per request, paces requests, stores unmatched as null, and skips what is already known", async () => {
    const calls: number[] = [], sleeps: number[] = [];
    const fetcher = async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body)) as unknown[];
      calls.push(b.length);
      return new Response(JSON.stringify(b.map((_, k) => (k === 0 ? { data: [{ ticker: "ISS", name: "ISSUER 0", exchCode: "US", securityType: "Common Stock", marketSector: "Equity" }] } : { warning: "No identifier found." }))), { status: 200 });
    };
    const map: CusipMap = { [list[0].cusip]: { ticker: "OLD", name: "x", at: "2026-10-01T00:00:00.000Z" } };
    const saved: number[] = [];
    await mapCusips(list, map, fetcher, () => new Date("2026-10-09T00:00:00Z"), () => {}, async (m) => { saved.push(Object.keys(m).length); }, async (ms) => { sleeps.push(ms); });
    expect(calls).toEqual([10, 10, 2]);                  // 22 unknown CUSIPs
    expect(sleeps.every((s) => s >= 2500)).toBe(true);   // ≤ 24 requests/minute, under the keyless 25
    expect(map[list[0].cusip].ticker).toBe("OLD");
    expect(map[list[10].cusip]).toMatchObject({ ticker: null });
    expect(saved.at(-1)).toBe(23);
  });
  it("waits and retries on HTTP 429 instead of dropping the batch", async () => {
    let n = 0;
    const sleeps: number[] = [];
    const fetcher = async (_u: string, init?: RequestInit) => {
      n++;
      if (n === 1) return new Response("slow", { status: 429, headers: { "retry-after": "7" } });
      const b = JSON.parse(String(init?.body)) as unknown[];
      return new Response(JSON.stringify(b.map(() => ({ warning: "none" }))), { status: 200 });
    };
    const map: CusipMap = {};
    await mapCusips(list.slice(0, 3), map, fetcher, () => new Date(), () => {}, async () => {}, async (ms) => { sleeps.push(ms); });
    expect(sleeps[0]).toBe(7000);
    expect(Object.keys(map)).toHaveLength(3);
  });
});

// ───────────── plugin, end to end with fixture data sets and mocked network ─────────────

const hdr = "ACCESSION_NUMBER\tINFOTABLE_SK\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tFIGI\tVALUE\tSSHPRNAMT\tSSHPRNAMTTYPE\tPUTCALL\tINVESTMENTDISCRETION\tOTHERMANAGER\tVOTING_AUTH_SOLE\tVOTING_AUTH_SHARED\tVOTING_AUTH_NONE";
const line = (acc: string, name: string, cusip: string, value: number, shares: number, pc = "") => `${acc}\t1\t${name}\tCOM\t${cusip}\t\t${value}\t${shares}\tSH\t${pc}\tSOLE\t\t${shares}\t0\t0`;
function fixtureZips() {
  const sub = (rows: string[][]) => ["ACCESSION_NUMBER\tFILING_DATE\tSUBMISSIONTYPE\tCIK\tPERIODOFREPORT", ...rows.map((r) => r.join("\t"))].join("\n");
  const cov = (rows: string[][]) => ["ACCESSION_NUMBER\tFILINGMANAGER_NAME", ...rows.map((r) => r.join("\t"))].join("\n");
  const berk = "0001067983", other = "0000000042";
  const latest = makeZip({
    "SUBMISSION.tsv": sub([["A-NOW", "14-AUG-2026", "13F-HR", berk, "30-JUN-2026"], ["B-NOW", "13-AUG-2026", "13F-HR", other, "30-JUN-2026"]]),
    "COVERPAGE.tsv": cov([["A-NOW", "Berkshire Hathaway Inc"], ["B-NOW", "Other Capital LLC"]]),
    "SUMMARYPAGE.tsv": "ACCESSION_NUMBER\tTABLEVALUETOTAL\n",
    "INFOTABLE.tsv": [hdr, line("A-NOW", "APPLE INC", "037833100", 600, 150), line("A-NOW", "APPLE INC", "037833100", 0, 0), line("A-NOW", "COCA COLA CO", "191216100", 300, 100),
      line("A-NOW", "NEW CO", "999999999", 100, 10), line("A-NOW", "APPLE INC", "037833100", 5, 1, "Call"), line("B-NOW", "APPLE INC", "037833100", 400, 100)].join("\n"),
  });
  const prev = makeZip({
    "SUBMISSION.tsv": sub([["A-PREV", "15-MAY-2026", "13F-HR", berk, "31-MAR-2026"]]),
    "COVERPAGE.tsv": cov([["A-PREV", "Berkshire Hathaway Inc"]]),
    "SUMMARYPAGE.tsv": "ACCESSION_NUMBER\tTABLEVALUETOTAL\n",
    "INFOTABLE.tsv": [hdr, line("A-PREV", "APPLE INC", "037833100", 400, 100), line("A-PREV", "COCA COLA CO", "191216100", 280, 100), line("A-PREV", "GONE CO", "888888888", 90, 50)].join("\n"),
  });
  return { latest, prev };
}

type J = { results: any; warnings?: Array<{ message: string }> };
async function mountPlugin(email: string | undefined, dir: string, secCalls: string[], newerPeriod?: string) {
  const { latest, prev } = fixtureZips();
  await writeFile(path.join(dir, "01jun2026-31aug2026_form13f.zip"), latest);
  await writeFile(path.join(dir, "01mar2026-31may2026_form13f.zip"), prev);
  const plugin = holdingsProxyPlugin(email, {
    dir, now: () => new Date("2026-10-09T12:00:00Z"), sleep: async () => {},
    secFetch: async (url, init) => {
      secCalls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/submissions/")) {
        const period = newerPeriod ?? "2026-06-30";
        return new Response(JSON.stringify({ filings: { recent: { form: ["13F-HR", "13F-HR"], filingDate: ["2026-11-14", "2026-05-15"], reportDate: [period, "2026-03-31"], accessionNumber: ["A-LIVE", "A-PREV"] } } }), { status: 200 });
      }
      // HEAD probes of the documented data-set file names: only the two fixture windows exist (the not-yet-published newest one is a 404, as at the SEC)
      return new Response(null, { status: /01jun2026-31aug2026|01mar2026-31may2026/.test(url) ? 200 : 404 });
    },
    figiFetch: async (_u, init) => {
      const b = JSON.parse(String(init?.body)) as Array<{ idValue: string }>;
      return new Response(JSON.stringify(b.map((x) => (x.idValue === "037833100" ? { data: [{ ticker: "AAPL", name: "APPLE INC", exchCode: "US", securityType: "Common Stock", marketSector: "Equity" }] } : { warning: "No identifier found." }))), { status: 200 });
    },
  });
  const app = connect();
  (plugin.configureServer as (s: never) => void).call({} as never, { middlewares: app } as never);
  const srv = createServer(app);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  servers.push(srv);
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/holdings-proxy`;
  const get = (r: string) => fetch(`${base}/${r}`).then(async (x) => ({ s: x.status, j: (await x.json()) as J }));
  const ready = async () => {
    for (let i = 0; i < 400; i++) {
      const st = (await get("status")).j.results;
      if (st.state === "ready" || st.state === "error") return st;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("never ready");
  };
  return { get, ready };
}

describe("holdings-proxy plugin", () => {
  it("without SEC_CONTACT_EMAIL it makes NO sec.gov request and says exactly what is missing", async () => {
    const calls: string[] = [];
    const s = await mountPlugin(undefined, await tmp(), calls);
    const st = (await s.get("status")).j.results;
    expect(st.state).toBe("missing_contact");
    expect(st.message).toMatch(/SEC_CONTACT_EMAIL/);
    expect((await s.get("managers")).s).toBe(503);
    expect(calls).toEqual([]);
  });

  it("builds the index from fixture data sets: aggregates, classifies against the previous quarter, maps only confirmed tickers, lists holders", async () => {
    const calls: string[] = [];
    const s = await mountPlugin("me@example.test", await tmp(), calls);
    const st = await s.ready();
    expect(st.state).toBe("ready");
    expect(st.latestPeriod).toBe("2026-06-30");
    const list = (await s.get("managers")).j.results;
    expect(list.managers.map((m: { cik: string }) => m.cik)).toEqual(["0001067983"]);
    expect(list.missing.length).toBe(29);
    const p = (await s.get("manager?cik=0001067983")).j.results;
    expect(p.filing).toEqual({ accession: "A-NOW", filingDate: "2026-08-14", periodOfReport: "2026-06-30" });
    expect(p.previousFiling.periodOfReport).toBe("2026-03-31");
    expect(p.totalValue).toBe(1005);
    expect(p.positionCount).toBe(4); // Apple shares, Apple call, Coca-Cola, New Co
    const by = Object.fromEntries(p.rows.map((r: { cusip: string; putCall: string | null }) => [`${r.cusip}${r.putCall ?? ""}`, r]));
    expect(by["037833100"]).toMatchObject({ status: "added", prevShares: 100, shares: 150, ticker: "AAPL", sharesChangePct: 50 });
    expect(by["191216100"]).toMatchObject({ status: "unchanged", ticker: null }); // no confirmed match → no ticker, never guessed
    expect(by["999999999"].status).toBe("new");
    expect(by["037833100Call"].status).toBe("new");
    expect(p.exited.map((r: { issuer: string }) => r.issuer)).toEqual(["GONE CO"]);
    const h = (await s.get("holders?ticker=aapl")).j.results;
    expect(h.holders.map((x: { name: string; value: number }) => [x.name, x.value])).toEqual([["Berkshire Hathaway Inc", 600], ["Other Capital LLC", 400]]);
    expect(h.holderCount).toBe(2);
    const none = await s.get("holders?ticker=ZZZZ");
    expect(none.s).toBe(404);
    expect(none.j.warnings![0].message).toMatch(/no high-confidence CUSIP match/);
    // politeness: only HEAD probes + one submissions JSON per manager went to sec.gov (data sets were cached on disk)
    expect(calls.filter((c) => c.startsWith("HEAD")).length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.includes("/submissions/CIK0001067983.json"))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("GET") && !c.includes("/submissions/"))).toEqual([]);
  });

  it("flags a newer 13F-HR on data.sec.gov that the bulk data set does not carry yet", async () => {
    const s = await mountPlugin("me@example.test", await tmp(), [], "2026-09-30");
    await s.ready();
    const p = (await s.get("manager?cik=0001067983")).j.results;
    expect(p.newerFiling).toEqual({ accession: "A-LIVE", filingDate: "2026-11-14", periodOfReport: "2026-09-30" });
    const same = await mountPlugin("me@example.test", await tmp(), [], "2026-06-30");
    await same.ready();
    expect((await same.get("manager?cik=0001067983")).j.results.newerFiling).toBeNull();
  });

  it("an unknown manager and an unknown route are clear 404s", async () => {
    const s = await mountPlugin("me@example.test", await tmp(), []);
    await s.ready();
    expect((await s.get("manager?cik=1")).s).toBe(404);
    expect((await s.get("nope")).s).toBe(404);
  });
});
