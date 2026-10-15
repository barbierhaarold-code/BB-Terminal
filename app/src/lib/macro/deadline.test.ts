import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { adapterDeadlineMs, DEFAULT_ADAPTER_DEADLINE_MS, macroProxyPlugin } from "../../../vite-plugins/macro";
import type { MacroAdapter } from "../../../vite-plugins/macroAdapters";
import { FRED_BUDGET_PER_MIN, FRED_PAUSE_MS, fredAdapter, fredGet, resetFredPause } from "../../../vite-plugins/macroDirect";
import { SERIES } from "./config";
import { buildViews } from "./math";
import { awaitingBackground, pendingPoller, PENDING_POLL_MAX_MS, PENDING_POLL_MS, servedLabel } from "./served";
import type { AdapterId, AdapterSeries, MacroSnapshot, SeriesDef } from "./types";

// Per-adapter deadline, stale-while-revalidate and the "served" badge. Fake timers (setTimeout, clearTimeout, Date):
// latencies below are in fake milliseconds, so a 30 s upstream costs no real time. Every upstream is a stub; global
// fetch is replaced so that any real request (FRED or other) would be recorded, and none is expected.

const T0 = new Date("2026-10-15T08:00:00Z");
const DAY = 86_400_000;
const countOf = (a: AdapterId) => SERIES.filter((d) => d.adapter === a).length;
const okSeries = (d: SeriesDef): AdapterSeries => ({
  id: d.id, ok: true, observations: [{ period: "2026-08", value: 1 }, { period: "2026-09", value: 2 }], provider: d.provider, sourceUrl: "x",
  refreshedAt: "2026-10-01T00:00:00.000Z", retrievedAt: new Date().toISOString(),
});

/** An adapter that answers after `ms` (fake time); `ms = 0` answers at once. Counts upstream calls. */
function stub(id: AdapterId, ms: number, behaviour: (defs: SeriesDef[]) => AdapterSeries[] = (defs) => defs.map(okSeries)) {
  const calls = { n: 0 };
  const adapter: MacroAdapter = {
    id,
    fetchSeries(defs) {
      calls.n++;
      return ms ? new Promise((r) => setTimeout(() => r(behaviour(defs)), ms)) : Promise.resolve().then(() => behaviour(defs));
    },
  };
  return { adapter, calls };
}

interface Answer { status: number; headers: Record<string, string>; body: { results: MacroSnapshot & { cacheState: string } } }
/** Mounts the plugin the way the production gateway does and returns a GET that calls the middleware directly (no socket). */
function mount(adapters: MacroAdapter[] | undefined, env: Record<string, string | undefined> = {}) {
  type H = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  let handle: H | null = null;
  const plugin = macroProxyPlugin(false, adapters, { MACRO_CACHE_DIR: "off", ...env });
  (plugin.configurePreviewServer as (s: never) => void).call({} as never, { middlewares: { use: (h: H) => { handle = h; } } } as never);
  return (p = "/macro-proxy/snapshot") => new Promise<Answer>((resolve, reject) => {
    const headers: Record<string, string> = {};
    const res = {
      statusCode: 200,
      setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = String(v); },
      end: (text: string) => resolve({ status: res.statusCode, headers, body: JSON.parse(text) }),
    };
    handle!({ url: p, method: "GET" } as IncomingMessage, res as unknown as ServerResponse, () => reject(new Error("not handled")));
  });
}

/** Resolves `p` while advancing fake time in 100 ms steps; returns how much fake time it took. */
async function timed<T>(p: Promise<T>, maxMs = 120_000): Promise<{ ms: number; value: T }> {
  const t0 = Date.now();
  let done = false, value!: T;
  void p.then((v) => { done = true; value = v; });
  await vi.advanceTimersByTimeAsync(0);
  while (!done && Date.now() - t0 < maxMs) await vi.advanceTimersByTimeAsync(100);
  if (!done) throw new Error(`no answer within ${maxMs} ms of fake time`);
  return { ms: Date.now() - t0, value };
}
const byId = (a: Answer, id: string) => a.body.results.series.find((x) => x.id === id)!;
const firstOf = (a: AdapterId) => SERIES.find((d) => d.adapter === a)!.id;

