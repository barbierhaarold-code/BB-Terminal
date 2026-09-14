// NGA World Port Index (Pub. 150) — the US National Geospatial-Intelligence
// Agency's public-domain, free, no-key global port directory (~2,950
// entries). Fetched via the server-side wpiProxyPlugin (vite.config.ts):
// msi.nga.mil's API returns 403 to any request carrying a browser Origin
// header (verified directly — same request without an Origin header
// succeeds), so it can't be called from the client and is proxied like the
// other no-CORS sources in this app (COT, Congress, Polymarket).
// https://msi.nga.mil/Publications/WPI

export type HarborSize = "L" | "M";

export const HARBOR_SIZE_LABEL: Record<HarborSize, string> = {
  L: "Major",
  M: "Major + Medium",
};

export interface Port {
  portNumber: number;
  name: string;
  country: string;
  lat: number;
  lon: number;
  harborSize: "Large" | "Medium" | "Small" | "Very Small" | "Unknown";
  firstPortOfEntry: boolean;
}

export async function fetchPorts(size: HarborSize): Promise<Port[]> {
  const res = await fetch(`/wpi-proxy/ports?size=${size}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.warnings?.[0]?.message ?? `World Port Index feed failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.results ?? [];
}
