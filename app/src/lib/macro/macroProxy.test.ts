import { afterEach, describe, expect, it, vi } from "vitest";
import connect from "connect";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { macroProxyPlugin } from "../../../vite-plugins/macro";
import { RateLimitedError, type MacroAdapter } from "../../../vite-plugins/macroAdapters";
import { SERIES } from "./config";
import type { AdapterSeries, SeriesDef } from "./types";

const okSeries = (id: string): AdapterSeries => ({
  id, ok: true, observations: [{ period: "2026-08", value: 1 }], provider: "P", sourceUrl: "x", refreshedAt: "2026-10-08T00:00:00.000Z", retrievedAt: "2026-10-09T00:00:00.000Z",
});

function fakeAdapter(behaviour: () => Promise<AdapterSeries[]> | AdapterSeries[] | never) {
  const calls = { n: 0 };
  const adapter: MacroAdapter = {
    id: "dbnomics",
    async fetchSeries(defs) { calls.n++; const r = await behaviour(); return r.length ? r : defs.map((d) => okSeries(d.id)); },
  };
  return { adapter, calls };
}

const servers: Server[] = [];
async function mount(mode: "dev" | "preview", simulate: boolean, adapter: MacroAdapter | MacroAdapter[], env: Record<string, string | undefined> = {}) {
  const app = connect();
  const plugin = macroProxyPlugin(simulate, Array.isArray(adapter) ? adapter : [adapter], env);
  const fake = { middlewares: app } as never;
  const hook = mode === "dev" ? plugin.configureServer : plugin.configurePreviewServer;
  (hook as (s: never) => void).call({} as never, fake);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    get: (p = "/macro-proxy/snapshot") => fetch(base + p).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => null) })),
    post: (p: string) => fetch(base + p, { method: "POST" }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) })),
  };
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  vi.unstubAllEnvs(); vi.restoreAllMocks();
});

describe("macro-proxy", () => {
  it("single-flights concurrent requests and then serves from cache", async () => {
    const { adapter, calls } = fakeAdapter(async () => { await new Promise((r) => setTimeout(r, 40)); return []; });
    const s = await mount("dev", false, adapter);
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => s.get()));
    expect(calls.n).toBe(1);
    expect(rs.every((r) => r.status === 200 && r.body.results.series.length === SERIES.length)).toBe(true);
    const again = await s.get();
    expect(calls.n).toBe(1);
    expect(again.headers.get("x-bbterminal-cache")).toBe("HIT");
  });

  it("passes the real upstream cause through as a 502", async () => {
    const { adapter } = fakeAdapter(() => { throw new Error("DBnomics answered HTTP 503 Service Unavailable: maintenance."); });
    const s = await mount("dev", false, adapter);
    const r = await s.get();
    expect(r.status).toBe(502);
    expect(r.body.warnings[0].message).toContain("HTTP 503 Service Unavailable");
  });

  it("serves older data marked STALE (with the cause) when a refresh fails", async () => {
    let fail = false;
    const { adapter } = fakeAdapter(() => { if (fail) throw new Error("DBnomics unreachable (ECONNRESET)."); return []; });
    const s = await mount("dev", true, adapter);
    expect((await s.get()).status).toBe(200);
    await s.post("/macro-proxy/_simulate?mode=outage"); fail = true;
    const r = await s.get();
    expect(r.status).toBe(200);
    expect(r.body.results.cacheState).toBe("STALE");
    expect(r.body.results.warnings[0]).toContain("Simulated outage");
  });

  it("honours an upstream 429: Retry-After, and no hammering during the cool-down", async () => {
    const { adapter, calls } = fakeAdapter(() => { throw new RateLimitedError("DBnomics answered HTTP 429 Too Many Requests.", 90_000); });
    const s = await mount("dev", false, adapter);
    const a = await s.get();
    expect(a.status).toBe(502);
    expect(a.headers.get("retry-after")).toBe("90");
    await s.get(); await s.get();
    expect(calls.n).toBe(1);
  });

  it("unknown route is a clear 404", async () => {
    const s = await mount("dev", false, fakeAdapter(() => []).adapter);
    const r = await s.get("/macro-proxy/nope");
    expect(r.status).toBe(404);
    expect(r.body.warnings[0].message).toMatch(/Unknown macro route/);
  });
});

describe("outage-simulation switch is dev-only", () => {
  const f = () => fakeAdapter(() => []).adapter;

  it("works on the dev server when requested: outage → real cause, off → recovers", async () => {
    const s = await mount("dev", true, f());
    expect((await s.post("/macro-proxy/_simulate?mode=outage&clear=1")).body.results).toEqual({ simulate: "outage", cacheCleared: true });
    const down = await s.get();
    expect(down.status).toBe(502);
    expect(down.body.warnings[0].message).toMatch(/Simulated outage/);
    await s.post("/macro-proxy/_simulate?mode=off");
    expect((await s.get()).status).toBe(200);
  });

  it("is refused (404) on the dev server when MACRO_ALLOW_SIMULATE was not set", async () => {
    const s = await mount("dev", false, f());
    expect((await s.post("/macro-proxy/_simulate?mode=outage")).status).toBe(404);
    expect((await s.get()).status).toBe(200);
  });

  it("is refused (404) when mounted the way the production gateway and `vite preview` mount it, even if requested", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await mount("preview", true, f());
    expect((await s.post("/macro-proxy/_simulate?mode=outage&clear=1")).status).toBe(404);
    expect((await s.get()).status).toBe(200); // and no outage was applied
  });

  it("is refused (404) on the dev-server hook when NODE_ENV=production, even if requested", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await mount("dev", true, f());
    expect((await s.post("/macro-proxy/_simulate?mode=outage")).status).toBe(404);
    expect((await s.get()).status).toBe(200);
  });

  it("rejects an invalid mode with 400", async () => {
    const s = await mount("dev", true, f());
    expect((await s.post("/macro-proxy/_simulate?mode=bogus")).status).toBe(400);
  });
});

