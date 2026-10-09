import { afterEach, describe, expect, it, vi } from "vitest";
import connect from "connect";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { policyProxyPlugin, USER_AGENT, type FeedFetcher } from "../../../vite-plugins/policy";
import type { FeedDef } from "./types";

const feed = (id: string, host: string, extra: Partial<FeedDef> = {}): FeedDef => ({ id, institution: `Inst ${id}`, institutionType: "central bank", currency: "USD", contentType: "press release", label: id, url: `https://${host}/${id}.xml`, cacheMs: 15 * 60_000, ...extra });
const rss = (...titles: string[]) => `<rss><channel>${titles.map((t, i) => `<item><title>${t}</title><link>https://x.test/${t.replace(/\W/g, "")}</link><pubDate>Fri, 09 Oct 2026 1${i}:00:00 GMT</pubDate></item>`).join("")}</channel></rss>`;
const ok = (body: string) => ({ status: 200, statusText: "OK", headers: { get: () => null }, text: async () => body });
const bad = (status: number, statusText = "", body = "<html>nope</html>", headers: Record<string, string> = {}) => ({ status, statusText, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null }, text: async () => body });

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r)))); vi.restoreAllMocks(); });

async function mount(feeds: FeedDef[], fetcher: FeedFetcher, clock: { t: number }, sleeps: number[] = []) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const plugin = policyProxyPlugin({ feeds, fetcher, now: () => clock.t, sleep: async (ms) => { sleeps.push(ms); clock.t += ms; } });
  const app = connect();
  (plugin.configureServer as (s: never) => void).call({} as never, { middlewares: app } as never);
  const srv = createServer(app);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  servers.push(srv);
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { get: (p = "/policy-proxy/feed") => fetch(base + p).then(async (r) => ({ s: r.status, h: r.headers, j: (await r.json()) as any })) };
}

