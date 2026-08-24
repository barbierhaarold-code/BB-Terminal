import { ApiError } from "@/lib/api";

// ────── Tweets tab (GetXAPI) ──────
// GetXAPI is a paid, per-call X/Twitter data reseller (Bearer-token REST API,
// $0.001/call on the endpoint used here) — not the official X developer API.
// The key lives server-side only, in the Vite dev-server proxy (vite.config.ts,
// `getXApiProxyPlugin`), same pattern as the Twelve Data spot-metals proxy —
// never bundled to the client.

export interface Tweet {
  id: string;
  author: string;
  text: string;
  url: string;
  date: string;
}

export const fetchAccountTweets = async (handles: string[]): Promise<Tweet[]> => {
  if (handles.length === 0) return [];
  const res = await fetch(`/getx-proxy/user-tweets?userNames=${encodeURIComponent(handles.join(","))}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(body.results)) {
    throw new ApiError(res.status, body?.warnings?.[0]?.message ?? "Failed to load tweets");
  }
  return body.results as Tweet[];
};

/** Case-insensitive whole-word match against the configured keyword list. */
export function isHighImpact(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}
