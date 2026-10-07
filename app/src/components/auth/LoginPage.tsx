import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/store/authStore";
import { AuthShell } from "./AuthShell";
import { describeAuthError } from "./authErrors";

type Phase = "idle" | "loading" | "error";

export function LoginPage() {
  const notice = useAuth((s) => s.notice);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (phase === "loading" || !supabase) return;
    setPhase("loading");
    setError(null);
    try {
      const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (err) { setError(describeAuthError(err)); setPhase("error"); }
      // On success onAuthStateChange swaps this page for the terminal.
    } catch (err) {
      setError(describeAuthError(err));
      setPhase("error");
    }
  }

  const loading = phase === "loading";
  const field = "w-full bg-term-bg2 border border-term-border px-3 py-2 text-term-heading text-[13px] placeholder:text-term-muted focus:border-term-amber disabled:opacity-50";

  return (
    <AuthShell>
      <form onSubmit={submit} className="panel w-full max-w-sm p-5 gap-4 shadow-panel" noValidate>
        <div className="sub-header">Sign in</div>

        {notice && phase !== "error" && (
          <div role="status" className="border border-term-amberDim bg-term-amberSubtle text-term-amberBright text-[12px] px-3 py-2">
            {notice}
          </div>
        )}
        {phase === "error" && error && (
          <div role="alert" className="border border-term-redDim text-term-red text-[12px] px-3 py-2">
            {error}
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="sub-header">Email</span>
          <input
            type="email" name="email" autoComplete="username" autoFocus required
            value={email} onChange={(e) => setEmail(e.target.value)}
            disabled={loading} spellCheck={false} placeholder="you@example.com" className={field}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="sub-header">Password</span>
          <input
            type="password" name="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)}
            disabled={loading} placeholder="••••••••" className={field}
          />
        </label>

        <button
          type="submit" disabled={loading || !email || !password}
          className="border border-term-amber bg-term-amberSubtle text-term-amber font-bold text-[12px] uppercase tracking-[0.25em] py-2.5 hover:bg-term-amber hover:text-term-bg transition-colors disabled:opacity-40 disabled:hover:bg-term-amberSubtle disabled:hover:text-term-amber"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <div className="text-term-muted text-[11px] leading-relaxed border-t border-term-borderSoft pt-3">
          Access is by invitation only.
        </div>
      </form>
    </AuthShell>
  );
}
