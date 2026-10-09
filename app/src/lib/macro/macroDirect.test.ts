import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blsAdapter, bisAdapter, bocAdapter, boeAdapter, eurostatAdapter, fredAdapter, imfAdapter, jpstatAdapter, parseCsv, scrub, snbAdapter, statcanAdapter,
} from "../../../vite-plugins/macroDirect";
import { AdapterError, RateLimitedError } from "../../../vite-plugins/macroAdapters";
import { SERIES_BY_ID } from "./config";
import { buildView, yoyFromIndex } from "./math";

// Each fixture is shaped like the provider's real answer (captured 2026-10-09), trimmed.
const NOW = Date.parse("2026-10-09T12:00:00Z");
const def = (id: string) => SERIES_BY_ID[id];
const KEY = "k3y-secret-value-0123456789abcdef";

const reply = (body: string | object, init: ResponseInit = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, ...init });
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => { calls.push({ url: String(url), init }); return handler(String(url), init); });
  return calls;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("helpers", () => {
  it("scrub removes every secret, and ignores empty/short ones", () => {
    expect(scrub(`The key:${KEY} provided is invalid; again ${KEY}`, [KEY, undefined, ""])).toBe("The key:[key] provided is invalid; again [key]");
    expect(scrub("abc", ["a"])).toBe("abc");
  });
  it("parseCsv handles quoted delimiters, quotes, newlines and a BOM", () => {
    const rows = parseCsv('﻿A,B,C\r\n1,"x, y","say ""hi""\nthere"\r\n2,,\r\n');
    expect(rows).toEqual([["A", "B", "C"], ["1", "x, y", 'say "hi"\nthere'], ["2", "", ""]]);
    expect(parseCsv('"CubeId";"x"\n"2026-01";"LZ";"0"', ";")).toEqual([["CubeId", "x"], ["2026-01", "LZ", "0"]]);
  });
});