const dirs: string[] = [];
const tempDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "macro-deadline-test-")); dirs.push(d); return d; };
let upstream: string[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(T0);
  upstream = [];
  // Nothing in this file may reach the network: any fetch is recorded and refused.
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    upstream.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return new Response("stubbed upstream", { status: 503 });
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetFredPause();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("per-adapter deadline", () => {
  it("one hanging adapter (30 s) no longer holds the overview: it answers at the 8 s deadline, the rest is served", async () => {
    const dbn = stub("dbnomics", 30_000);
    const fred = stub("fred", 0);
    const statcan = stub("statcan", 2_000); // slow but within the deadline: still in the first answer
    const get = mount([dbn.adapter, fred.adapter, statcan.adapter]);
    const { ms, value: a } = await timed(get());
    expect(ms).toBeGreaterThanOrEqual(DEFAULT_ADAPTER_DEADLINE_MS);
    expect(ms).toBeLessThanOrEqual(DEFAULT_ADAPTER_DEADLINE_MS + 100); // before this change: 30 000 (the slowest adapter)
    expect(a.status).toBe(200);
    expect(byId(a, firstOf("fred")).ok).toBe(true);
    expect(byId(a, firstOf("statcan")).ok).toBe(true);
    expect(byId(a, firstOf("dbnomics"))).toMatchObject({ ok: false, errorKind: "pending" });
    expect(byId(a, firstOf("dbnomics")).error).toMatch(/Still loading/);
    expect(a.body.results.served).toMatchObject({ fetched: countOf("fred") + countOf("statcan"), pending: countOf("dbnomics") });
    expect(vi.mocked(console.info).mock.calls.flat().join("\n")).toMatch(/overview\/dbnomics missed the 8 s deadline/);
  });

  it("the deadline is configurable (MACRO_ADAPTER_DEADLINE_MS) and falls back to 8 s on a bad value", async () => {
    expect(adapterDeadlineMs({})).toBe(8_000);
    expect(adapterDeadlineMs({ MACRO_ADAPTER_DEADLINE_MS: "abc" })).toBe(8_000);
    expect(adapterDeadlineMs({ MACRO_ADAPTER_DEADLINE_MS: "-1" })).toBe(8_000);
    expect(adapterDeadlineMs({ MACRO_ADAPTER_DEADLINE_MS: "999999" })).toBe(8_000);
    const get = mount([stub("dbnomics", 30_000).adapter, stub("fred", 0).adapter], { MACRO_ADAPTER_DEADLINE_MS: "3000" });
    const { ms } = await timed(get());
    expect(ms).toBeGreaterThanOrEqual(3_000);
    expect(ms).toBeLessThanOrEqual(3_100);
  });

  it("the late adapter finishes in the background and fills the memory and disk caches; the next request gets it with no new upstream call", async () => {
    const dir = tempDir();
    const dbn = stub("dbnomics", 30_000);
    const get = mount([dbn.adapter, stub("fred", 0).adapter], { MACRO_CACHE_DIR: dir });
    const first = (await timed(get())).value;
    expect(first.body.results.served!.pending).toBe(countOf("dbnomics"));
    const file = path.join(dir, `${encodeURIComponent(`overview/dbnomics/${firstOf("dbnomics")}`)}.json`);
    expect(fs.existsSync(file)).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000); // the upstream answers, nobody is waiting for it any more
    expect(fs.existsSync(file)).toBe(true);
    expect(vi.mocked(console.info).mock.calls.flat().join("\n")).toMatch(/overview\/dbnomics answered in the background after 30\.0 s; cache filled/);

    const { ms, value: next } = await timed(get());
    expect(ms).toBeLessThanOrEqual(100);
    expect(byId(next, firstOf("dbnomics")).ok).toBe(true);
    expect(next.body.results.served).toMatchObject({ pending: 0, stale: 0, fetched: 0 });
    expect(next.body.results.served!.memory).toBe(countOf("dbnomics") + countOf("fred"));
    expect(dbn.calls.n).toBe(1);
  });

  it("no duplicate request: concurrent callers, the page's retries and a later rebuild all join the one running refresh", async () => {
    const dbn = stub("dbnomics", 11 * 60_000); // longer than the 10-min assembled-snapshot cache, so a rebuild happens meanwhile
    const get = mount([dbn.adapter, stub("fred", 0).adapter]);
    const answers = await timed(Promise.all([get(), get(), get(), get(), get()]));
    expect(answers.ms).toBeLessThanOrEqual(DEFAULT_ADAPTER_DEADLINE_MS + 100);
    expect(dbn.calls.n).toBe(1);
    for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync(10_000); await timed(get()); } // the page polling every 10 s
    expect(dbn.calls.n).toBe(1);
    vi.setSystemTime(Date.now() + 10 * 60_000); // past the snapshot cache: the next request reassembles it
    const { ms, value: rebuilt } = await timed(get());
    expect(ms).toBeLessThanOrEqual(100); // it joins a refresh that already missed its deadline: it does not wait again
    expect(byId(rebuilt, firstOf("dbnomics")).errorKind).toBe("pending");
    expect(dbn.calls.n).toBe(1);
  });
});

