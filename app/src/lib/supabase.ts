import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Why the auth link in the URL (invite / recovery) matters, captured BEFORE the
 *  client consumes and clears the hash. */
export interface AuthRedirect {
  type: "invite" | "recovery" | null;
  error: string | null;
}

function readAuthRedirect(): AuthRedirect {
  const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  if (!hash) return { type: null, error: null };
  const p = new URLSearchParams(hash);
  const t = p.get("type");
  const errCode = p.get("error_code") ?? p.get("error");
  return {
    type: t === "invite" || t === "recovery" ? t : null,
    error: errCode
      ? errCode === "otp_expired"
        ? "This invitation link is invalid or has expired. Ask for a new invitation."
        : p.get("error_description")?.replace(/\+/g, " ") ?? "The link could not be used."
      : null,
  };
}

export const authRedirect: AuthRedirect = readAuthRedirect();

export const supabaseConfigured = Boolean(url && key);

// Publishable key only — never a service_role/secret key in the browser.
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