describe("BLS adapter", () => {
  const body = {
    status: "REQUEST_SUCCEEDED", message: [],
    Results: { series: [
      { seriesID: "CUUR0000SA0", data: [
        { year: "2026", period: "M08", value: "334.980" }, { year: "2026", period: "M13", value: "300.000" }, { year: "2025", period: "M08", value: "323.976" }, { year: "2026", period: "M07", value: "-" },
      ] },
      { seriesID: "LNS14000000", data: [{ year: "2026", period: "M09", value: "4.2" }, { year: "2026", period: "M08", value: "4.1" }] },
    ] },
  };
  it("with no key: serves the series from the keyless v1 endpoint (no key in the body) with a non-blocking 'API key missing' notice", async () => {
    for (const k of [undefined, "", "   "]) {
      const calls = mockFetch(() => reply(body));
      const r = await blsAdapter(k).fetchSeries([def("us.cpi"), def("us.unemp")], NOW);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain("/publicAPI/v1/");
      expect(String(calls[0].init?.body)).not.toContain("registrationkey");
      expect(JSON.parse(String(calls[0].init?.body)).startyear).toBe("2017"); // 10 calendar years max on v1
      expect(r.every((s) => s.ok && s.notice?.kind === "key_missing" && /BLS_API_KEY is not set/.test(s.notice.message) && /25 queries\/day/.test(s.notice.message))).toBe(true);
    }
  });
  it("parses monthly periods only (M13 annual average and '-' are dropped) and sends ONE v2 request carrying the key only in the body", async () => {
    const calls = mockFetch(() => reply(body));
    const [cpi, unemp] = await blsAdapter(KEY).fetchSeries([def("us.cpi"), def("us.unemp")], NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/publicAPI/v2/");
    expect(calls[0].url).not.toContain(KEY);
    expect(String(calls[0].init?.body)).toContain(KEY);
    expect(cpi.notice).toBeUndefined();
    expect(cpi.observations).toEqual([{ period: "2025-08", value: 323.976 }, { period: "2026-08", value: 334.98 }]);
    expect(unemp.observations.at(-1)).toEqual({ period: "2026-09", value: 4.2 });
    // computed YoY, hand-check: 334.980 / 323.976 − 1 = 3.3966…%
    expect(yoyFromIndex(cpi.observations).at(-1)!.value).toBeCloseTo(3.3966, 3);
    expect(buildView(def("us.cpi"), cpi, NOW).computed).toBe(true);
  });
  it("a rejected key falls back to v1 in the same refresh: data served, 'API key rejected' only as a note, and the echoed key never survives", async () => {
    const calls = mockFetch((url) => url.includes("/v2/")
      ? reply({ status: "REQUEST_NOT_PROCESSED", message: [`The key:${KEY} provided by the User is invalid. Please provide a proper key for the operation to be successful`], Results: {} })
      : reply(body));
    const r = await blsAdapter(KEY).fetchSeries([def("us.cpi"), def("us.unemp")], NOW);
    expect(calls.map((c) => c.url.includes("/v2/") ? "v2" : "v1")).toEqual(["v2", "v1"]);
    expect(r.every((s) => s.ok && s.notice?.kind === "key_rejected")).toBe(true);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(String(calls[1].init?.body)).not.toContain(KEY);
  });
  it("an exhausted daily quota becomes a RateLimitedError (no silent fallback that would burn the other limit)", async () => {
    mockFetch(() => reply({ status: "REQUEST_NOT_PROCESSED", message: ["daily threshold for total number of requests allocated to the user has been reached"], Results: {} }));
    await expect(blsAdapter(KEY).fetchSeries([def("us.cpi")], NOW)).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe("FRED adapter", () => {
  it("with no key: key_missing and no request", async () => {
    const calls = mockFetch(() => reply({}));
    const r = await fredAdapter(undefined).fetchSeries([def("nz.unemp")], NOW);
    expect(r[0]).toMatchObject({ ok: false, errorKind: "key_missing" });
    expect(calls).toHaveLength(0);
  });
  it("drops '.' placeholders, maps quarter-start dates to quarters, and one bad series does not fail the others", async () => {
    mockFetch((url) => url.includes("LRHUTTTTNZQ156S")
      ? reply({ observations: [{ date: "2026-01-01", value: "5.4" }, { date: "2026-04-01", value: "5.6" }, { date: "2026-07-01", value: "." }] })
      : reply({ error_code: 400, error_message: "Bad Request.  The series does not exist." }, { status: 400 }));
    const r = await fredAdapter(KEY).fetchSeries([def("nz.unemp"), def("ch.unemp")], NOW);
    expect(r[0].observations).toEqual([{ period: "2026-Q1", value: 5.4 }, { period: "2026-Q2", value: 5.6 }]);
    expect(r[1].ok).toBe(false);
    expect(r[1].error).toMatch(/HTTP 400/);
  });
  it("a rejected key is reported without ever containing the key", async () => {
    mockFetch(() => reply({ error_code: 400, error_message: `Bad Request. The value for variable api_key is not registered: ${KEY}.` }, { status: 400 }));
    const [r] = await fredAdapter(KEY).fetchSeries([def("nz.unemp")], NOW);
    expect(r.errorKind).toBe("key_rejected");
    expect(r.error).not.toContain(KEY);
  });
});

describe("Eurostat adapter (JSON-stat)", () => {
  const js = (values: Record<string, number>, times: string[], size = [1, 1, 1, 1, times.length], id = ["freq", "unit", "coicop18", "geo", "time"]) => ({
    id, size, value: values, updated: "2026-10-02T11:00:00+0200",
    dimension: { time: { category: { index: Object.fromEntries(times.map((t, i) => [t, i])) } } },
  });
  it("reads the time axis and the dataset's own update timestamp; the published rate is not recomputed", async () => {
    mockFetch(() => reply(js({ "0": 3.2, "1": 3.8 }, ["2026-08", "2026-09"])));
    const [r] = await eurostatAdapter.fetchSeries([def("ea.cpi")], NOW);
    expect(r.observations).toEqual([{ period: "2026-08", value: 3.2 }, { period: "2026-09", value: 3.8 }]);
    expect(r.refreshedAt).toBe("2026-10-02T09:00:00.000Z");
    expect(buildView(def("ea.cpi"), r, NOW).computed).toBe(false);
  });
  it("refuses a query whose filters do not pin a single series instead of guessing", async () => {
    mockFetch(() => reply(js({ "0": 1, "1": 2 }, ["2026-09"], [1, 1, 2, 1, 1])));
    const [r] = await eurostatAdapter.fetchSeries([def("ea.cpi")], NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/more than one series/);
  });
  it("a month with no value stays missing (never filled)", async () => {
    mockFetch(() => reply(js({ "0": 6.4 }, ["2026-08", "2026-09"])));
    const [r] = await eurostatAdapter.fetchSeries([def("ea.unemp")], NOW);
    expect(r.observations).toEqual([{ period: "2026-08", value: 6.4 }]);
  });
});

describe("Statistics Canada adapter", () => {
  it("one POST for all vectors; computes nothing; keeps the release time", async () => {
    const calls = mockFetch(() => reply([
      { status: "SUCCESS", object: { vectorId: 41690973, productId: 18100004, vectorDataPoint: [{ refPer: "2025-08-01", value: 164.1, releaseTime: "2025-09-16T08:30" }, { refPer: "2026-08-01", value: 169.8, releaseTime: "2026-09-14T08:30" }] } },
      { status: "SUCCESS", object: { vectorId: 2062815, productId: 14100287, vectorDataPoint: [{ refPer: "2026-09-01", value: 6.5, releaseTime: "2026-10-09T08:30" }] } },
    ]));
    const [cpi, un] = await statcanAdapter.fetchSeries([def("ca.cpi"), def("ca.unemp")], NOW);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual([{ vectorId: 41690973, latestN: 200 }, { vectorId: 2062815, latestN: 200 }]);
    expect(cpi.observations).toEqual([{ period: "2025-08", value: 164.1 }, { period: "2026-08", value: 169.8 }]);
    expect(un.observations).toEqual([{ period: "2026-09", value: 6.5 }]);
    expect(un.refreshedAt).toBe("2026-10-09T00:00:00.000Z");
    expect(buildView(def("ca.cpi"), cpi, NOW).latest!.value).toBeCloseTo((169.8 / 164.1 - 1) * 100, 10);
  });
  it("a FAILED vector is that series' error, not the whole adapter's", async () => {
    mockFetch(() => reply([{ status: "FAILED", object: "Vector does not exist" }, { status: "SUCCESS", object: { vectorId: 2062815, productId: 14100287, vectorDataPoint: [{ refPer: "2026-09-01", value: 6.5 }] } }]));
    const [a, b] = await statcanAdapter.fetchSeries([def("ca.cpi"), def("ca.unemp")], NOW);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(true);
  });
});

describe("Bank of Canada, Bank of England, SNB, BIS", () => {
  it("BoC Valet: reads the string value of the series key", async () => {
    mockFetch(() => reply({ observations: [{ d: "2026-10-05", V39079: { v: "2.25" } }, { d: "2026-10-06", V39079: { v: "2.25" } }] }));
    const [r] = await bocAdapter.fetchSeries([def("ca.policy")], NOW);
    expect(r.observations.at(-1)).toEqual({ period: "2026-10-06", value: 2.25 });
  });
  it("BoE IADB: parses 'DD Mon YYYY' dates and refuses an HTML error page", async () => {
    mockFetch(() => reply("DATE,IUDBEDR\r\n07 Oct 2026,3.75\r\n08 Oct 2026,3.75\r\n"));
    const [r] = await boeAdapter.fetchSeries([def("uk.policy")], NOW);
    expect(r.observations).toEqual([{ period: "2026-10-07", value: 3.75 }, { period: "2026-10-08", value: 3.75 }]);
    mockFetch(() => reply("<html><body>Error</body></html>"));
    await expect(boeAdapter.fetchSeries([def("uk.policy")], NOW)).rejects.toThrow(/expected CSV/);
  });
  it("SNB cube CSV: filters the item, skips empty values, uses the PublishingDate", async () => {
    const csv = '﻿"CubeId";"snbgwdzid"\n"PublishingDate";"2026-10-05 10:00"\n\n"Date";"D0";"Value"\n"2026-10-01";"LZ";"0"\n"2026-10-01";"SARON";""\n"2026-10-02";"LZ";"0"\n"2026-10-02";"ZIG";"-0.25"\n';
    mockFetch(() => reply(csv));
    const [r] = await snbAdapter.fetchSeries([def("ch.policy")], NOW);
    expect(r.observations).toEqual([{ period: "2026-10-01", value: 0 }, { period: "2026-10-02", value: 0 }]);
    expect(r.refreshedAt).toBe("2026-10-05T09:00:00.000Z");
  });
  it("SNB inflation cube: monthly items TLK (CPI) and KGM (trimmed mean) come from one request", async () => {
    const csv = '"CubeId";"plkoprinfla"\n"PublishingDate";"2026-09-21 09:00"\n\n"Date";"D0";"Value"\n"2026-08";"KGM";"0.577251"\n"2026-08";"TLK";"0.8"\n';
    const calls = mockFetch(() => reply(csv));
    const [cpi, core] = await snbAdapter.fetchSeries([def("ch.cpi"), def("ch.core")], NOW);
    expect(calls).toHaveLength(1);
    expect(cpi.observations).toEqual([{ period: "2026-08", value: 0.8 }]);
    expect(core.observations).toEqual([{ period: "2026-08", value: 0.577251 }]);
  });
  it("BIS: one CSV request, rows split by REF_AREA, quoted free-text columns survive", async () => {
    const csv = 'FREQ,REF_AREA,TITLE,TIME_PERIOD,OBS_VALUE\nD,JP,"Central bank policy rates - Japan, Daily",2026-10-05,1.25\nD,JP,"Central bank policy rates - Japan, Daily",2026-10-06,1.25\nD,NZ,"Central bank policy rates - New Zealand, Daily",2026-10-02,2.75\n';
    const calls = mockFetch(() => reply(csv));
    const [jp, nz] = await bisAdapter.fetchSeries([def("jp.policy"), def("nz.policy")], NOW);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("D.JP+NZ");
    expect(jp.observations.at(-1)).toEqual({ period: "2026-10-06", value: 1.25 });
    expect(nz.observations).toEqual([{ period: "2026-10-02", value: 2.75 }]);
  });
});

describe("Japan Statistics Dashboard and IMF", () => {
  it("keeps only monthly, seasonally adjusted rows (@isSeasonal=2) and skips annual/quarterly rows", async () => {
    const row = (time: string, seasonal: string, v: string, cycle = "1") => ({ VALUE: { "@time": time, "@cycle": cycle, "@isSeasonal": seasonal, $: v } });
    mockFetch(() => reply({ GET_STATS: { RESULT: { status: "0" }, STATISTICAL_DATA: { DATA_INF: { DATA_OBJ: [
      row("20260800", "1", "2.6"), row("20260800", "2", "2.5"), row("20260700", "2", "2.4"), row("2026FY00", "2", "9.9", "4"), row("20261Q00", "2", "2.7", "3"),
    ] } } } }));
    const [r] = await jpstatAdapter.fetchSeries([def("jp.unemp")], NOW);
    expect(r.observations).toEqual([{ period: "2026-07", value: 2.4 }, { period: "2026-08", value: 2.5 }]);
  });
  it("a dashboard error status is a real error", async () => {
    mockFetch(() => reply({ GET_STATS: { RESULT: { status: "100", errorMsg: "Parameter error" } } }));
    const [r] = await jpstatAdapter.fetchSeries([def("jp.unemp")], NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Parameter error/);
  });
  it("IMF SDMX-ML: quarterly YoY as published, UPDATE_DATE as refreshed-at", async () => {
    const xml = '<?xml version="1.0"?><message:StructureSpecificData><message:DataSet UPDATE_DATE="2026-10-09T06:47:18.271672500Z"><Series COUNTRY="NZL"><Obs TIME_PERIOD="2026-Q1" OBS_VALUE="3.079291762894534" DERIVATION_TYPE="O"/><Obs TIME_PERIOD="2026-Q2" OBS_VALUE="4.058192955589587" DERIVATION_TYPE="O"/></Series></message:DataSet></message:StructureSpecificData>';
    mockFetch(() => reply(xml, { headers: { "content-type": "application/xml" } }));
    const [r] = await imfAdapter.fetchSeries([def("nz.cpi")], NOW);
    expect(r.observations.at(-1)).toEqual({ period: "2026-Q2", value: 4.058192955589587 });
    expect(r.refreshedAt).toBe("2026-10-09T06:47:18.271Z");
    expect(buildView(def("nz.cpi"), r, NOW).computed).toBe(false);
  });
});

describe("shared HTTP behaviour", () => {
  it("a Cloudflare 'Just a moment' answer is reported as blocked and is not retried or worked around", async () => {
    const calls = mockFetch(() => reply('<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>challenges.cloudflare.com</body></html>', { status: 403 }));
    const err = await bisAdapter.fetchSeries([def("jp.policy")], NOW).catch((e) => e as AdapterError);
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).kind).toBe("blocked");
    expect((err as AdapterError).message).toMatch(/does not bypass bot challenges/);
    expect(calls).toHaveLength(1);
  });
  it("HTTP 429 becomes a RateLimitedError honouring Retry-After", async () => {
    mockFetch(() => reply("slow down", { status: 429, headers: { "retry-after": "120" } }));
    const err = await bocAdapter.fetchSeries([def("ca.policy")], NOW).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.retryAfterMs).toBe(120_000);
  });
  it("sends the honest User-Agent (no personal data) on every request", async () => {
    const calls = mockFetch(() => reply({ observations: [{ d: "2026-10-06", V39079: { v: "2.25" } }] }));
    await bocAdapter.fetchSeries([def("ca.policy")], NOW);
    const ua = (calls[0].init?.headers as Record<string, string>)["user-agent"];
    expect(ua).toMatch(/personal market-data terminal/);
    expect(ua).not.toMatch(/@|\.com|password|key/i);
  });
  it("a timeout or network failure names the provider and the real cause", async () => {
    mockFetch(() => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }); });
    const [r] = await bocAdapter.fetchSeries([def("ca.policy")], NOW);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Bank of Canada unreachable \(ENOTFOUND\)/);
  });
});
