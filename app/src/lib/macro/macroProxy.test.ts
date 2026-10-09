import { afterEach, describe, expect, it, vi } from "vitest";
import connect from "connect";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { macroProxyPlugin } from "../../../vite-plugins/macro";
import { RateLimitedError, type MacroAdapter } from "../../../vite-plugins/macroAdapters";
import { SERIES } from "./config";
import type { AdapterSeries } from "./types";

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
async function mount(mode: "dev" | "preview", simulate: boolean, adapter: MacroAdapter) {
  const app = connect();
  const plugin = macroProxyPlugin(simulate, [adapter]);
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
