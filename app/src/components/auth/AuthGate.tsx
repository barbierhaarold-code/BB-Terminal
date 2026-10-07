import { lazy, Suspense, useEffect } from "react";
import { useAuth } from "@/store/authStore";
import { supabaseConfigured } from "@/lib/supabase";
import { LoginPage } from "./LoginPage";
import { SetPasswordPage } from "./SetPasswordPage";
import { AuthShell } from "./AuthShell";

// Lazy so the terminal's code (and everything it fetches/mounts) is not even
// loaded until there is a session. This gates the UI only — see the report.
const App = lazy(() => import("@/App"));

function Splash({ text }: { text: string }) {
  return (
    <AuthShell>
      <div className="text-term-muted text-[11px] uppercase tracking-[0.2em]">
        {text}<span className="caret" />
      </div>
    </AuthShell>
  );
}

export function AuthGate() {
  const status = useAuth((s) => s.status);
  const init = useAuth((s) => s.init);
  useEffect(() => { init(); }, [init]);

  if (!supabaseConfigured) {
    return (
      <AuthShell>
        <div role="alert" className="border border-term-redDim bg-term-panel p-4 text-term-red text-[12px] max-w-md">
          Authentication is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in app/.env and restart the dev server.
        </div>
      </AuthShell>
    );
  }
  if (status === "loading") return <Splash text="Checking session" />;
  if (status === "signedOut") return <LoginPage />;
  if (status === "setPassword") return <SetPasswordPage />;
  return (
    <Suspense fallback={<Splash text="Loading terminal" />}>
      <App />
    </Suspense>
  );
}
