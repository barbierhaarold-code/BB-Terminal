import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/store/authStore";
import { AuthShell } from "./AuthShell";
import { describeAuthError } from "./authErrors";

const MIN_LEN = 8;

export function SetPasswordPage() {
  const email = useAuth((s) => s.email);
  const passwordSet = useAuth((s) => s.passwordSet);
  const signOut = useAuth((s) => s.signOut);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (loading || !supabase) return;
    if (pw.length < MIN_LEN) { setError(`Password must be at least ${MIN_LEN} characters.`); return; }
    if (pw !== pw2) { setError("Passwords do not match."); return; }
    setLoading(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pw });
      if (err) { setError(describeAuthError(err)); setLoading(false); return; }
      passwordSet();
    } catch (err) {
      setError(describeAuthError(err));
      setLoading(false);
    }
  }

  const field = "w-full bg-term-bg2 border border-term-border px-3 py-2 text-term-heading text-[13px] placeholder:text-term-muted focus:border-term-amber disabled:opacity-50";

  return (
    <AuthShell>
      <form onSubmit={submit} className="panel w-full max-w-sm p-5 gap-4 shadow-panel" noValidate>
        <div className="sub-header">Set your password</div>
        {email && <div className="text-term-text text-[12px]">Welcome, <span className="text-term-amberBright">{email}</span>. Choose a password to finish setting up your access.</div>}

        {error && (
          <div role="alert" className="border border-term-redDim text-term-red text-[12px] px-3 py-2">{error}</div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="sub-header">New password</span>
          <input type="password" autoComplete="new-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)}
            disabled={loading} placeholder={`At least ${MIN_LEN} characters`} className={field} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="sub-header">Confirm password</span>
          <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)}
            disabled={loading} className={field} />
        </label>

        <button type="submit" disabled={loading || !pw || !pw2}
          className="border border-term-amber bg-term-amberSubtle text-term-amber font-bold text-[12px] uppercase tracking-[0.25em] py-2.5 hover:bg-term-amber hover:text-term-bg transition-colors disabled:opacity-40 disabled:hover:bg-term-amberSubtle disabled:hover:text-term-amber">
          {loading ? "Saving…" : "Save password and enter"}
        </button>
        <button type="button" onClick={() => void signOut()} disabled={loading}
          className="text-term-muted text-[11px] uppercase tracking-[0.18em] hover:text-term-amberBright disabled:opacity-40">
          Cancel
        </button>
      </form>
    </AuthShell>
  );
}