describe("stale-while-revalidate", () => {
  it("an expired cached copy is served at once, marked STALE, and refreshed in the background (one request)", async () => {
    const dir = tempDir();
    await timed(mount([stub("dbnomics", 0).adapter, stub("fred", 0).adapter], { MACRO_CACHE_DIR: dir })()); // warm the disk
    vi.setSystemTime(T0.getTime() + 3 * DAY); // every entry is past its TTL (≤ 48 h), within the 7-day limit

    const dbn = stub("dbnomics", 30_000), fred = stub("fred", 30_000);
    const get = mount([dbn.adapter, fred.adapter], { MACRO_CACHE_DIR: dir }); // "restart" on the same directory
    const { ms, value: a } = await timed(get());
    expect(ms).toBeLessThanOrEqual(100); // nothing is waited for: every series has a copy
    expect(a.body.results.cacheState).toBe("STALE");
    expect(byId(a, firstOf("dbnomics"))).toMatchObject({ ok: true, staleCache: { fetchedAt: T0.toISOString(), refreshing: true } });
    const n = countOf("dbnomics") + countOf("fred");
    expect(a.body.results.served).toMatchObject({ stale: n, refreshing: n, pending: 0, fetched: 0 });
    expect(a.body.results.warnings[0]).toMatch(/past its refresh interval; it is shown now while a refresh runs in the background/);
    expect([dbn.calls.n, fred.calls.n]).toEqual([1, 1]);
    expect(awaitingBackground(a.body.results)).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    const fresh = (await timed(get())).value;
    expect(byId(fresh, firstOf("dbnomics")).staleCache).toBeUndefined();
    expect(fresh.body.results.cacheState).toBe("HIT");
    expect(awaitingBackground(fresh.body.results)).toBe(false);
    expect([dbn.calls.n, fred.calls.n]).toEqual([1, 1]);
  });

  it("if the background refresh fails for EVERY source, the older snapshot served meanwhile no longer claims to be refreshing (the page stops polling)", async () => {
    const dir = tempDir();
    await timed(mount([stub("dbnomics", 0).adapter], { MACRO_CACHE_DIR: dir })());
    vi.setSystemTime(T0.getTime() + 3 * DAY);
    const dbn = { calls: { n: 0 } };
    const failing: MacroAdapter = { id: "dbnomics", fetchSeries: () => { dbn.calls.n++; return new Promise((_r, reject) => setTimeout(() => reject(new Error("DBnomics answered HTTP 503 Service Unavailable.")), 1_000)); } };
    const get = mount([failing], { MACRO_CACHE_DIR: dir });
    expect(awaitingBackground((await timed(get())).value.body.results)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    const after = (await timed(get())).value;
    expect(after.body.results.cacheState).toBe("STALE");
    expect(awaitingBackground(after.body.results)).toBe(false);
    expect(dbn.calls.n).toBe(1);
  });

  it("the 7-day limit stays: an older copy is not served; the series waits for its source like a cold one", async () => {
    const dir = tempDir();
    await timed(mount([stub("dbnomics", 0).adapter], { MACRO_CACHE_DIR: dir })());
    vi.setSystemTime(T0.getTime() + 8 * DAY);
    const { ms, value: a } = await timed(mount([stub("dbnomics", 30_000).adapter], { MACRO_CACHE_DIR: dir })());
    expect(ms).toBeGreaterThanOrEqual(DEFAULT_ADAPTER_DEADLINE_MS);
    expect(byId(a, firstOf("dbnomics"))).toMatchObject({ ok: false, errorKind: "pending" });
  });
});

describe("three distinct states: still loading, source unavailable, API key missing", () => {
  it("each has its own kind on the wire and in the page's views; zero FRED requests without a key", async () => {
    const dbn = stub("dbnomics", 30_000);
    const statcan: MacroAdapter = { id: "statcan", fetchSeries: () => Promise.reject(new Error("Statistics Canada answered HTTP 503 Service Unavailable.")) };
    const get = mount([dbn.adapter, statcan, fredAdapter(""), stub("eurostat", 0).adapter], { FRED_API_KEY: "" });
    const a = (await timed(get())).value;
    expect(a.status).toBe(200);
    expect(byId(a, firstOf("dbnomics")).errorKind).toBe("pending");
    expect(byId(a, firstOf("statcan"))).toMatchObject({ ok: false, errorKind: "error" });
    expect(byId(a, firstOf("fred"))).toMatchObject({ ok: false, errorKind: "key_missing" });
    expect(a.body.results.served).toMatchObject({ pending: countOf("dbnomics"), failed: countOf("statcan"), unrequested: countOf("fred"), fetched: countOf("eurostat") });

    const v = buildViews(a.body.results, Date.now());
    expect(v.pending?.seriesIds.sort()).toEqual(SERIES.filter((d) => d.adapter === "dbnomics").map((d) => d.id).sort());
    expect(v.accessProblems.map((p) => p.kind)).toEqual(["key_missing"]); // "still loading" is not an access problem
    const kindOf = (id: string) => { const d = SERIES.find((x) => x.id === id)!; return v.gaps.find((g) => g.economy === d.economy && g.indicator === d.indicator)?.kind; };
    expect(kindOf(firstOf("dbnomics"))).toBe("pending");
    expect(kindOf(firstOf("statcan"))).toBe("fetch_error");
    expect(kindOf(firstOf("fred"))).toBe("key_missing");

    // The missing-key message names the environment variable, not a developer-only file path.
    const msg = byId(a, firstOf("fred")).error!;
    expect(msg).toMatch(/the FRED_API_KEY environment variable is not set on the server \(Docker deployment: \.env\.production\)/);
    expect(msg).not.toMatch(/app\/\.env|dev server/);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(upstream).toEqual([]); // the stubs above never touch fetch; the real FRED adapter did not either
  });

  it("with the REAL adapters and no FRED key, a hanging upstream still answers at the deadline and FRED is never called", async () => {
    vi.stubGlobal("fetch", (input: string | URL | Request) => {
      upstream.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      return new Promise<Response>((r) => setTimeout(() => r(new Response("stubbed upstream", { status: 503 })), 25_000));
    });
    const get = mount(undefined, { FRED_API_KEY: "" });
    const { ms, value: a } = await timed(get());
    expect(ms).toBeLessThanOrEqual(DEFAULT_ADAPTER_DEADLINE_MS + 100);
    expect(a.status).toBe(200);
    expect(a.body.results.served!.unrequested).toBe(countOf("fred"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(upstream.length).toBeGreaterThan(0); // the other providers were asked (stubbed)
    expect(upstream.filter((u) => u.includes("stlouisfed.org"))).toEqual([]);
  });
});

describe("served badge", () => {
  it("after a restart with a warm disk and nothing fetched it says 'served from disk cache' (HIT), not 'cache MISS', even with FRED's key missing", async () => {
    const dir = tempDir();
    const cold = (await timed(mount([stub("dbnomics", 0).adapter, fredAdapter("")], { MACRO_CACHE_DIR: dir, FRED_API_KEY: "" })())).value;
    expect(cold.body.results.cacheState).toBe("MISS");
    expect(servedLabel(cold.body.results)).toBe("fetched from sources");

    const dbn = stub("dbnomics", 0);
    const get = mount([dbn.adapter, fredAdapter("")], { MACRO_CACHE_DIR: dir, FRED_API_KEY: "" }); // restart
    const a = (await timed(get())).value;
    expect(dbn.calls.n).toBe(0);
    expect(a.body.results.served).toMatchObject({ disk: countOf("dbnomics"), fetched: 0, unrequested: countOf("fred") });
    expect(a.headers["x-bbterminal-cache"]).toBe("HIT");
    expect(servedLabel(a.body.results)).toBe("served from disk cache");
    const again = (await timed(get())).value;
    expect(servedLabel(again.body.results)).toBe("served from server cache");
    expect(upstream).toEqual([]);
  });

  it("labels every mix honestly", () => {
    const s = (o: Partial<NonNullable<MacroSnapshot["served"]>>) => ({ cacheState: "HIT" as const, served: { memory: 0, disk: 0, fetched: 0, stale: 0, refreshing: 0, pending: 0, failed: 0, unrequested: 0, ...o } });
    expect(servedLabel(s({ disk: 30 }))).toBe("served from disk cache");
    expect(servedLabel(s({ memory: 30 }))).toBe("served from server cache");
    expect(servedLabel(s({ memory: 20, disk: 10 }))).toBe("served from cache (10 from disk)");
    expect(servedLabel(s({ fetched: 30, failed: 2 }))).toBe("fetched from sources");
    expect(servedLabel(s({ disk: 19, fetched: 12, pending: 15 }))).toBe("partly from cache: 19 cached (19 from disk) · 12 fetched · 15 still loading");
    expect(servedLabel(s({ stale: 15, refreshing: 15, memory: 4 }))).toBe("partly from cache: 4 cached · 15 stale (refreshing)");
    expect(servedLabel(s({ fetched: 31, pending: 15 }))).toBe("from sources: 31 fetched · 15 still loading");
    expect(servedLabel({ cacheState: "MISS" })).toBe("server cache MISS"); // an older server without `served`
  });
});

describe("page self-refresh while something is pending", () => {
  it("polls every 10 s while pending, stops after 2 minutes, and restarts only once nothing is pending", () => {
    let t = 0;
    const poll = pendingPoller(() => t);
    const busy = { served: { memory: 0, disk: 0, fetched: 0, stale: 0, refreshing: 0, pending: 3, failed: 0, unrequested: 0 } };
    const idle = { served: { ...busy.served, pending: 0 } };
    expect(poll(undefined)).toBe(false);
    expect(poll(idle)).toBe(false);
    expect(poll(busy)).toBe(PENDING_POLL_MS);
    t = PENDING_POLL_MAX_MS - 1; expect(poll(busy)).toBe(PENDING_POLL_MS);
    t = PENDING_POLL_MAX_MS; expect(poll(busy)).toBe(false);
    t += 60_000; expect(poll(busy)).toBe(false); // still pending, still stopped
    expect(poll(idle)).toBe(false);
    expect(poll({ served: { ...idle.served, stale: 2, refreshing: 2 } })).toBe(PENDING_POLL_MS); // a new window
    expect(PENDING_POLL_MS).toBe(10_000);
    expect(PENDING_POLL_MAX_MS).toBe(120_000);
  });
});

describe("background refreshes of FRED go through the same budget, breaker and key refusal as every FRED call", () => {
  const KEY = "fred-test-key-0123456789abcdef";
  let refuse = false;
  const fredCalls = () => upstream.filter((u) => u.includes("api.stlouisfed.org"));
  beforeEach(() => {
    refuse = false;
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      upstream.push(url);
      if (!url.includes("api.stlouisfed.org")) return new Response("stubbed upstream", { status: 503 });
      if (refuse) return new Response("Too Many Requests", { status: 429 });
      return Response.json({ observations: [
        { date: "2025-09-01", value: "1.5", realtime_start: "2025-10-01", realtime_end: "9999-12-31" },
        { date: "2026-09-01", value: "2.5", realtime_start: "2026-10-01", realtime_end: "9999-12-31" },
      ] });
    });
  });
  /** Warms the disk with every overview FRED series, then moves past every TTL (3 days) so all copies are stale. */
  async function staleFredOnDisk() {
    const dir = tempDir();
    await timed(mount([fredAdapter(KEY)], { MACRO_CACHE_DIR: dir, FRED_API_KEY: KEY })());
    expect(fredCalls()).toHaveLength(countOf("fred"));
    vi.setSystemTime(Date.now() + 3 * DAY);
    resetFredPause();
    upstream.length = 0;
    return dir;
  }

  it("breaker open: stale copies are served and NO refresh is started (zero FRED calls); after the pause it refreshes again", async () => {
    const dir = await staleFredOnDisk();
    refuse = true;
    await fredGet(`series/observations?series_id=${SERIES.find((d) => d.adapter === "fred")!.code}`, KEY).catch(() => {}); // a 429 trips the breaker
    expect(fredCalls()).toHaveLength(1);
    refuse = false;
    upstream.length = 0;

    const get = mount([fredAdapter(KEY)], { MACRO_CACHE_DIR: dir, FRED_API_KEY: KEY }); // restart while the breaker is open
    const a = (await timed(get())).value;
    expect(byId(a, firstOf("fred"))).toMatchObject({ ok: true, staleCache: { refreshing: false } });
    expect(a.body.results.served).toMatchObject({ stale: countOf("fred"), refreshing: 0 });
    expect(a.body.results.warnings[0]).toMatch(/fred is unreachable \(FRED refused this terminal's requests \(HTTP 429 Too Many Requests\); FRED requests are paused/);
    expect(awaitingBackground(a.body.results)).toBe(false); // so the page does not poll for it
    for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync(10_000); await timed(get()); } // the page's retries
    expect(fredCalls()).toEqual([]);

    vi.setSystemTime(Date.now() + FRED_PAUSE_MS); // breaker closed again (and past the snapshot cache)
    const b = (await timed(get())).value;
    expect(byId(b, firstOf("fred")).staleCache?.refreshing).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fredCalls()).toHaveLength(countOf("fred"));
  });

  it("the background refresh waits for the shared per-minute budget: with the budget used up, it sends nothing until the window frees up", async () => {
    const dir = await staleFredOnDisk();
    for (let i = 0; i < FRED_BUDGET_PER_MIN; i++) await fredGet("series/observations?series_id=X", KEY); // e.g. detail views
    expect(fredCalls()).toHaveLength(FRED_BUDGET_PER_MIN);
    upstream.length = 0;

    const get = mount([fredAdapter(KEY)], { MACRO_CACHE_DIR: dir, FRED_API_KEY: KEY });
    const { ms, value: a } = await timed(get());
    expect(ms).toBeLessThanOrEqual(100); // the page is not held by the budget: stale copies are served
    expect(a.body.results.served).toMatchObject({ stale: countOf("fred"), refreshing: countOf("fred") });
    await vi.advanceTimersByTimeAsync(55_000);
    expect(fredCalls()).toEqual([]); // still inside the minute that the 100 calls used up
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fredCalls()).toHaveLength(countOf("fred"));
  });

  it("empty key: stale copies exist, the background refresh still makes zero FRED calls", async () => {
    const dir = await staleFredOnDisk();
    for (const key of ["", "   ", undefined]) {
      const get = mount([fredAdapter(key), stub("dbnomics", 0).adapter], { MACRO_CACHE_DIR: dir, FRED_API_KEY: key });
      const first = (await timed(get())).value;
      await vi.advanceTimersByTimeAsync(60_000);
      const after = (await timed(get())).value;
      expect(first.body.results.served!.stale).toBe(countOf("fred"));
      expect(byId(after, firstOf("fred"))).toMatchObject({ ok: false, errorKind: "key_missing" });
      expect(awaitingBackground(after.body.results)).toBe(false);
    }
    expect(fredCalls()).toEqual([]);
  });
});
