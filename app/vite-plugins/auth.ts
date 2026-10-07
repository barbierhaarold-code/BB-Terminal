import { createHash, createPublicKey, verify as cryptoVerify, type JsonWebKey, type KeyObject } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";

// ────────────────────────────────────────────────────────────
// Shared auth gate for every server-side proxy route.
//
// One middleware, registered FIRST in vite.config.ts, so it runs before any
// proxy handler. It verifies the caller's Supabase access token WITHOUT any
// secret key:
//   1. Preferred: the project's public JWKS (<SUPABASE_URL>/auth/v1/.well-known/
//      jwks.json). The ES256/RS256 signature and the claims are checked locally,
//      so no network round-trip per request.
//   2. Fallback (project still on a shared-secret JWT, so the JWKS is empty):
//      GET <SUPABASE_URL>/auth/v1/user with the token + publishable key, cached
//      in memory for ~60 s.
// Fails CLOSED everywhere: no config, no keys, Supabase unreachable → deny.
//
// Protected = "/api" (OpenBB cache) and every "/<name>-proxy/..." route. Gating
// by that naming convention (not a hand-kept list) means a future proxy added
// as "/foo-proxy/..." is protected from its first commit.
//
// Per-feature allowlists (env, comma-separated emails) sit on top: a valid token
// whose email is not on the list gets 403 feature_locked. Empty/missing list →
// nobody is allowed, and the server log says so.
//
// Never logs tokens, emails, or upstream URLs.
// ────────────────────────────────────────────────────────────

export type Feature = "copilot" | "tweets" | "ais";

const FEATURE_ROUTES: Array<{ prefix: string; feature: Feature; envVar: string }> = [
  { prefix: "/copilot-proxy", feature: "copilot", envVar: "COPILOT_ALLOWED_EMAILS" },
  { prefix: "/getx-proxy", feature: "tweets", envVar: "TWEETS_ALLOWED_EMAILS" },
  { prefix: "/ais-proxy", feature: "ais", envVar: "AIS_ALLOWED_EMAILS" },
];

const MAX_TOKEN_CHARS = 4096;
const JWKS_TTL_MS = 10 * 60_000;
const JWKS_MIN_REFETCH_MS = 60_000;
const USER_CACHE_TTL_MS = 60_000;
const NEGATIVE_CACHE_TTL_MS = 10_000;
const CACHE_MAX_ENTRIES = 500;
const UPSTREAM_TIMEOUT_MS = 5_000;
const LOG_THROTTLE_MS = 60_000;

export interface AuthEnv {
  supabaseUrl?: string;
  publishableKey?: string;
  allowlists: Record<Feature, string[]>;
}

interface Verified { email: string | null }
type Failure = { ok: false; status: 401 | 503; code: string; message: string };
type Result = { ok: true; user: Verified } | Failure;

const fail401 = (code: string, message: string): Failure => ({ ok: false, status: 401, code, message });

/** Parses "a@x.com, B@y.com" into a normalized list. */
export function parseEmailList(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function authEnvFrom(env: Record<string, string | undefined>): AuthEnv {
  return {
    supabaseUrl: env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, "") || undefined,
    publishableKey: env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || undefined,
    allowlists: {
      copilot: parseEmailList(env.COPILOT_ALLOWED_EMAILS),
      tweets: parseEmailList(env.TWEETS_ALLOWED_EMAILS),
      ais: parseEmailList(env.AIS_ALLOWED_EMAILS),
    },
  };
}

