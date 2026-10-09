// Ties the per-user stores to the signed-in account (server mode only).
//  - on ANY change of the signed-in user (sign-out, sign-in, switch, expiry) every
//    store is emptied IN MEMORY first, synchronously, so the next account can
//    never see the previous account's data, not even for one render;
//  - then the new user's rows are loaded.
// In local mode this does nothing at all (the local stores must keep mirroring
// localStorage; resetting them would write an empty journal to disk).
import { useAuth } from "@/store/authStore";
import { backendMode } from "./backend";
import { broadcast } from "./registry";
import { currentUserId, getAdapter } from "./runtime";
import { resetSync, setOffline } from "./sync";

let current: string | null = null;
let epoch = 0;
let started = false;

function onUserChange(userId: string | null): void {
  if (backendMode() !== "server") return;
  if (userId === current) return;
  current = userId;
  epoch++;
  resetSync();
  broadcast((h) => h.reset());
  if (userId) void load(userId);
}

export async function load(userId: string): Promise<void> {
  const mine = epoch;
  broadcast((h) => h.loading(userId));
  try {
    const snap = await getAdapter().loadAll();
    if (mine !== epoch || currentUserId() !== userId) return; // user changed while loading: drop it
    broadcast((h) => h.loaded(userId, snap));
  } catch (e) {
    if (mine !== epoch) return;
    broadcast((h) => h.failed(userId, e instanceof Error ? e.message : String(e)));
  }
}

/** Re-read the account (Retry on the load error, manual Refresh, tab focus). */
export function refreshUserData(): void {
  const id = currentUserId();
  if (backendMode() === "server" && id) void load(id);
}

/** Idempotent. Called when the stores are created. */
export function startUserDataSession(): void {
  if (started) return;
  started = true;
  useAuth.subscribe((s, prev) => {
    const id = s.status === "signedIn" ? s.session?.user.id ?? null : null;
    const was = prev.status === "signedIn" ? prev.session?.user.id ?? null : null;
    if (id !== was) onUserChange(id);
  });
  if (typeof window !== "undefined") {
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    window.addEventListener("offline", () => setOffline(true));
    window.addEventListener("online", () => setOffline(false));
    window.addEventListener("focus", () => { if (backendMode() === "server") refreshOnFocus(); });
  }
  onUserChange(currentUserId());
}

let lastFocusRefresh = 0;
function refreshOnFocus(): void {
  if (Date.now() - lastFocusRefresh < 60_000) return;
  lastFocusRefresh = Date.now();
  // never refresh over unsaved optimistic changes
  import("./sync").then(({ useSync }) => { if (useSync.getState().pending === 0) refreshUserData(); });
}

/** Test seam only. */
export function resetSessionForTests(): void { current = null; epoch++; }