describe("policy-proxy", () => {
  it("merges feeds newest-first, reports per-feed health, and sends the honest User-Agent without personal data", async () => {
    const seen: Array<{ url: string; ua: string }> = [];
    const clock = { t: Date.parse("2026-10-09T12:00:00Z") };
    const s = await mount([feed("a", "a.test"), feed("b", "b.test")], async (url, init) => { seen.push({ url, ua: init.headers["user-agent"] }); return ok(url.includes("/a.") ? rss("Alpha one", "Alpha two") : rss("Beta one")); }, clock);
    const r = await s.get();
    expect(r.s).toBe(200);
    expect(r.j.results.items.map((i: { title: string }) => i.title)).toEqual(["Alpha two", "Alpha one", "Beta one"]);
    expect(r.j.results.feeds.map((f: { id: string; ok: boolean; items: number }) => [f.id, f.ok, f.items])).toEqual([["a", true, 2], ["b", true, 1]]);
    expect(seen.every((x) => x.ua === USER_AGENT)).toBe(true);
    expect(USER_AGENT).not.toMatch(/@|\.com|key/i);
  });

  it("single-flights concurrent callers and serves the cache until the feed's own window ends", async () => {
    let n = 0;
    const clock = { t: Date.parse("2026-10-09T12:00:00Z") };
    const s = await mount([feed("a", "a.test")], async () => { n++; await new Promise((r) => setTimeout(r, 30)); return ok(rss("One")); }, clock);
    await Promise.all([1, 2, 3, 4].map(() => s.get()));
    expect(n).toBe(1);
    const again = await s.get();
    expect(n).toBe(1);
    expect(again.h.get("x-bbterminal-cache")).toBe("HIT");
    clock.t += 14 * 60_000; await s.get(); expect(n).toBe(1);
    clock.t += 2 * 60_000; await s.get(); expect(n).toBe(2);
  });

  it("one broken feed does not break the others: its health says why (403, challenge page, not a feed, network)", async () => {
    const clock = { t: Date.parse("2026-10-09T12:00:00Z") };
    const feeds = [feed("good", "g.test"), feed("f403", "h1.test"), feed("chal", "h2.test"), feed("html", "h3.test"), feed("net", "h4.test")];
    const s = await mount(feeds, async (url) => {
      if (url.includes("good")) return ok(rss("Fine"));
      if (url.includes("f403")) return bad(403, "Forbidden");
      if (url.includes("chal")) return bad(403, "", "<html><title>Just a moment...</title></html>");
      if (url.includes("html")) return ok("<html><body>Welcome</body></html>");
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    }, clock);
    const r = await s.get();
    expect(r.s).toBe(200);
    const by = Object.fromEntries(r.j.results.feeds.map((f: { id: string }) => [f.id, f]));
    expect(by.good.ok).toBe(true);
    expect(by.f403.error).toMatch(/HTTP 403 Forbidden \(the site refuses automated readers; not worked around\)/);
    expect(by.chal.error).toMatch(/bot challenge, which this terminal does not bypass/);
    expect(by.html.error).toMatch(/not an RSS\/Atom feed/);
    expect(by.net.error).toMatch(/ENOTFOUND/);
    expect(r.j.results.items.map((i: { title: string }) => i.title)).toEqual(["Fine"]);
  });

  it("if every feed fails the answer is a 502 with the real causes; a failed feed is not retried before 5 minutes", async () => {
    let n = 0;
    const clock = { t: Date.parse("2026-10-09T12:00:00Z") };
    const s = await mount([feed("a", "a.test")], async () => { n++; return bad(503, "Service Unavailable"); }, clock);
    const r = await s.get();
    expect(r.s).toBe(502);
    expect(r.j.warnings[0].message).toMatch(/HTTP 503 Service Unavailable/);
    await s.get(); await s.get();
    expect(n).toBe(1);
    clock.t += 5 * 60_000; await s.get();
    expect(n).toBe(2);
  });

  it("keeps serving a feed's older items, marked stale with the cause, when a later refresh fails", async () => {
    let fail = false;
    const clock = { t: Date.parse("2026-10-09T12:00:00Z") };
    const s = await mount([feed("a", "a.test"), feed("b", "b.test")], async (url) => (url.includes("/a.") && fail ? bad(500, "Server Error") : ok(rss(url.includes("/a.") ? "Old A" : "B"))), clock);
    await s.get();
    fail = true; clock.t += 16 * 60_000;
    const r = await s.get();
    const a = r.j.results.feeds.find((f: { id: string }) => f.id === "a");
    expect(a).toMatchObject({ ok: false, stale: true, items: 1 });
    expect(a.error).toMatch(/HTTP 500/);
    expect(r.j.results.items.map((i: { title: string }) => i.title).sort()).toEqual(["B", "Old A"]);
  });

  it("honours Retry-After on HTTP 429 and spaces same-host requests at least a second apart", async () => {
    const clock = { t: Date.parse("2026-10-09T12:00:00Z") };
    const sleeps: number[] = [];
    let n = 0;
    const s = await mount([feed("a", "same.test"), feed("b", "same.test"), feed("c", "other.test")], async (url) => { n++; return url.includes("/a.") ? bad(429, "Too Many Requests", "slow", { "retry-after": "1200" }) : ok(rss("X" + n)); }, clock, sleeps);
    const r = await s.get();
    expect(sleeps.some((ms) => ms >= 900)).toBe(true);              // b waited behind a on the same host
    expect(r.j.results.feeds.find((f: { id: string }) => f.id === "a").error).toMatch(/429/);
    const before = n;
    clock.t += 10 * 60_000; await s.get();
    expect(n).toBe(before);                                         // a's Retry-After (20 min) not yet over; b and c cached
    clock.t += 11 * 60_000; await s.get();
    expect(n).toBeGreaterThan(before);
  });

  it("unknown route is a clear 404", async () => {
    const s = await mount([feed("a", "a.test")], async () => ok(rss("One")), { t: Date.now() });
    const r = await s.get("/policy-proxy/nope");
    expect(r.s).toBe(404);
    expect(r.j.warnings[0].message).toMatch(/Unknown policy route/);
  });
});
