import { afterEach, describe, expect, it, vi } from "vitest";
import connect from "connect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { macroProxyPlugin } from "../../../vite-plugins/macro";
import { resetFredPause } from "../../../vite-plugins/macroDirect";
import { ALL_BY_ID } from "./catalog";
import { SERIES } from "./config";
import { US_SERIES } from "./usCatalog";
import { usSectionLoads } from "./urlState";

// FRED budget hygiene. Every upstream call is stubbed: nothing here reaches api.stlouisfed.org (or any other host).
// The plugin is mounted with its REAL adapters; only global fetch is replaced, and requests to the local test server
// are passed through to the real fetch.

const KEY = "fred-test-key-0123456789abcdef";
const FRED = "api.stlouisfed.org";
const realFetch = globalThis.fetch;
const servers: Server[] = [];
const dirs: string[] = [];

type Upstream = (url: string) => Response;
/** Generic answers: valid enough for every adapter to parse or to fail cleanly, without any network. */
const genericUpstream: Upstream = (url) => {
  if (url.includes(FRED)) {
    return Response.json({
      observations: [
        { date: "2025-06-01", value: "1.5", realtime_start: "2025-07-01", realtime_end: "9999-12-31" },
        { date: "2026-06-01", value: "2.5", realtime_start: "2026-07-01", realtime_end: "9999-12-31" },
      ],
      seriess: [{ title: "T", units: "U", seasonal_adjustment: "SA", last_updated: "2026-07-01", observation_start: "2000-01-01", observation_end: "2026-06-01" }],
      releases: [{ id: 10, name: "Consumer Price Index" }],
      release_dates: [{ release_id: 10, date: "2099-01-01" }],
    });
  }
  if (url.includes("/api/v1/equity/price/historical")) return Response.json({ results: [{ date: "2026-06-01", close: 2000 }, { date: "2026-07-01", close: 2100 }] });
  return new Response("stubbed upstream", { status: 503 });
};

async function mount(env: Record<string, string | undefined>, upstream: Upstream = genericUpstream) {
  const app = connect();
  const plugin = macroProxyPlugin(false, undefined, env);
  (plugin.configurePreviewServer as (s: never) => void).call({} as never, { middlewares: app } as never);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, get: (p: string) => realFetch(base + p).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => null) })) };
}

/** Replaces global fetch for upstream calls; returns the list of upstream URLs requested. */
function stubUpstream(localBases: () => string[], upstream: Upstream = genericUpstream) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (localBases().some((b) => url.startsWith(b))) return realFetch(input, init);
    calls.push(url);
    return upstream(url);
  });
  return calls;
}
const fredCalls = (calls: string[]) => calls.filter((u) => u.includes(FRED));
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

function tempDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "macro-cache-test-"));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  vi.unstubAllGlobals();
  resetFredPause();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const bases = () => servers.map((s) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`);
const usFredCodes = new Set(US_SERIES.filter((d) => d.adapter === "fred").map((d) => d.code));
const overviewFred = SERIES.filter((d) => d.adapter === "fred");

describe("no FRED request without a key", () => {
  it.each([["empty", ""], ["blank", "   "], ["unset", undefined]])("key %s: zero requests to FRED on every route, including every detail view", async (_l, key) => {
    const calls = stubUpstream(bases);
    const s = await mount({ FRED_API_KEY: key, MACRO_CACHE_DIR: "off" });
    await s.get("/macro-proxy/snapshot");
    await s.get("/macro-proxy/us");
    await s.get("/macro-proxy/calendar");
    for (const id of Object.keys(ALL_BY_ID)) await s.get(`/macro-proxy/series?id=${encodeURIComponent(id)}`);
    await settle();
    expect(calls.length).toBeGreaterThan(0); // the other providers were asked (stubbed), so the routes really ran
    expect(fredCalls(calls)).toEqual([]);
    expect(calls.some((u) => /api_key=undefined/.test(u))).toBe(false);
  });

  it("the TGA detail view (FiscalData, a US series not on FRED) makes no FRED call and still answers", async () => {
    const calls = stubUpstream(bases, (url) => url.includes("operating_cash_balance")
      ? Response.json({ data: [{ record_date: "2026-10-08", account_type: "Treasury General Account (TGA) Closing Balance", open_today_bal: "887469" }], meta: { "total-pages": 1 } })
      : genericUpstream(url));
    const s = await mount({ FRED_API_KEY: "", MACRO_CACHE_DIR: "off" });
    const r = await s.get("/macro-proxy/series?id=us.tga");
    await settle();
    expect(r.status).toBe(200);
    expect(r.body.results.history.length).toBeGreaterThan(0);
    expect(fredCalls(calls)).toEqual([]);
  });
});

describe("no automatic US prewarm on the overview", () => {
  it("opening the overview asks FRED only for the overview's own series; the US catalogue waits for the US section", async () => {
    const calls = stubUpstream(bases);
    const s = await mount({ FRED_API_KEY: KEY, MACRO_CACHE_DIR: "off" });
    const r = await s.get("/macro-proxy/snapshot");
    expect(r.status).toBe(200);
    await settle(200); // a background prewarm, if any, would have started by now
    const f = fredCalls(calls);
    expect(f).toHaveLength(overviewFred.length);
    expect(f.every((u) => u.includes("series/observations"))).toBe(true);
    const asked = f.map((u) => new URL(u).searchParams.get("series_id"));
    expect(asked.sort()).toEqual(overviewFred.map((d) => d.code).sort());
    expect(asked.some((c) => usFredCodes.has(c!) && !overviewFred.some((d) => d.code === c))).toBe(false);
    expect(asked).not.toContain("USREC");

    // Opening the US section is what loads it (58 series), plus the shared reaction data (3).
    calls.length = 0;
    await s.get("/macro-proxy/us");
    await settle(200);
    expect(fredCalls(calls)).toHaveLength(usFredCodes.size + 3);
  });

  it("the page loads the US catalogue only when the US section is opened or the US filter is chosen", () => {
    expect(usSectionLoads("all", false)).toBe(false);
    expect(usSectionLoads("DE", false)).toBe(false);
    expect(usSectionLoads("all", true)).toBe(true);
    expect(usSectionLoads("US", false)).toBe(true);
  });
});

describe("disk cache", () => {
  it("a restart with a warm disk cache makes zero FRED requests for the same views; entries carry source, id, time and no key", async () => {
    const dir = tempDir();
    const env = { FRED_API_KEY: KEY, MACRO_CACHE_DIR: dir };
    const calls = stubUpstream(bases);
    const a = await mount(env);
    for (const p of ["/macro-proxy/snapshot", "/macro-proxy/us", "/macro-proxy/calendar", "/macro-proxy/series?id=us.cpi"]) expect((await a.get(p)).status).toBe(200);
    await settle(200);
    const first = fredCalls(calls).length;
    expect(first).toBeGreaterThan(overviewFred.length + usFredCodes.size);

    // "Restart": a fresh plugin instance (empty memory) on the same directory.
    calls.length = 0;
    resetFredPause();
    const b = await mount(env);
    const snap = await b.get("/macro-proxy/snapshot");
    const us = await b.get("/macro-proxy/us");
    const cal = await b.get("/macro-proxy/calendar");
    const det = await b.get("/macro-proxy/series?id=us.cpi");
    await settle(200);
    expect(fredCalls(calls)).toEqual([]);
    expect([snap.status, us.status, cal.status, det.status]).toEqual([200, 200, 200, 200]);
    expect(snap.body.results.series.filter((x: { ok: boolean }) => x.ok).length).toBeGreaterThanOrEqual(overviewFred.length);
    expect(us.body.results.series.filter((x: { ok: boolean }) => x.ok).length).toBe(usFredCodes.size);
    expect(det.headers.get("x-bbterminal-cache")).toBe("HIT");

    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(usFredCodes.size);
    for (const f of files) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      expect(text, f).not.toContain(KEY);
      expect(text, f).not.toMatch(/api_key/);
      const e = JSON.parse(text);
      expect(e.v).toBe(1);
      expect(typeof e.source).toBe("string");
      expect(typeof e.seriesId).toBe("string");
      expect(Number.isFinite(Date.parse(e.fetchedAt))).toBe(true);
    }
  });

  it("an expired entry is refetched, and only that one", async () => {
    const dir = tempDir();
    const env = { FRED_API_KEY: KEY, MACRO_CACHE_DIR: dir };
    const calls = stubUpstream(bases);
    await (await mount(env)).get("/macro-proxy/snapshot");
    const target = overviewFred.find((d) => d.frequency === "monthly")!;
    const file = path.join(dir, `${encodeURIComponent(`overview/fred/${target.id}`)}.json`);
    const e = JSON.parse(fs.readFileSync(file, "utf8"));
    e.fetchedAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    fs.writeFileSync(file, JSON.stringify(e));
    calls.length = 0;
    await (await mount(env)).get("/macro-proxy/snapshot");
    const f = fredCalls(calls);
    expect(f).toHaveLength(1);
    expect(new URL(f[0]).searchParams.get("series_id")).toBe(target.code);
  });

  it("single-flight still holds on a cold cache: concurrent US opens share one fetch per series", async () => {
    const calls = stubUpstream(bases);
    const s = await mount({ FRED_API_KEY: KEY, MACRO_CACHE_DIR: tempDir() });
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => s.get("/macro-proxy/us")));
    await settle(200);
    expect(rs.every((r) => r.status === 200)).toBe(true);
    // catalogue requests carry a realtime window; the shared reaction legs (DGS2 is also a catalogue series) do not
    const catalogue = fredCalls(calls).filter((u) => u.includes("series/observations") && new URL(u).searchParams.has("realtime_start"));
    expect(catalogue).toHaveLength(usFredCodes.size);
    expect(new Set(catalogue.map((u) => new URL(u).searchParams.get("series_id"))).size).toBe(usFredCodes.size);
  });
});

describe("circuit breaker", () => {
  it("once FRED refuses (429), no route sends FRED anything while the breaker is open, and nothing is prewarmed", async () => {
    let refuse = true;
    const calls = stubUpstream(bases, (url) => (url.includes(FRED) && refuse ? new Response("Too Many Requests", { status: 429 }) : genericUpstream(url)));
    const s = await mount({ FRED_API_KEY: KEY, MACRO_CACHE_DIR: "off" });
    await s.get("/macro-proxy/snapshot"); // trips the breaker
    await settle();
    expect(fredCalls(calls).length).toBeGreaterThan(0);
    refuse = false;
    calls.length = 0;
    await settle(5_100); // past the adapter's 5 s failure cooldown, so the loaders really try again
    await s.get("/macro-proxy/snapshot");
    await s.get("/macro-proxy/us");
    await s.get("/macro-proxy/calendar");
    for (const id of ["us.cpi", "us.y10", "us.tga", "nz.unemp"]) await s.get(`/macro-proxy/series?id=${id}`);
    await settle(200);
    expect(fredCalls(calls)).toEqual([]);
  }, 15_000);
});
