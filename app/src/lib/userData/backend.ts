// Which persistence backs the Track Record and Trade Plans stores.
//  - "local":  browser localStorage (the original behaviour, byte-identical).
//  - "server": per-user rows in Supabase under row-level security.
// A build-time, public flag (VITE_USER_DATA_BACKEND). Default is "local", so
// nothing changes until it is switched on, and setting it back is the rollback.

export type Backend = "local" | "server";

let override: Backend | null = null;

export function backendMode(): Backend {
  if (override) return override;
  return import.meta.env.VITE_USER_DATA_BACKEND === "server" ? "server" : "local";
}

/** Test seam only. */
export function setBackendForTests(m: Backend | null): void { override = m; }

export const isServerMode = (): boolean => backendMode() === "server";
