import connect from "connect";
import sirv from "sirv";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import { proxyPlugins } from "../vite-plugins/registry";
import { isProtectedPath } from "../vite-plugins/auth";

// ────────────────────────────────────────────────────────────
// Production gateway. Serves the built frontend (dist/) and mounts the EXACT
// same proxy plugins as `vite dev`, from the same ordered list
// (vite-plugins/registry.ts), so the auth gate and per-feature allowlists run
// first and identically. Nothing here re-implements a proxy.
//
// Fail closed: refuses to start without Supabase config or without a built
// frontend; any /api or /*-proxy path no handler claimed gets a 404 (never the
// SPA index.html).
// ────────────────────────────────────────────────────────────

const env = process.env as Record<string, string | undefined>;
const port = Number(env.PORT ?? 8080);
const host = env.HOST ?? "0.0.0.0";
const distDir = path.resolve(env.DIST_DIR ?? "dist");

function die(msg: string): never {
  console.error(`[gateway] FATAL: ${msg}`);
  process.exit(1);
}

if (!env.VITE_SUPABASE_URL?.trim() || !env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()) {
  die("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set (auth cannot be verified without them). Refusing to start.");
}
if (!existsSync(path.join(distDir, "index.html"))) die(`no built frontend at ${distDir}/index.html. Refusing to start.`);

const app = connect();

// Baseline hardening headers on everything (Caddy adds HSTS on top).
app.use((_req: IncomingMessage, res: ServerResponse, next: () => void) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");
  next();
});

// Unauthenticated liveness probe for Docker/Caddy. Reveals nothing.
app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
  if (req.url === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain");
    res.setHeader("cache-control", "no-store");
    res.end("ok");
    return;
  }
  next();
});

// Same plugins, same order as vite.config.ts. Every one of them only registers
// middleware on `server.middlewares`, so that is all we provide.
const fakeServer = { middlewares: app } as never;
for (const plugin of proxyPlugins(env)) {
  const hook = plugin.configurePreviewServer;
  if (typeof hook !== "function") die(`proxy plugin "${plugin.name}" has no preview hook — it would be unprotected/unmounted.`);
  hook.call({} as never, fakeServer);
  console.log(`[gateway] mounted ${plugin.name}`);
}

// Any protected-looking path that reached this point was not handled (wrong
// method, unknown route): 404, never fall through to the SPA.
app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
  if (isProtectedPath(req.url ?? "")) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  next();
});

// Built frontend. Hashed assets are immutable; index.html is never cached so a
// new deploy is picked up immediately. Unknown paths fall back to the SPA.
app.use(sirv(distDir, {
  etag: true,
  single: true,
  dev: false,
  setHeaders(res, pathname) {
    res.setHeader("cache-control", pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  },
}));

const server = createServer(app);
server.requestTimeout = 120_000;
server.headersTimeout = 20_000;
server.listen(port, host, () => console.log(`[gateway] listening on ${host}:${port}, serving ${distDir}`));

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[gateway] ${sig}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