/** True for any path the proxies serve (or would serve). Checked on the raw URL AND a normalized form, so encoding/case/slash tricks can't slip a proxy path past the gate. */
export function isProtectedPath(rawUrl: string): boolean {
  // startsWith("/api") deliberately mirrors apiCachePlugin's own check, so the gate is never narrower than the handler.
  const test = (p: string) => p.startsWith("/api") || /^\/[^/?#]+-proxy(?:[/?#]|$)/.test(p);
  const raw = rawUrl.split("#")[0];
  if (test(raw)) return true;
  let norm = raw.split("?")[0];
  try { norm = decodeURIComponent(norm); } catch { return true; /* undecodable path to a server we don't trust it on: deny */ }
  norm = "/" + norm.toLowerCase().split("/").filter(Boolean).join("/");
  return test(norm);
}

function featureFor(rawUrl: string): { feature: Feature; envVar: string } | null {
  let p = rawUrl.split("?")[0].split("#")[0];
  try { p = decodeURIComponent(p); } catch { /* handled by isProtectedPath */ }
  p = "/" + p.toLowerCase().split("/").filter(Boolean).join("/");
  for (const r of FEATURE_ROUTES) if (p === r.prefix || p.startsWith(r.prefix + "/")) return r;
  return null;
}

function b64urlToBuf(s: string): Buffer { return Buffer.from(s, "base64url"); }

function parseJson(buf: Buffer): Record<string, unknown> | null {
  try {
    const v = JSON.parse(buf.toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

export function createVerifier(cfg: AuthEnv, now: () => number = Date.now) {
  const issuer = cfg.supabaseUrl ? `${cfg.supabaseUrl}/auth/v1` : "";
  let keys = new Map<string, { key: KeyObject; alg: string }>();
  let keysFetchedAt = 0;
  let keysAttemptAt = 0;
  const userCache = new Map<string, { until: number; result: Result }>();

  async function refreshKeys(): Promise<void> {
    keysAttemptAt = now();
    try {
      const r = await fetch(`${issuer}/.well-known/jwks.json`, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
      if (!r.ok) return;
      const body = (await r.json()) as { keys?: Array<JsonWebKey & { kid?: string; alg?: string }> };
      const next = new Map<string, { key: KeyObject; alg: string }>();
      for (const jwk of body.keys ?? []) {
        if (!jwk.kid) continue;
        const alg = jwk.alg ?? (jwk.kty === "EC" ? "ES256" : jwk.kty === "RSA" ? "RS256" : "");
        // Only asymmetric public keys; a symmetric ("oct") entry must never be usable for verification.
        if (!(alg === "ES256" || alg === "RS256") || (jwk.kty !== "EC" && jwk.kty !== "RSA")) continue;
        try { next.set(jwk.kid, { key: createPublicKey({ key: jwk, format: "jwk" }), alg }); } catch { /* skip malformed key */ }
      }
      keys = next;
      keysFetchedAt = now();
    } catch { /* keep any stale keys; caller fails closed if there are none */ }
  }

  async function ensureKeys(kid?: string): Promise<void> {
    const stale = now() - keysFetchedAt > JWKS_TTL_MS;
    const unknownKid = kid !== undefined && !keys.has(kid);
    // An unknown kid triggers a refetch (key rotation) but never more than once a minute, so garbage tokens can't make us hammer Supabase.
    if ((stale || unknownKid || keys.size === 0) && now() - keysAttemptAt > (keys.size === 0 ? 5_000 : JWKS_MIN_REFETCH_MS)) await refreshKeys();
  }

  function verifyLocal(token: string): Result {
    const parts = token.split(".");
    if (parts.length !== 3) return fail401("invalid_token", "Malformed access token.");
    const header = parseJson(b64urlToBuf(parts[0]));
    const claims = parseJson(b64urlToBuf(parts[1]));
    if (!header || !claims) return fail401("invalid_token", "Malformed access token.");
    const entry = typeof header.kid === "string" ? keys.get(header.kid) : undefined;
    // alg is taken from OUR key, never trusted from the token header (no "none", no HS256 downgrade).
    if (!entry || header.alg !== entry.alg) return fail401("invalid_token", "Access token was not signed by this project.");
    let sigOk = false;
    try {
      sigOk = cryptoVerify(
        "sha256",
        Buffer.from(`${parts[0]}.${parts[1]}`),
        entry.alg === "ES256" ? { key: entry.key, dsaEncoding: "ieee-p1363" } : entry.key,
        b64urlToBuf(parts[2]),
      );
    } catch { sigOk = false; }
    if (!sigOk) return fail401("invalid_token", "Access token signature is invalid.");

    const nowSec = Math.floor(now() / 1000);
    if (typeof claims.exp !== "number" || claims.exp <= nowSec) return fail401("token_expired", "Access token has expired.");
    if (typeof claims.nbf === "number" && claims.nbf > nowSec + 5) return fail401("invalid_token", "Access token is not valid yet.");
    if (claims.iss !== issuer) return fail401("invalid_token", "Access token was issued by a different project.");
    const aud = claims.aud;
    if (!(aud === "authenticated" || (Array.isArray(aud) && aud.includes("authenticated")))) return fail401("invalid_token", "Access token has the wrong audience.");
    if (claims.role !== "authenticated" || typeof claims.sub !== "string" || !claims.sub) return fail401("invalid_token", "Access token is not a signed-in user session.");
    if (claims.is_anonymous === true) return fail401("invalid_token", "Anonymous sessions are not accepted.");
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;
    return { ok: true, user: { email } };
  }

  async function verifyViaUserEndpoint(token: string): Promise<Result> {
    const id = createHash("sha256").update(token).digest("hex");
    const hit = userCache.get(id);
    if (hit && hit.until > now()) return hit.result;
    let result: Result;
    try {
      const r = await fetch(`${issuer}/user`, {
        headers: { authorization: `Bearer ${token}`, apikey: cfg.publishableKey ?? "" },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (r.status === 401 || r.status === 403) result = fail401("invalid_token", "Access token is invalid or expired.");
      else if (!r.ok) return { ok: false, status: 503, code: "auth_unavailable", message: "Could not verify the session right now. Try again shortly." };
      else {
        const u = (await r.json()) as { email?: string; is_anonymous?: boolean };
        result = u.is_anonymous ? fail401("invalid_token", "Anonymous sessions are not accepted.")
          : { ok: true, user: { email: typeof u.email === "string" ? u.email.trim().toLowerCase() : null } };
      }
    } catch {
      return { ok: false, status: 503, code: "auth_unavailable", message: "Could not verify the session right now. Try again shortly." };
    }
    if (userCache.size >= CACHE_MAX_ENTRIES) userCache.clear();
    userCache.set(id, { until: now() + (result.ok ? USER_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS), result });
    return result;
  }

  return async function verifyToken(token: string): Promise<Result> {
    if (!cfg.supabaseUrl || !cfg.publishableKey) {
      return { ok: false, status: 503, code: "auth_not_configured", message: "Server auth is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY)." };
    }
    if (token.length > MAX_TOKEN_CHARS) return fail401("invalid_token", "Malformed access token.");
    let kid: string | undefined;
    try { const h = parseJson(b64urlToBuf(token.split(".")[0] ?? "")); if (typeof h?.kid === "string") kid = h.kid; } catch { /* handled below */ }
    await ensureKeys(kid);
    if (keys.size > 0) return verifyLocal(token);
    return verifyViaUserEndpoint(token);
  };
}

function bearerToken(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

function deny(res: ServerResponse, status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export function proxyAuthPlugin(rawEnv: Record<string, string | undefined>): Plugin {
  const cfg = authEnvFrom(rawEnv);
  const verifyToken = createVerifier(cfg);
  const lastLog = new Map<string, number>();
  const logThrottled = (key: string, msg: string) => {
    const t = Date.now();
    if (t - (lastLog.get(key) ?? 0) < LOG_THROTTLE_MS) return;
    lastLog.set(key, t);
    console.warn(`[proxy-auth] ${msg}`);
  };

  if (!cfg.supabaseUrl || !cfg.publishableKey) {
    console.warn("[proxy-auth] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing — EVERY proxy route will return 503 until they are set.");
  }
  for (const r of FEATURE_ROUTES) {
    if (cfg.allowlists[r.feature].length === 0) {
      console.warn(`[proxy-auth] ${r.envVar} is empty or not set — feature "${r.feature}" is LOCKED for everyone (deny-by-default).`);
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) {
    const url = req.url ?? "";
    if (!isProtectedPath(url)) { next(); return; }

    const token = bearerToken(req);
    if (!token) {
      deny(res, 401, { error: "unauthorized", code: "missing_token", message: "Sign in required: missing Authorization bearer token." }, { "www-authenticate": "Bearer", "x-proxy-auth": "rejected" });
      return;
    }
    const result = await verifyToken(token);
    if (!result.ok) {
      if (result.status === 503) {
        logThrottled(result.code, `${result.code}: ${result.message}`);
        deny(res, 503, { error: result.code, message: result.message });
        return;
      }
      deny(res, 401, { error: "unauthorized", code: result.code, message: result.message }, { "www-authenticate": `Bearer error="invalid_token"`, "x-proxy-auth": "rejected" });
      return;
    }

    const gate = featureFor(url);
    if (gate) {
      const list = cfg.allowlists[gate.feature];
      if (list.length === 0) {
        logThrottled(`empty:${gate.feature}`, `${gate.envVar} is empty or not set — denying feature "${gate.feature}" to everyone.`);
        deny(res, 403, { error: "feature_locked", feature: gate.feature });
        return;
      }
      if (!result.user.email || !list.includes(result.user.email)) {
        deny(res, 403, { error: "feature_locked", feature: gate.feature });
        return;
      }
    }
    next();
  }

  return {
    name: "bbterminal-proxy-auth",
    // Dev and preview servers both: the gate must be identical wherever the proxies run.
    configureServer(server: ViteDevServer) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}
