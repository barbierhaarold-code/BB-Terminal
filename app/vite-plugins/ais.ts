// Live AIS vessel positions (MAP > Vessels layer) via AISStream.io's
// WebSocket. The API key stays server-side. Free, but community-run with no
// SLA, and its commercial-use terms are unconfirmed — so everything here is
// built around honest degradation: the endpoint reports the feed's real state
// (no_key / connecting / connected / stalled / error) and only ever returns
// positions that actually arrived on the socket. It never synthesises vessels.
// The socket is opened lazily on first request and closed after IDLE_MS
// without anyone polling, so an unused layer costs nothing.
// https://aisstream.io/documentation
import type { Plugin } from "vite";
import { middlewarePlugin, sendJson } from "./shared";

const DEFAULT_WS_URL = "wss://stream.aisstream.io/v0/stream";
const IDLE_MS = 5 * 60_000;
const STALE_VESSEL_MS = 15 * 60_000;
const STALLED_AFTER_MS = 2 * 60_000;
const MAX_VESSELS = 20_000;
const MAX_RETURNED = 4_000;

interface Vessel { mmsi: number; name: string; lat: number; lon: number; sog: number; cog: number; heading: number | null; seen: number }
type FeedState = "no_key" | "connecting" | "connected" | "stalled" | "error";

export function aisProxyPlugin(apiKey: string | undefined, wsUrl: string | undefined): Plugin {
  const url = wsUrl || DEFAULT_WS_URL;
  const vessels = new Map<number, Vessel>();
  let ws: WebSocket | null = null;
  let opened = false;
  let lastMessageAt = 0;
  let lastError: string | null = null;
  let lastRequestAt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = 2_000;

  function prune() {
    const cutoff = Date.now() - STALE_VESSEL_MS;
    for (const [k, v] of vessels) if (v.seen < cutoff) vessels.delete(k);
  }

  function connect() {
    if (!apiKey || ws) return;
    opened = false;
    lastError = null;
    let socket: WebSocket;
    try { socket = new WebSocket(url); }
    catch (e) { lastError = String((e as Error).message ?? e); scheduleReconnect(); return; }
    ws = socket;
    socket.onopen = () => {
      opened = true;
      socket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ["PositionReport"],
      }));
    };
    socket.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); } catch { return; }
      if (msg.error) { lastError = String(msg.error); return; }
      const pos = msg.Message?.PositionReport;
      const meta = msg.MetaData;
      if (!pos || !meta) return;
      const lat = Number(meta.latitude ?? pos.Latitude);
      const lon = Number(meta.longitude ?? pos.Longitude);
      // AIS uses 91/181 as "not available" sentinels.
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
      lastMessageAt = Date.now();
      lastError = null;
      backoff = 2_000;
      if (vessels.size >= MAX_VESSELS && !vessels.has(meta.MMSI)) prune();
      if (vessels.size >= MAX_VESSELS && !vessels.has(meta.MMSI)) return;
      vessels.set(meta.MMSI, {
        mmsi: meta.MMSI,
        name: String(meta.ShipName ?? "").trim(),
        lat, lon,
        sog: Number(pos.Sog) || 0,
        cog: Number(pos.Cog) || 0,
        heading: pos.TrueHeading != null && pos.TrueHeading < 360 ? Number(pos.TrueHeading) : null,
        seen: Date.now(),
      });
    };
    socket.onerror = () => { lastError ??= opened ? "AISStream socket error" : "Could not connect to AISStream"; };
    socket.onclose = (ev) => {
      ws = null;
      if (!lastError) lastError = ev.reason || `AISStream closed the connection (code ${ev.code})`;
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer || Date.now() - lastRequestAt > IDLE_MS) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, backoff);
    backoff = Math.min(backoff * 2, 60_000);
  }

  function closeIfIdle() {
    if (Date.now() - lastRequestAt > IDLE_MS && ws) {
      try { ws.close(); } catch { /* already closed */ }
      ws = null;
      vessels.clear();
    }
  }

  function state(): FeedState {
    if (!apiKey) return "no_key";
    if (ws && !opened) return "connecting";
    if (ws && opened && lastMessageAt && Date.now() - lastMessageAt < STALLED_AFTER_MS) return "connected";
    if (ws && opened) return lastMessageAt ? "stalled" : "connecting";
    return lastError ? "error" : "connecting";
  }

  setInterval(closeIfIdle, 60_000).unref();

  return middlewarePlugin("bbterminal-ais-proxy", async (req, res, next) => {
    if (!req.url?.startsWith("/ais-proxy/vessels") || req.method !== "GET") { next(); return; }
    lastRequestAt = Date.now();
    if (apiKey && !ws && !reconnectTimer) connect();

    const status = state();
    const base = {
      status,
      error: status === "no_key"
        ? "AISSTREAM_API_KEY not configured — add it to app/.env and restart the dev server."
        : status === "error" || status === "stalled" ? (lastError ?? "No AIS messages received recently.") : null,
      lastMessageAt: lastMessageAt || null,
      tracked: vessels.size,
    };
    // Only serve positions while the feed is demonstrably alive — never a frozen snapshot presented as live.
    if (status !== "connected") { sendJson(res, { ...base, results: [] }, status === "connecting" ? 200 : 503); return; }

    prune();
    const u = new URL(req.url, "http://internal");
    const raw = ["south", "west", "north", "east"].map((k) => u.searchParams.get(k));
    const [s, w, n, e] = raw.map(Number);
    const bbox = raw.every((v) => v != null && v !== "") && [s, w, n, e].every(Number.isFinite);
    const out: Vessel[] = [];
    for (const v of vessels.values()) {
      if (bbox && (v.lat < s || v.lat > n || (w <= e ? v.lon < w || v.lon > e : v.lon < w && v.lon > e))) continue;
      out.push(v);
      if (out.length >= MAX_RETURNED) break;
    }
    sendJson(res, { ...base, results: out, truncated: out.length >= MAX_RETURNED });
  });
}
