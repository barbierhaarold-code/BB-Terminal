# CLAUDE.md — Project Memory

Save this file at the root of the repo (merge with any existing `CLAUDE.md` from the
BB-Terminal template). Claude Code reads it automatically at the start of every
session in this repo, so these rules don't need to be repeated in every prompt.

## What this project is
A personal Bloomberg-style financial terminal, built on the BB-Terminal architecture:
OpenBB Platform (Python/FastAPI, port 6900) as the data layer, and a Vite + React +
TypeScript frontend (port 5173) as the UI. Owner: Harold Barbier, founder of Xena
Solution (AI & automation agency). Used for personal market monitoring, XAU/USD
scalping/day trading, and occasionally as a demo piece when showing prospects what
custom-built tools look like. It is not being resold or published as a commercial
clone of any existing product.

## Locked branding (finalized — do not deviate without being told explicitly)
- **App name:** ABDEL KHADER — used in the logo, the browser tab title, and the
  "Welcome to…" line. Do not revert to "BBTERMINAL" or introduce any other name.
- **Accent color:** violet `#b45cff` (plus its light/dark/subtle variants),
  replacing the old orange (`term-amber` token family and every raw `#ff8c00` /
  `rgba(255,140,0,…)` value). This applies everywhere the old orange showed up:
  chart crosshairs, sparklines, volume bars, the blinking cursor, text
  selection, panel glow. If you add any new component that needs an accent
  color, use the violet token — never introduce a new hex value ad hoc.
- **Font:** IBM Plex Mono (replaced JetBrains Mono). Verify it's actually
  loaded (not silently falling back to a system monospace font) before
  considering any typography-related task done.
- Internal identifiers (`bbterminal-workspace` local-storage key, the `name`
  field in `package.json`, and any other non-visible leftover references to
  "BB-Terminal"/"BBTERMINAL") should also be renamed to match, once that
  cleanup pass has been done.

## Non-negotiable rules
1. **Never change the color palette, typography, logo, or app name above.**
   Every new screen must be built using the existing violet/IBM Plex Mono
   design tokens already in `app/tailwind.config.js` — no new color systems
   introduced, no reverting to orange, no swapping the font back.
2. **QFI Terminal (qfiterminal.com) is a functional reference only.** It tells us
   *what data to show and how it's organized*, nothing more. Never copy its
   orange-and-black visual identity, its logo, or its marketing copy. If a prompt
   references "the QFI-style X screen," that means "a screen that shows the same
   category of information," not "recreate their exact pixels."
3. **This is a single-user personal tool.** No auth walls, no payment/subscription
   logic, no multi-tenant concerns. Keep it simple.
4. **Every new data panel needs three states, minimum:** loading, empty/no-data,
   and error — none of which crash the tab or leave a blank white screen.
5. **Check what's already free before reaching for a new provider.** Before
   wiring in a new external API, check what the installed OpenBB Platform already
   covers (`obb.coverage()` / the installed `openbb` package docs, or the vendored
   copy of the OpenBB repo if present at `OpenBB/`). A lot of "new" features are
   actually one endpoint away.
6. **Don't silently swallow a missing paid key.** If a feature genuinely needs a
   paid API key, build the UI against a typed interface (or mock data) first, add
   a `.env` placeholder for it (e.g. `FINNHUB_API_KEY=`), and say clearly in the
   summary what key is needed and roughly what it costs. Never fabricate data to
   fill a gap.
7. **Keep the function-code command system as the primary navigation model.**
   `[SYMBOL] CODE` in the command bar (e.g. `TSLA KEY`, `WEI`, `CC`) is how this
   terminal is meant to be driven. New modules get new codes and show up in
   `HELP` and autocomplete — they don't replace the command bar with tabs/menus.
8. **Definition of done for any phase:** the app builds with zero TypeScript
   errors, `./start.sh` runs cleanly, the new screen has been sanity-checked
   against its spec, and the summary lists any follow-up data-provider decisions
   that are still open.

## Tech stack recap
- Backend: OpenBB Platform (FastAPI + Uvicorn), port 6900, exposes `/api/v1/...`
- Frontend: Vite + React + TypeScript, port 5173, `/api` proxied to the backend
- Charts: TradingView `lightweight-charts`
- State: `app/src/store/workspaceStore.ts`
- Functions: one folder/file per function code in `app/src/functions/`
- Signals/rules engine (used by INTEL): `app/src/lib/signals.ts`
- Data helpers: `app/src/lib/api.ts`, `app/src/lib/functions.ts`, `app/src/lib/format.ts`

## Data provider strategy
Default to Yahoo Finance via OpenBB — it's free, already wired, needs no key, and
covers most of equities, indices, forex majors/crosses, and crypto. Reach for
something else only when Yahoo genuinely has no coverage (forex-specific news,
economic-calendar surprises, congressional trading disclosures, on-chain/whale
data, real-time options flow). When that happens, evaluate free/freemium options
first and present the choice — don't default to a paid tier without asking.

## How we're building this
The full feature list is split into numbered phase files (`01-forex-module.md`,
`02-dashboard-command-center.md`, etc. — see `00-ROADMAP.md`). One phase per
Claude Code session: implement, verify the build, sanity-check the screen,
commit on its own branch, merge, then move on. Don't try to implement more than
one phase file in the same session unless explicitly told to.
