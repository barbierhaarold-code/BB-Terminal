import { supabase } from "@/lib/supabase";
import { useAuth } from "@/store/authStore";

// ────────────────────────────────────────────────────────────
// Central place where the Supabase access token is attached to every call to
// the server-side proxies (/api and every /<name>-proxy/...). Installed once
// as a window.fetch wrapper, so none of the ~40 call sites change. Calls to
// anything else (Binance, Hyperliquid, CoinGecko, Supabase itself, ...) pass
// through untouched, and the token is never sent cross-origin.
//
// The server (vite-plugins/auth.ts) marks its own auth rejections with
// `x-proxy-auth: rejected`, which is how a real session failure is told apart
// from an upstream provider that happens to return 401.
// ────────────────────────────────────────────────────────────

const PROXY_PATH = /^\/(?:api(?:[/?#]|$)|[^/?#]+-proxy(?:[/?#]|$))/;
const REFRESH_MARGIN_MS = 15_000;

function isProxyUrl(raw: string): boolean {
  try {
    const u = new URL(raw, window.location.href);
    return u.origin === window.location.origin && PROXY_PATH.test(u.pathname + u.search);
  } catch { return false; }
}

async function currentToken(): Promise<string | null> {
  const s = useAuth.getState().session;
  // The store is updated on every TOKEN_REFRESHED event; only fall back to the
  // client (which refreshes an expired token) when the cached one is about to lapse.
  if (s && (s.expires_at ?? 0) * 1000 - Date.now() > REFRESH_MARGIN_MS) return s.access_token;
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

let refreshing: Promise<string | null> | null = null;
/** One shared refresh for any burst of simultaneous 401s. */
function refreshToken(): Promise<string | null> {
  if (!supabase) return Promise.resolve(null);
  refreshing ??= supabase.auth.refreshSession()
    .then(({ data }) => data.session?.access_token ?? null)
    .catch(() => null)
    .finally(() => { refreshing = null; });
  return refreshing;
}

function messageFor(code: string | undefined): string {
  if (code === "missing_token") return "You need to sign in to use the terminal.";
  if (code === "token_expired") return "Your session has expired. Please sign in again.";
  return "Your session is no longer valid. Please sign in again.";
}

function withToken(input: RequestInfo | URL, init: RequestInit | undefined, token: string): [RequestInfo | URL, RequestInit | undefined] {
  if (input instanceof Request) {
    const req = new Request(input, init);
    if (!req.headers.has("authorization")) req.headers.set("authorization", `Bearer ${token}`);
    return [req, undefined];
  }
  const headers = new Headers(init?.headers);
  if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
  return [input, { ...init, headers }];
}

export function installProxyAuth(): void {
  const w = window as unknown as { __proxyAuthInstalled?: boolean };
  if (w.__proxyAuthInstalled) return;
  w.__proxyAuthInstalled = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    if (!isProxyUrl(rawUrl)) return nativeFetch(input, init);

    const token = await currentToken();
    // Keep a pristine copy of a Request input: its body is consumed by the first send.
    const retryInput = input instanceof Request ? input.clone() : input;
    const [i1, o1] = token ? withToken(input, init, token) : [input, init];
    let res = await nativeFetch(i1, o1);

    if (res.status !== 401 || res.headers.get("x-proxy-auth") !== "rejected") return res;

    // The token may simply have expired between refreshes: refresh once and retry.
    const fresh = await refreshToken();
    if (fresh && fresh !== token) {
      const [i2, o2] = withToken(retryInput, init, fresh);
      res = await nativeFetch(i2, o2);
      if (res.status !== 401 || res.headers.get("x-proxy-auth") !== "rejected") return res;
    }

    // Still rejected: this session is dead. Back to the login page with a reason.
    const code = await res.clone().json().then((b: { code?: string }) => b?.code).catch(() => undefined);
    void useAuth.getState().expireSession(messageFor(code));
    return res;
  };
}
