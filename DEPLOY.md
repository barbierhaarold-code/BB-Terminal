# Deploying ABDEL KHADER (small invite-only circle, one VPS)

Status: the stack (gateway + OpenBB + quant + Caddy) was built and run with Docker Desktop on a Mac (2026-10-09, plain HTTP on
localhost, see section 10). Build, health checks, the auth gate, network exposure and volume persistence all passed with no
Dockerfile changes. **Not yet verified:** a real HTTPS domain (Let's Encrypt), Supabase redirect URLs for a real domain, and more
than one concurrent user. Not hardened or load-tested for open internet.

## 1. What to buy, in order
1. **A domain name** (any registrar). You need one DNS name, e.g. `terminal.yourdomain.com`.
2. **One VPS at Hetzner**, Ubuntu 24.04, **at least 4 GB RAM** (OpenBB with all extensions is heavy; 8 GB is comfortable).
3. In the domain's DNS, add an **A record** (and AAAA if you want IPv6) for the chosen name pointing to the VPS IP. Wait until it resolves.
4. Nothing else. All other keys (Twelve Data, Anthropic, GetXAPI, FIRMS, AISStream, FMP) are optional and already yours.

## 2. Supabase settings (do these before inviting anyone)
In the Supabase dashboard, Authentication > URL Configuration:
- **Site URL**: `https://terminal.yourdomain.com`
- **Redirect URLs**: add `https://terminal.yourdomain.com/**` (keep `http://localhost:5173/**` for local dev).

Invitation emails build their link from the Site URL; if it is wrong, invitees land on localhost.
Also check Authentication > Sign In / Providers: **"Allow new users to sign up" must be OFF** (invite-only).
The built-in Supabase mailer is rate-limited (a few emails per hour); invite people one at a time.

## 3. First setup on the server
```bash
# as root on a fresh Ubuntu VPS
apt update && apt install -y ufw git
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
curl -fsSL https://get.docker.com | sh
git clone https://github.com/barbierhaarold-code/BB-Terminal.git && cd BB-Terminal
git checkout <the release tag or branch you want>
cp .env.production.example .env.production && chmod 600 .env.production
nano .env.production        # fill in DOMAIN, ACME_EMAIL, Supabase URL + publishable key, allowlists, keys
docker compose --env-file .env.production up -d --build
docker compose ps           # all services should become "healthy" (OpenBB can take a few minutes the first time)
```
Open `https://your-domain`. Caddy gets the HTTPS certificate automatically on first request.

## 4. Invite a friend
1. Supabase dashboard > Authentication > Users > **Invite user**, enter their email.
2. They click the link in the email and set a password.
3. For the paid/limited features, add their email to the matching list in `.env.production`
   (`COPILOT_ALLOWED_EMAILS`, `TWEETS_ALLOWED_EMAILS`, `AIS_ALLOWED_EMAILS`, comma-separated),
   then apply it: `docker compose --env-file .env.production up -d` (recreates the gateway only).
   Without that, they can use the terminal but see the "locked" screen on those three features.
Remember Copilot and Tweets cost you money per use.

## 5. Deploy an update / roll back
```bash
cd BB-Terminal
git fetch --all --tags
git tag -l | tail                           # note the currently running tag first
git checkout <new-tag>
docker compose --env-file .env.production up -d --build
docker compose ps && docker compose logs --tail 50 gateway
```
**Roll back:** `git checkout <previous-tag>` and run the same `up -d --build`. Tag every release
(`git tag release-YYYY-MM-DD`) so there is always a known-good point. Changing only
`.env.production` needs no rebuild, except the two `VITE_SUPABASE_*` values, which are baked
into the frontend and do need `--build`.

## 6. Back up
- **Users and passwords** live in Supabase (their backups/plan apply; check what your plan includes).
- **Each person's journal (TRACK), settings and workspace live in their own browser**, not on the server.
  Everyone should use TRACK > **Export JSON** regularly. Losing the server loses none of it.
- **`.env.production`**: keep a copy in your password manager. It is the only server-side secret store.
- Institutional Holdings cache volume (`hold-cache`, the SEC bulk data and its index) is re-creatable too: no backup needed.
- OpenBB cache volume (`openbb-data`) is re-creatable; the Caddy volume (`caddy-data`) holds the HTTPS
  certificate (re-issuable). Optional snapshot:
  `docker run --rm -v bb-terminal_openbb-data:/d -v "$PWD":/b alpine tar czf /b/openbb-data.tgz -C /d .`
  (volume names are prefixed by the folder name; check with `docker volume ls`).
- Turn on Hetzner's paid server backups/snapshots if you want a full-machine restore.

## 7. Useful commands
```bash
docker compose ps
docker compose logs -f gateway          # auth rejections, mounted proxies
docker compose restart openbb
docker compose down                     # stop everything (volumes kept)
```

## 8. Known risks (read before inviting people)
- **Yahoo Finance** (default data source via OpenBB) is unofficial and its terms restrict redistribution; it can rate-limit or break without notice.
- **Twelve Data** free tier is for personal use; check its licence before sharing spot XAU/USD with others.
- **AISStream** is community-run with unconfirmed commercial-use terms and no SLA.
- **GetXAPI** and **Anthropic** are pay-per-use: every allowed friend's use is billed to you.
- No rate limiting per user at the gateway yet; a signed-in user can still burn your paid quotas on features they are allowed.
- No CSP header is set (the app loads map tiles and embeds from several external hosts).

## 9. Institutional Holdings (HOLD): first build, disk, and config (Docker parts UNTESTED)
- Set `SEC_CONTACT_EMAIL` in `.env.production` (the SEC requires a declared contact in the User-Agent; it is sent only to sec.gov).
  Without it the HOLD page says "SEC contact email missing" and makes no request. `BLS_API_KEY` and `FRED_API_KEY` are optional (see the example file).
- The first HOLD build downloads the SEC's two latest Form 13F bulk data sets and takes about **104 s**, then maps tickers through OpenFIGI
  at its keyless rate (about 25 requests a minute) for about **8 minutes**. During that time HOLD works and shows a progress note; positions
  without a confirmed ticker show issuer name and CUSIP. After that the index is rebuilt at most once a day from the cached files.
- **Disk:** the cache measured about **195 MB** on the development machine (two data-set zips of about 96 MB and 95 MB, a 4 MB index and a 0.2 MB ticker map).
  Allow about 300 MB for the `hold-cache` volume (a new quarterly data set replaces the oldest zip).
- The gateway root filesystem is read-only, so the cache lives in the named volume `hold-cache` mounted at `/srv/.hold-cache`
  (declared in `docker-compose.yml`; the directory is created and chowned to `node` in `docker/gateway/Dockerfile`).
- No other new proxy writes to disk: the Policy Feed (`/policy-proxy`) and Vol & Currency Strength (which reuses the existing `/api` proxy) keep everything in memory.
- These Docker changes (compose volume, Dockerfile chown, extra environment variables) were tested locally on 2026-10-09: the volume is writable,
  the first build took about 70 s to a usable index (zips 100 MB + 99 MB, index 4 MB, `hold-cache` volume about 204 MB), and the cache survived `docker compose down` then `up -d`.
  After deploying, still check `docker compose logs gateway` for `[holdings-proxy]` errors and open HOLD once.

## 10. Local Docker test results (2026-10-09, macOS, Docker Desktop 29, 10 CPUs / 7.7 GB given to Docker)
- Test the stack on your own machine over plain HTTP: set `DOMAIN=http://localhost` in `.env.production` (Caddy then serves HTTP only, no certificate);
  any `ACME_EMAIL` value works. Ports 80 and 443 must be free. Then `docker compose --env-file .env.production up -d --build`.
- Cold build: about 2 minutes. Images: openbb 1.3 GB, quant 704 MB, gateway 237 MB, caddy 89 MB (about 2.3 GB). Allow about 6 GB of disk for images, build cache and volumes.
- All four containers healthy within about 20 s. Only caddy publishes ports (80, 443). Every `/api` and `/*-proxy/*` route answers 401 without a token.
- The Copilot guard allows at most 20 tools per request (`maxTools` in `app/vite-plugins/copilotGuard.ts`); it was 12 while the client sends 14, which made every Copilot question fail with "14 tools; the limit is 12".
- Measured RAM (one signed-in user): idle about 1.0 GB in total (openbb about 0.55 GB, quant about 0.25 GB, gateway about 0.15 GB, caddy about 0.04 GB); peak about 1.45 GB during the first HOLD build.
- Each person's journal (TRACK), plans and settings are stored per browser origin: a new URL starts empty. Use TRACK > Export JSON / Import JSON to move them.
- OpenBB also keeps a small yfinance timezone cache in `/home/openbb/.cache` (not a volume; re-created automatically).
