import { afterEach, describe, expect, it, vi } from "vitest";
import { fiscaldataAdapter, resetFredPause, xlsxColumn } from "../../../vite-plugins/macroDirect";
import { createDetailService } from "../../../vite-plugins/macroDetail";
import { ALL_BY_ID, ALL_SERIES } from "./catalog";
import { US_SERIES, US_GAPS } from "./usCatalog";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const KEY = "k3y-secret-value-0123456789abcdef";
const reply = (body: unknown, init: ResponseInit = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, ...init });
function mockFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => { calls.push(String(url)); return handler(String(url)); });
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); resetFredPause(); });

/** Minimal STORED (uncompressed) zip, enough for readZip. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8"), n = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(0, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(0, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data); centrals.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe("US catalogue sanity", () => {
  it("every US series names its agency and, when from FRED, its FRED id; ids are unique across catalogues", () => {
    expect(new Set(ALL_SERIES.map((s) => s.id)).size).toBe(ALL_SERIES.length);
    for (const d of US_SERIES) {
      expect(d.agency, d.id).toBeTruthy();
      expect(d.explain, d.id).toBeTruthy();
      if (d.adapter === "fred") expect(d.attribution, d.id).toContain(`(series ${d.code})`);
      for (const r of d.related ?? []) expect(ALL_BY_ID[r], `${d.id} → ${r}`).toBeTruthy();
    }
  });
  it("restricted series are not used and are listed as gaps with the reason", () => {
    const codes = US_SERIES.map((d) => d.code);
    for (const restricted of ["MICH", "EXHOSLUSM495S"]) expect(codes).not.toContain(restricted);
    expect(US_GAPS.some((g) => /MICH/.test(g.name) && /Reprinted with permission/.test(g.reason))).toBe(true);
    expect(US_GAPS.some((g) => /ISM/.test(g.name))).toBe(true);
  });
  it("the Kim-Wright term premium is labelled as Kim-Wright, not ACM", () => {
    const tp = ALL_BY_ID["us.tp10"];
    expect(tp.name).toMatch(/Kim-Wright, not ACM/);
    expect(tp.valueNote).toMatch(/NOT the NY Fed ACM/);
  });
});

describe("FiscalData adapter", () => {
  it("excludes TIPS from 10-year auctions, shares one request between both auction series, and reads the TGA line", async () => {
    const calls = mockFetch((url) => url.includes("auctions_query")
      ? reply({ data: [{ auction_date: "2026-09-09", high_yield: "4.8340", bid_to_cover_ratio: "2.710000" }, { auction_date: "2026-10-07", high_yield: "5.3000", bid_to_cover_ratio: "2.770000" }], meta: { "total-pages": 1 } })
      : reply({ data: [{ record_date: "2026-10-08", account_type: "Treasury General Account (TGA) Closing Balance", open_today_bal: "887469" }], meta: { "total-pages": 1 } }));
    const [y, btc, tga] = await fiscaldataAdapter().fetchSeries([ALL_BY_ID["us.auc10y"], ALL_BY_ID["us.auc10btc"], ALL_BY_ID["us.tga"]], NOW);
    expect(calls.filter((u) => u.includes("auctions_query"))).toHaveLength(1);
    expect(calls[0]).toContain("inflation_index_security:eq:No");
    expect(y.observations.at(-1)).toEqual({ period: "2026-10-07", value: 5.3 });
    expect(btc.observations.at(-1)).toEqual({ period: "2026-10-07", value: 2.77 });
    expect(tga.observations).toEqual([{ period: "2026-10-08", value: 887469 }]);
    expect(decodeURIComponent(calls[1])).toContain("Treasury General Account (TGA) Closing Balance");
  });
});

describe("NY Fed SCE workbook reader", () => {
  it("resolves the sheet by name, keys rows by yyyymm in column A and ignores string cells", () => {
    const buf = zip({
      "xl/workbook.xml": '<workbook><sheets><sheet name="Disclaimer" sheetId="1" r:id="rId1"/><sheet name="Inflation expectations" sheetId="4" r:id="rId4"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId4" Target="worksheets/sheet4.xml"/></Relationships>',
      "xl/worksheets/sheet4.xml": '<sheetData><row r="4"><c r="B4" t="s"><v>0</v></c></row><row r="5"><c r="A5"><v>202608</v></c><c r="B5" s="2"><v>3.6</v></c></row><row r="6"><c r="A6"><v>202609</v></c><c r="B6"><v>3.902742862701416</v></c></row></sheetData>',
    });
    expect(xlsxColumn(buf, "Inflation expectations", "B")).toEqual([["2026-08", "3.6"], ["2026-09", "3.902742862701416"]]);
    expect(() => xlsxColumn(buf, "Nope", "B")).toThrow(/no sheet named "Nope"/);
  });
});

describe("detail service", () => {
  const fredRouter = (url: string): Response => {
    if (url.includes("/fred/series/observations") && url.includes("realtime_start=1776-07-04")) {
      return reply({ observations: [
        { date: "2026-07-01", value: "1100", realtime_start: "2026-08-07", realtime_end: "9999-12-31" },
        { date: "2026-08-01", value: "1262", realtime_start: "2026-09-04", realtime_end: "2026-10-01" },
        { date: "2026-08-01", value: "1233", realtime_start: "2026-10-02", realtime_end: "9999-12-31" },
        { date: "2026-09-01", value: "1262", realtime_start: "2026-10-02", realtime_end: "9999-12-31" },
      ] });
    }
    if (url.includes("/fred/series/observations")) return reply({ observations: [
      { date: "2026-07-01", value: "1100", realtime_start: "2025-09-08", realtime_end: "9999-12-31" },
      { date: "2026-08-01", value: "1233", realtime_start: "2026-10-02", realtime_end: "9999-12-31" },
      { date: "2026-09-01", value: "1262", realtime_start: "2026-10-02", realtime_end: "9999-12-31" },
    ] });
    if (url.includes("/fred/series/release")) return reply({ releases: [{ id: 50, name: "Employment Situation", link: "http://www.bls.gov/ces/" }] });
    if (url.includes("/fred/release/dates")) return reply({ release_dates: [{ date: "2026-11-06" }] });
    if (url.includes("/fred/series?")) return reply({ seriess: [{ title: "All Employees, Total Nonfarm", units: "Thousands of Persons", seasonal_adjustment: "Seasonally Adjusted", last_updated: "2026-10-02 07:45:00-05", observation_start: "1939-01-01", observation_end: "2026-09-01" }] });
    return reply({ observations: [] });
  };

  it("serves history, release date, revisions in headline terms and caches the answer (one build for concurrent callers)", async () => {
    const calls = mockFetch(fredRouter);
    const svc = createDetailService({ defs: ALL_BY_ID, adapters: new Map(), fredKey: KEY, now: () => NOW, goldFetcher: async () => [] });
    const [a, b] = await Promise.all([svc.get("us.payrolls"), svc.get("us.payrolls")]);
    expect(a.detail).toBe(b.detail);
    const d = a.detail;
    expect(d.history.map((o) => o.period)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(d.refreshedAt).toBe("2026-10-02T00:00:00.000Z");
    expect(d.release).toMatchObject({ name: "Employment Situation", next: "2026-11-06" });
    expect(d.revisions.available && d.revisions.previous?.steps).toEqual([{ date: "2026-09-04", value: 162 }, { date: "2026-10-02", value: 133 }]);
    const perSeries = calls.filter((u) => u.includes("PAYEMS"));
    expect(perSeries.length).toBeLessThanOrEqual(4); // history, metadata, release id, vintages
    expect(JSON.stringify(d)).not.toContain(KEY);
    const again = await svc.get("us.payrolls");
    expect(again.cacheState).toBe("HIT");
  });

  it("non-US and daily market series say plainly why revisions/reactions are not shown", async () => {
    mockFetch(fredRouter);
    const svc = createDetailService({ defs: ALL_BY_ID, adapters: new Map(), fredKey: KEY, now: () => NOW, goldFetcher: async () => [] });
    const y10 = (await svc.get("us.y10")).detail;
    expect(y10.revisions).toMatchObject({ available: false });
    expect(y10.reaction).toMatchObject({ available: false });
    expect(y10.release?.nextNote).toMatch(/every business day/);
    await expect(svc.get("nope")).rejects.toThrow(/Unknown indicator/);
  });

  it("a missing FRED key is an explicit error, never an empty panel", async () => {
    const svc = createDetailService({ defs: ALL_BY_ID, adapters: new Map(), fredKey: undefined, now: () => NOW });
    const err = await svc.get("us.cpi").then(() => null, (e: Error) => e);
    expect(err?.message).toMatch(/the FRED_API_KEY environment variable is not set on the server/);
    expect(err?.message).not.toMatch(/app\/\.env|dev server/); // environment-neutral: no path the production user cannot see
  });
});

describe("detail service reuses the overview snapshot", () => {
  it("a non-FRED overview series is served from the snapshot copy with no upstream request", async () => {
    const calls = mockFetch(() => reply({}));
    const snap = { id: "uk.cpi", ok: true, observations: [{ period: "2026-07", value: 3.0 }, { period: "2026-08", value: 3.1 }], provider: "Office for National Statistics", sourceUrl: "https://db.nomics.world/ONS/MM23/D7G7.M", refreshedAt: "2026-09-30T00:00:00.000Z", retrievedAt: "2026-10-13T00:00:00.000Z" };
    const svc = createDetailService({ defs: ALL_BY_ID, adapters: new Map(), fredKey: KEY, now: () => NOW, fromSnapshot: (id) => (id === "uk.cpi" ? snap : undefined) });
    const d = (await svc.get("uk.cpi")).detail;
    expect(d.history.at(-1)).toEqual({ period: "2026-08", value: 3.1 });
    expect(d.revisions).toMatchObject({ available: false });
    expect(calls).toHaveLength(0);
  });
});

describe("US release calendar budget", () => {
  it("reads every release's next date from ONE paged FRED call, not one request per release", async () => {
    const calls = mockFetch((url) => url.includes("/fred/releases/dates")
      ? reply({ release_dates: [{ release_id: 10, date: "2026-10-14" }, { release_id: 50, date: "2026-11-06" }, { release_id: 10, date: "2026-11-10" }] })
      : reply({ release_dates: [] }));
    const svc = createDetailService({ defs: ALL_BY_ID, adapters: new Map(), fredKey: KEY, now: () => NOW });
    const rows = await svc.calendar();
    expect(rows[0]).toMatchObject({ releaseId: 10, next: "2026-10-14" });
    expect(rows.find((r) => r.releaseId === 50)?.next).toBe("2026-11-06");
    expect(calls.filter((u) => u.includes("/fred/releases/dates"))).toHaveLength(1);
    // releases absent from the window fall back to a per-release request (at most once each, cached)
    expect(calls.filter((u) => u.includes("/fred/release/dates")).length).toBe(rows.length - 2);
  });
});

describe("detail never waits long for the shared market data", () => {
  it("answers within the bound with an honest 'still loading' reaction, and that answer is not kept for hours", async () => {
    let now = NOW;
    mockFetch((url) => {
      if (url.includes("/fred/series/observations") && url.includes("realtime_start=1776-07-04")) return reply({ observations: [
        { date: "2026-08-01", value: "1233", realtime_start: "2026-09-04", realtime_end: "9999-12-31" }, { date: "2026-09-01", value: "1262", realtime_start: "2026-10-02", realtime_end: "9999-12-31" }] });
      if (url.includes("/fred/series/observations")) return reply({ observations: [{ date: "2026-09-01", value: "1262", realtime_start: "2026-10-02", realtime_end: "9999-12-31" }] });
      return reply({});
    });
    const slowGold = () => new Promise<never>(() => { /* never answers */ });
    const svc = createDetailService({ defs: ALL_BY_ID, adapters: new Map(), fredKey: KEY, now: () => now, goldFetcher: slowGold });
    const t0 = Date.now();
    const d = (await svc.get("us.payrolls")).detail;
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(d.reaction).toMatchObject({ available: false, reason: expect.stringMatching(/still loading/) });
    expect("partial" in d).toBe(false);
    expect((await svc.get("us.payrolls")).cacheState).toBe("HIT");
    now += 25_000; // past the short partial TTL: rebuilt rather than served for 6 h
    expect((await svc.get("us.payrolls")).cacheState).toBe("MISS");
  }, 15000);
});