// ───────────── several adapters behind one snapshot ─────────────

function namedAdapter(id: "dbnomics" | "bls", behaviour: (defs: SeriesDef[]) => Promise<AdapterSeries[]> | AdapterSeries[], cacheMs?: number) {
  const calls = { n: 0 };
  const adapter: MacroAdapter = { id, cacheMs, async fetchSeries(defs) { calls.n++; return behaviour(defs); } };
  return { adapter, calls };
}
const allOk = (defs: SeriesDef[]) => defs.map((d) => okSeries(d.id));
const SECRET = "k3y-secret-value-0123456789abcdef";

describe("macro-proxy with several adapters", () => {
  it("one failing provider does not take the page down: its series carry the real cause, the rest are served", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const dbn = namedAdapter("dbnomics", allOk);
    const bls = namedAdapter("bls", () => { throw new Error("BLS answered HTTP 500 Internal Server Error."); });
    const s = await mount("dev", false, [dbn.adapter, bls.adapter]);
    const r = await s.get();
    expect(r.status).toBe(200);
    const us = r.body.results.series.find((x: AdapterSeries) => x.id === "us.cpi");
    expect(us).toMatchObject({ ok: false });
    expect(us.error).toContain("HTTP 500");
    expect(r.body.results.series.filter((x: AdapterSeries) => x.ok).length).toBeGreaterThan(10);
    expect(r.body.results.warnings.some((w: string) => w.startsWith("us.cpi:"))).toBe(true);
  });

  it("a missing key flows through as an explicit per-series state with its kind (never a silent gap)", async () => {
    const dbn = namedAdapter("dbnomics", allOk);
    const bls = namedAdapter("bls", (defs) => defs.map((d): AdapterSeries => ({ ...okSeries(d.id), ok: false, observations: [], errorKind: "key_missing", error: "API key missing: BLS_API_KEY is not set." })));
    const s = await mount("dev", false, [dbn.adapter, bls.adapter]);
    const r = await s.get();
    expect(r.status).toBe(200);
    expect(r.body.results.series.find((x: AdapterSeries) => x.id === "us.unemp")).toMatchObject({ ok: false, errorKind: "key_missing" });
  });

  it("a key that an upstream error echoes back is scrubbed from the 502 the browser receives", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bls = namedAdapter("bls", () => { throw new Error(`The key:${SECRET} provided by the User is invalid.`); });
    const s = await mount("dev", false, bls.adapter, { BLS_API_KEY: SECRET });
    const r = await s.get();
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
    expect(r.body.warnings[0].message).toContain("[key]");
  });

  it("caches per adapter at its own pace: the snapshot is rebuilt after 10 min but a 12 h adapter is not asked again until 12 h", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-09T08:00:00Z"));
      const dbn = namedAdapter("dbnomics", allOk, 6 * 3_600_000);
      const bls = namedAdapter("bls", allOk, 12 * 3_600_000);
      const s = await mount("dev", false, [dbn.adapter, bls.adapter]);
      await s.get();
      expect([dbn.calls.n, bls.calls.n]).toEqual([1, 1]);
      vi.setSystemTime(new Date("2026-10-09T08:05:00Z"));
      expect((await s.get()).headers.get("x-bbterminal-cache")).toBe("HIT");
      vi.setSystemTime(new Date("2026-10-09T08:11:00Z"));
      const rebuilt = await s.get();
      expect([dbn.calls.n, bls.calls.n]).toEqual([1, 1]);
      expect(rebuilt.headers.get("x-bbterminal-cache")).toBe("HIT"); // rebuilt from adapter caches: nothing went upstream
      vi.setSystemTime(new Date("2026-10-09T14:30:00Z"));
      await s.get();
      expect([dbn.calls.n, bls.calls.n]).toEqual([2, 1]);
      vi.setSystemTime(new Date("2026-10-09T20:30:00Z"));
      await s.get();
      expect([dbn.calls.n, bls.calls.n]).toEqual([3, 2]);
    } finally { vi.useRealTimers(); }
  });

  it("serves one provider's older data marked STALE (with the cause) when only that provider fails on refresh", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.setSystemTime(new Date("2026-10-09T08:00:00Z"));
      let fail = false;
      const dbn = namedAdapter("dbnomics", allOk, 1000);
      const bls = namedAdapter("bls", (defs) => { if (fail) throw new Error("BLS unreachable (ECONNRESET)."); return allOk(defs); }, 1000);
      const s = await mount("dev", false, [dbn.adapter, bls.adapter]);
      expect((await s.get()).status).toBe(200);
      fail = true;
      vi.setSystemTime(new Date("2026-10-09T09:00:00Z"));
      const r = await s.get();
      expect(r.status).toBe(200);
      expect(r.body.results.cacheState).toBe("STALE");
      expect(r.body.results.warnings[0]).toMatch(/bls is unreachable \(BLS unreachable \(ECONNRESET\)\.\)/);
      expect(r.body.results.series.find((x: AdapterSeries) => x.id === "us.cpi").ok).toBe(true); // the older data, still there
    } finally { vi.useRealTimers(); }
  });

  it("a configured series whose adapter is not mounted is reported, not dropped", async () => {
    const s = await mount("dev", false, namedAdapter("dbnomics", allOk).adapter);
    const r = await s.get();
    expect(r.body.results.series).toHaveLength(SERIES.length);
    expect(r.body.results.series.find((x: AdapterSeries) => x.id === "us.cpi").error).toMatch(/No adapter "bls" is mounted/);
  });
});
