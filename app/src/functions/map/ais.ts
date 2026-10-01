// Live AIS vessel positions via aisProxyPlugin (AISStream.io WebSocket, kept
// server-side). A community feed with no uptime guarantee — the client
// treats anything other than status "connected" as "feed unavailable" and
// never displays positions it wasn't just handed by a live feed.
import type L from "leaflet";

export type AisFeedStatus = "no_key" | "connecting" | "connected" | "stalled" | "error";

export interface Vessel { mmsi: number; name: string; lat: number; lon: number; sog: number; cog: number; heading: number | null; seen: number }

export interface AisResult {
  status: AisFeedStatus;
  error: string | null;
  vessels: Vessel[];
  tracked: number;
  truncated: boolean;
  lastMessageAt: number | null;
}

export const AIS_POLL_MS = 15_000;

/** Fetches vessels inside `bounds`. Unlike the other feeds, a non-live status is a normal (typed) result, not a thrown error, so the UI can show *why* it's unavailable. */
export async function fetchVessels(bounds: L.LatLngBounds | null): Promise<AisResult> {
  const q = bounds ? `?south=${bounds.getSouth()}&west=${bounds.getWest()}&north=${bounds.getNorth()}&east=${bounds.getEast()}` : "";
  const res = await fetch(`/ais-proxy/vessels${q}`);
  const body = await res.json().catch(() => null);
  if (!body || typeof body.status !== "string") throw new Error(`AIS feed failed: HTTP ${res.status}`);
  return {
    status: body.status,
    error: body.error ?? null,
    vessels: body.results ?? [],
    tracked: body.tracked ?? 0,
    truncated: !!body.truncated,
    lastMessageAt: body.lastMessageAt ?? null,
  };
}
