import { supabase } from "@/lib/supabase";
import { useAuth } from "@/store/authStore";
import type { UserDataAdapter } from "./adapter";
import { createSupabaseAdapter } from "./supabaseAdapter";

let override: UserDataAdapter | null = null;
let real: UserDataAdapter | null = null;

export function getAdapter(): UserDataAdapter {
  if (override) return override;
  if (!supabase) throw new Error("Supabase is not configured: cannot reach your saved journal.");
  return (real ??= createSupabaseAdapter(supabase));
}

/** Test seam only. */
export function setAdapterForTests(a: UserDataAdapter | null): void { override = a; }

/** The signed-in user's id, or null (signed out, loading, or still choosing a password). */
export function currentUserId(): string | null {
  const s = useAuth.getState();
  return s.status === "signedIn" ? s.session?.user.id ?? null : null;
}
