import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import { supabase, authRedirect } from "@/lib/supabase";

export type AuthStatus = "loading" | "signedOut" | "setPassword" | "signedIn";

// Set when an invite/recovery link is opened; cleared once a password is saved.
// Survives a reload mid-flow so an invited user can't skip choosing a password.
const PENDING_KEY = "ak-auth-pending-password";
const readPending = () => { try { return localStorage.getItem(PENDING_KEY) === "1"; } catch { return false; } };
const writePending = (v: boolean) => {
  try { v ? localStorage.setItem(PENDING_KEY, "1") : localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
};

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  email: string | null;
  /** One-shot message shown on the login page (expired session, bad invite link). */
  notice: string | null;
  init: () => void;
  signOut: () => Promise<void>;
  /** The server rejected our token: end the local session and show `message` on the login page. */
  expireSession: (message: string) => Promise<void>;
  passwordSet: () => void;
}

let started = false;
let userSignedOut = false;

export const useAuth = create<AuthState>((set, get) => ({
  status: "loading",
  session: null,
  email: null,
  notice: authRedirect.error,

  init() {
    if (started) return;
    started = true;
    if (!supabase) { set({ status: "signedOut" }); return; }

    if (authRedirect.type) writePending(true);

    const apply = (session: Session | null, event?: string) => {
      if (session) {
        set({
          session,
          email: session.user.email ?? null,
          status: readPending() ? "setPassword" : "signedIn",
          notice: null,
        });
        return;
      }
      // No session. If we previously had one and the user didn't ask for this,
      // the session expired or was revoked.
      const wasIn = get().status === "signedIn" || get().status === "setPassword";
      set({
        session: null,
        email: null,
        status: "signedOut",
        notice: wasIn && !userSignedOut && event === "SIGNED_OUT"
          ? "Your session has expired. Please sign in again."
          : get().notice,
      });
      userSignedOut = false;
    };

    supabase.auth.onAuthStateChange((event, session) => {
      // Never call supabase methods synchronously in here (deadlock risk) — just update state.
      if (event === "PASSWORD_RECOVERY") writePending(true);
      apply(session, event);
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (error) set({ status: "signedOut", notice: "Your session could not be restored. Please sign in again." });
      else if (get().status === "loading") apply(data.session);
    });
  },

  async signOut() {
    userSignedOut = true;
    writePending(false);
    // local scope: end this browser's session only, not the user's other devices.
    await supabase?.auth.signOut({ scope: "local" });
    set({ session: null, email: null, status: "signedOut", notice: null });
  },

  async expireSession(message) {
    if (get().status === "signedOut") return; // several in-flight calls may report the same failure
    // State first, so the SIGNED_OUT event that follows keeps this message instead of the generic one.
    set({ session: null, email: null, status: "signedOut", notice: message });
    await supabase?.auth.signOut({ scope: "local" });
  },

  passwordSet() {
    writePending(false);
    set({ status: "signedIn" });
  },
}));
