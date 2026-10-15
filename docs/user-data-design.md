# Per-user server storage for Track Record and Trade Plans — design

Status: **Phase 2 implemented on `feature/user-data-foundation`; migration applied to Supabase by the owner and validated live (see "Live validation" below); merged into `main` with `VITE_USER_DATA_BACKEND` defaulting to `local` (server mode is opt-in).** Section 0.5 records the approved decisions and what differs from the Phase 1 text below; where they conflict, section 0.5 wins.
Branch: `feature/user-data-foundation` (local). Companion files:
`supabase/migrations/20261009000000_user_data_foundation.sql` (not applied) and
`supabase/tests/rls_isolation.sql` (not run).

## 0. Principles (from the brief, enforced by the design)

1. The real local Track Record (`bbterminal-journal`, `bbterminal-trade-plans`) is **never written, migrated in place or cleared** by this work. It is only ever *read*, by one explicit user action.
2. Local data is **never auto-attached** to whichever account signs in. Server-mode stores never persist to `localStorage`.
3. No `service_role` key anywhere. The client uses the publishable key plus the signed-in user's JWT (supabase-js already does this for auth, `app/src/lib/supabase.ts`).
4. No new dependency: `@supabase/supabase-js` (already in `app/package.json`) speaks to PostgREST.

## 0.5 Approved decisions and as-built differences

| # | Decision | As built |
|---|---|---|
| 1 | `setups` table | added |
| 2 | timestamps as verbatim text | `entry_at/exit_at/created_at/updated_at` are `text` |
| 3 | new accounts have **no** base capital | `user_settings.base_capital` is nullable, no default; no row until set. Stores hold `baseCapital: null`; `computeStats(trades, null)` sets `hasCapital=false`; Track Record shows **n/a** (return, Calmar, drawdown %, avg win/loss %, risk/deposit load) with a visible reason; plan "planned risk USD" shows n/a; Copilot returns `null` + a note, never `0`. Backup files may carry `"baseCapital": null` (still rejects ≤ 0). |
| 4 | `pricesHidden` per device | not in the DB (column removed from the migration). In server mode it lives in its own key `bbterminal-prices-hidden`; in local mode it stays in the journal blob exactly as before. |
| 5 | sign-out reset | `lib/userData/session.ts`: any change of the signed-in user (sign-out, sign-in, switch, expiry) empties both stores **synchronously** first, drops queued writes and any in-flight load, then loads the new user. Tests record every state both stores ever take. In **local** mode nothing is reset (resetting would write an empty journal to localStorage); local mode keeps its pre-existing "device data" semantics. |
| 6 | Replace disabled for server accounts | `applyImport(…, "replace")` throws; the Replace button is hidden; `applyReplace`/`applyMerge` (the `setState` paths) throw in server mode so they cannot "succeed" without persisting. |
| 7 | validated on throwaway Postgres | see "Validation" below |
| 8 | Portfolio out of scope | Portfolio screen now states that positions are stored in this browser only. |

Other deviations from the Phase 1 text: there is **no `localAdapter`**: local mode is the unchanged `persist` path (the stores branch on the backend flag), which is the only way to guarantee byte-identical local storage. Server mode adds `lib/userData/sync.ts` (ordered write queue; one failure rolls back that write and everything queued after it, then shows the banner with Retry). The "Import my local journal" button copies the local base capital to the account only if the user ticks the box and the account has none; Backup → Merge offers the same checkbox and otherwise never touches settings.

**Production flag.** The backend is chosen by the build-time variable `VITE_USER_DATA_BACKEND` (`local` default, `server`). `docker/gateway/Dockerfile` only forwards `VITE_SUPABASE_*` build args, so enabling `server` in the production image needs one added `ARG`/`ENV` line there (and the compose pass-through). Added at wrap-up (default still `local`): `ARG`/`ENV VITE_USER_DATA_BACKEND` in `docker/gateway/Dockerfile`, the build arg in `docker-compose.yml`, the variable in `.env.production.example`, and the procedure in `DEPLOY.md`.

### Validation (throwaway Docker Postgres 15 + PostgREST; never Supabase)
Validated: the migration runs on an empty database and re-runs cleanly (idempotent); RLS isolation (select/insert/update/delete/cannot reassign `user_id`, same app id for two users, anon has no privilege) both in SQL (`supabase/tests/rls_isolation.sql`, `schema_checks.sql`) and **over HTTP through PostgREST with real JWTs** using the actual `supabaseAdapter` (`supabaseAdapter.integration.test.ts`: idempotent import of a 67-trade fixture, canonical-hash round trip, 0-row updates are errors, a second user cannot read/modify, 2 500-row pagination); a negative control (RLS disabled) makes the isolation test fail. Not validated (Supabase-specific): the real `auth.users`/`auth.uid()` implementation (stubbed from `request.jwt.claims`), GoTrue-issued JWTs and refresh, Supabase's default grants/`supabase_admin` ownership, the Supabase API gateway/Kong and its PostgREST version and config (`db-max-rows` etc.), SQL-editor transaction behaviour, and project-level settings (disable_signup, redirect URLs). Hence the live two-account test in the report.

### Live validation (Supabase, run by the owner)
Recorded at wrap-up; reported by the owner, not re-run by Claude (Claude never connected to Supabase).
- **SQL isolation test, live:** `supabase/tests/run_all.sql` in the Supabase SQL editor, two accounts → **SUMMARY PASS, "40 checks, 40 passed, 0 failed"** (the owner saw the result grid). This covers the migration self-check, the 8 RLS isolation checks, the schema checks for the fresh account and the "nothing kept" cleanup checks.
- **Two-account app test:** done by the owner. The test rows it left in the outlook test account were deleted by the owner in the SQL editor; test user B is deleted by the owner (no account was created or deleted by Claude).
- `run_all.sql` now carries a loud header: it issues update/delete statements on account A's trades as B (expected 0 rows under RLS), so it must **only ever be run with two empty throwaway accounts**, never with accounts holding real data.

Honest limits of this validation:
- The **offline** behaviour (read-only banner, writes refused while offline) was checked by **simulation** only, not by a real network loss against Supabase.
- Sign-in switching was tested in one direction only: the **gmail → outlook** direction (signed in as the gmail account, then switching to the outlook account) was **not** tested. The reset-on-user-change logic is symmetric and unit-tested, but that direction has no live evidence.
- Everything listed as "Not validated (Supabase-specific)" above is now covered only to the extent the 40 SQL checks and the two-account test exercise it; token refresh and long sessions were not specifically tested.

## 1. Inventory — everything that reads or writes the journal / plans

### Stores (the only persistence)
| File | Role |
|---|---|
| `app/src/store/journalStore.ts` | Zustand `persist`, key `bbterminal-journal` (no `version`). State: `trades`, `setups`, `baseCapital` (default 43 000), `pricesHidden`. Actions: `addTrade`, `updateTrade`, `deleteTrade`, `bulkAddTrades`, `addSetup`, `renameSetup`, `deleteSetup` (also clears `setupId` on trades), `assignSetup`, `setBaseCapital`, `togglePricesHidden`. ids = `crypto.randomUUID()` (fallback is a non-UUID string), `createdAt` = ISO. |
| `app/src/store/tradePlanStore.ts` | Zustand `persist`, key `bbterminal-trade-plans`, `version` = `PLAN_SCHEMA_VERSION` (1), custom `safeStorage` (corrupt value kept under `.corrupt`), `loadError` + `reload` + `discardUnreadable`. Actions: `addPlan`, `updatePlan`, `deletePlan`. |
| `app/src/store/tradeDraftStore.ts` | In-memory only scratch buffer (Copilot → form). Not persisted, never written to the journal. **Unchanged.** |
| `app/src/store/portfolioStore.ts` | Separate localStorage store (open positions). **Out of scope** (see open question 12). |

### Types / pure logic
`app/src/lib/journal.ts` (`Trade`, `Setup`, `NewTrade`, `computeStats`, MT4 paste parser), `app/src/lib/tradePlan.ts` (`TradePlan`, `ContextSnapshot`, `validatePlan`, `parsePlansBlob`, `mergePlans`, `computeRealizedR`, `adherenceStats`, `PLAN_SCHEMA_VERSION`).

### Backup export/import (formatVersion 2)
`app/src/lib/journalBackup.ts`: `buildBackup`/`downloadBackup` read both stores via `getState()`; `parseBackup` validates; `applyReplace` and `applyMerge` write with `useJournal.setState` / `useTradePlans.setState` directly (bypass the actions). UI: `app/src/components/journal/BackupPanel.tsx`. Test: `app/src/lib/journalBackup.plans.test.ts`.

### UI consumers
- `app/src/functions/TRACK.tsx` (trades, setups) → `components/journal/{TradeForm, TradeTable, BulkImport, SetupsManager, StatsPanel, JournalSettings, BackupPanel}.tsx`
  - `TradeForm` → `addTrade`, `addSetup`; consumes the Copilot draft from `tradeDraftStore`
  - `TradeTable` → `deleteTrade`, `assignSetup`, `updateTrade`
  - `BulkImport` → `bulkAddTrades`
  - `SetupsManager` → `addSetup`/`renameSetup`/`deleteSetup`
  - `JournalSettings` → `setBaseCapital`, `togglePricesHidden`
  - `StatsPanel` → reads `baseCapital`, `pricesHidden`
- `app/src/functions/PLAN.tsx` → `addPlan` (then an immediate `updatePlan(created.id, { context })`, line ~193), `updatePlan`, `deletePlan`; reads trades/setups/baseCapital/pricesHidden.
- Market Context / COT do **not** read the journal. They only produce the frozen `context` snapshot that PLAN stores inside a plan. No other module reads either store (grep of `src/` is exhaustive for the store hooks).

### Copilot
`app/src/lib/copilotTools.ts`: `get_track_record_stats` (`useJournal.getState()`, line ~278), `get_trade_plans` (`useTradePlans.getState()` + `useJournal.getState()`, line ~313), `prefill_track_record_entry` (writes only `tradeDraftStore`, then navigates to TRACK; the form's own "Log Trade" is the only save path). `app/src/lib/copilotConfig.ts` is prompt text only. Tools execute **in the browser** on in-memory store state, so "the signed-in user's data" reduces to "what the store currently holds" (see §6).

### Auth / infrastructure facts relevant to the design
- Auth: `app/src/lib/supabase.ts`, `app/src/store/authStore.ts` (`status`, `session`, `expireSession`), gate `components/auth/AuthGate.tsx` (App is lazy-loaded only once signed in).
- The browser already calls Supabase directly for auth. `docker/caddy/Caddyfile` sets no CSP (DEPLOY.md line 87 says so on purpose), so PostgREST calls to the Supabase project need **no Caddy/gateway change**. The gateway verifies the JWT only for proxied `/api` routes and is not on this path.
- No `supabase/` or `docs/` directory existed before this work.

## 2. Data model

Exact SQL: `supabase/migrations/20261009000000_user_data_foundation.sql`. Summary:

| Table | Key | Columns (app field → column) |
|---|---|---|
| `trades` | PK `(user_id, id)` | `id`, `symbol`, `direction`, `size`, `entryPrice→entry_price`, `exitPrice→exit_price`, `result`, `entryAt→entry_at`, `exitAt→exit_at`, `setupId→setup_id`, `macroBias`, `conviction`, `newsEvent`, `feeling`, `notes`, `source`, `createdAt→created_at`; plus `seq` (insertion order), `extra jsonb`, `schema_version`, `row_created_at`, `row_updated_at` |
| `trade_plans` | PK `(user_id, id)` | `id`, `title`, `symbol`, `direction`, `thesisMacro`, `thesisTechnical`, `setupId`, `timeframe`, `entryLow/High`, `stop`, `targets` (jsonb array), `riskPct`, `catalysts`, `conviction`, `status`, `createdAt`, `updatedAt`, `context` (jsonb, opaque), `review.tradeId→review_trade_id`, `review.followed→review_followed`, `review.lesson→review_lesson`; plus `seq`, `extra`, `schema_version` (= `PLAN_SCHEMA_VERSION`), `row_*` |
| `setups` | PK `(user_id, id)` | `id`, `name`, `schema_version`, `row_*` |
| `user_settings` | PK `user_id` | `base_capital` (nullable), `schema_version`, `row_*` (`pricesHidden` is device-local) |

Decisions and why:
- **`setups` is a fourth table** (not in your list). Trades and plans reference `setupId`; without it a server journal loses its tags. Alternative: a jsonb column in `user_settings`. A table keeps rename/delete simple. Open question 3.
- **PK `(user_id, id)`, `id` is `text`.** Local ids can be non-UUID (fallback generator, ids from imported files). A composite key also means two users importing the same backup file never collide. `user_id uuid not null default auth.uid()` references `auth.users` with `on delete cascade`.
- **Timestamps that the app generates or imports are stored as `text`, verbatim.** `entryAt` from the MT4 paste is a *naive* local string (`2026-08-14T17:01:56`, no zone); converting to `timestamptz` would invent a timezone and break byte-identical round trips. Server-side bookkeeping lives in `row_created_at` / `row_updated_at` (`timestamptz`). Cost: no server-side date arithmetic; not needed, stats run in the client.
- **`numeric` for money and prices**: PostgREST returns a JSON number and JS parses it back to the same double, so `4390.64` and `0` (several real trades have entry/exit 0) survive exactly.
- **Soft references, no FK**, for `setup_id` and `review_trade_id`, mirroring the local model (a plan may outlive/precede its trade; `deleteSetup` today leaves plans' `setupId` dangling). Also keeps imports order-independent.
- **`extra jsonb`** keeps unknown fields (`validateTrade`/`validatePlan` already preserve them) so a future app version's fields are not lost.
- CHECK constraints only for enums and not-null (`direction`, `source`, `status`, `followed`, `base_capital > 0`). I deliberately did **not** add range checks on prices/size so no real historical trade can be rejected.
- `seq bigint generated always as identity` gives a stable default order; `bulkAddTrades` and imports insert in array order. The UI sorts by `entryAt` anyway.
- `user_settings` has no row until the first change; the app uses defaults (open question 4 about the default 43 000).

### Row-level security
Per table, four policies for role `authenticated`: select/delete `using (user_id = (select auth.uid()))`, insert `with check (...)`, update `using` + `with check` (cannot hand a row to someone else). `anon` and `public` are revoked entirely. `FORCE ROW LEVEL SECURITY` is on, so even an owner-run function added later cannot silently bypass it. No `service_role` use anywhere. Verification: §8.

## 3. How the app reads and writes

### 3.1 Storage adapter layer
New folder `app/src/lib/userData/` (no UI):

```ts
interface UserDataAdapter {
  loadAll(): Promise<{ trades: Trade[]; setups: Setup[]; plans: TradePlan[]; settings: {baseCapital:number; pricesHidden:boolean} | null }>;
  insertTrades(ts: Trade[]): Promise<void>;           // plain insert (new ids)
  updateTrade(id: string, patch: Partial<Trade>): Promise<void>;
  deleteTrade(id: string): Promise<void>;
  assignSetup(ids: string[], setupId?: string): Promise<void>;   // one UPDATE ... WHERE id IN (...)
  upsertSetup / deleteSetup(id)                        // deleteSetup = UPDATE trades SET setup_id = null WHERE setup_id = id, then DELETE setup
  insertPlan / updatePlan / deletePlan
  saveSettings(patch): Promise<void>;                  // upsert on user_id
  importMissing(backup): Promise<ImportReport>;        // idempotent, see §4
}
```
- `mapping.ts`: pure `tradeToRow / rowToTrade / planToRow / rowToPlan` with a canonical key order and `undefined ⇄ null` conversion, unknown fields ⇄ `extra`. This is the unit-tested core.
- `supabaseAdapter.ts` (supabase-js `from(...)`; reads paginated with `.range()` in 1 000-row pages because PostgREST caps responses) and `localAdapter.ts` (today's behaviour).
- Backend selected by a **build-time public flag** `VITE_USER_DATA_BACKEND=local|server` (default `local`, so merging the code changes nothing until switched). Not a secret.

### 3.2 Store behaviour
`useJournal` and `useTradePlans` keep their public hook shape and action names, so none of the ~10 UI consumers above or the Copilot tools need to know the backend. Additions to state: `status: "idle"|"loading"|"ready"|"error"`, `ownerId`, `loadError`, `saveError`, `pendingWrites`.

**Server mode, hard rules**
- Persistence of these stores to `localStorage` is replaced by a **no-op storage** (`getItem → null`, `setItem/removeItem → nothing`). Server data can therefore never overwrite `bbterminal-journal` / `bbterminal-trade-plans`. A unit test asserts the raw localStorage strings are byte-identical after a full server-mode session (mock adapter).
- On `session.user.id` change (sign-in, sign-out, user switch, `expireSession`): the stores are **reset to empty synchronously first**, then `loadAll()` runs for the new user. Selectors expose data only when `ownerId === current user id`. So account B can never render a frame of account A's data, and nothing of A's is kept on disk.
- Load: the 4 queries run in parallel; `status="loading"` shows the skeleton; `ready` with zero rows shows the empty state; any failure shows `error` with the real message and a Retry. This is the project's 3-state rule, plus an explicit "not signed in" case that never shows data.

**Writes (optimistic, never silent)**
1. Apply the change in memory immediately (UI stays snappy; ids/`createdAt`/`updatedAt` are generated on the client exactly as today, so they are preserved).
2. Send it through the adapter. Writes are serialized per entity id (`addPlan` followed by `updatePlan(created.id, {context})` in `PLAN.tsx` becomes insert-then-update in order).
3. On failure: **roll back** that change in memory, set `saveError` (message + the failed operation), and show a persistent banner on TRACK/PLAN with **Retry** and **Dismiss**. Nothing is dropped without being shown.
4. `pendingWrites > 0` shows "Saving…"; a successful flush shows nothing noisy.
- 401/JWT-expired responses go through `authStore.expireSession(...)` like the existing proxy-auth handling.
- Cross-device freshness: refetch on tab focus and on a manual Refresh; no realtime in v1 (last write wins per row; conflicts are rare for a single-user journal; open question 9).

**Offline.** v1 is **read-only offline**: the in-memory data already loaded stays visible, a banner says "Offline — changes are not saved", and write controls are disabled rather than queuing. Reason: a persisted offline queue/cache is exactly the kind of local data that could leak between accounts or conflict across devices. A per-user IndexedDB cache/queue is a possible later step, not part of this. If the network drops mid-save, the optimistic change is rolled back and shown as an error (rule 3).

**Backup panel in server mode**
- **Export JSON**: unchanged format (v2) built from the loaded account data.
- **Import JSON → Merge**: same dedupe as today (`id` or fill signature) then `importMissing` (§4). Same code path as the local-journal import.
- **Import JSON → Replace is disabled for server accounts in v1.** Replace on the server means deleting every row and re-inserting without a transaction (PostgREST), which opens a data-loss window on the highest-risk data. (Open question 6.)

## 4. Migrating existing local data (explicit, user-triggered)

**Where the data comes from.** A function `readLegacyLocal()` reads the two raw `localStorage` strings, `JSON.parse`s them and validates with the existing `validateTrade`/`parsePlansBlob`; it does **not** use the live stores and never calls `setItem/removeItem`. If a value is unreadable, the dialog says so and offers nothing destructive.

**When the button shows.** "Import my local journal into this account" appears on TRACK (next to Export/Import) only if: backend is `server`, the user is signed in, the server load is `ready`, and legacy local data exists (≥1 trade, plan or setup). Never anywhere else, never automatic, never on sign-in.

**Preview before anything is written** (all computed from the local data with existing `computeStats`):
- trade count, **net P&L**, date range (min/max `entryAt`), setups count, plans count, local base capital and privacy flag;
- a diff against what the account already holds: "N new trades, M already in this account (skipped)";
- the account email it will go into, and the warning: *"This data lives in this browser and is not tied to any account. Import it only if it is yours."*

**Confirmation.** A checkbox ("This is my data and belongs to <email>") plus a button. Optional first step "Download local backup (JSON)" (built from the raw local data in the v2 format) so a file exists before anything is sent.

**Execution (idempotent).**
1. Fetch existing ids + signatures from the account.
2. Drop incoming trades whose `id` already exists **or** whose fill signature matches (same rule as `applyMerge`); plans by `id`; setups by `id`/name with the same remap as `applyMerge`.
3. Insert in this order, each as **one** PostgREST request (a request is one DB transaction): setups → trades → plans → settings. Trades/plans use `upsert(..., { onConflict: "user_id,id", ignoreDuplicates: true })`, so even a race or a retry after a network error cannot duplicate a row: the primary key refuses it.
4. `user_settings`: inserted only if the account has none; an existing server value is never overwritten (the report says which it kept).
5. **Verify**: re-read the account, recompute count and net P&L, and display "Imported: 67 trades, net 30 340.71 USD, matches the local preview ✔" or a loud mismatch error.
- Running it twice: second preview says "0 new, 67 already in this account" and writes nothing.
- A failure mid-way leaves a consistent prefix (each step is atomic and re-runnable); the report says which step failed; re-running completes it.

**Local data afterwards.** Untouched, byte for byte. The only new write is a separate marker key `bbterminal-local-import-v1` = `{ userIdShort, at, trades, plans }` used to show "Already imported into <account> on <date>; re-running is safe". No clear/hide/delete of local data is offered in v1.

**Two accounts, one browser.** Account B signing in sees only B's server data (§3.2). If B opens the import dialog it sees the same legacy local data with the warning and, if a marker exists, "Already imported into another account on this browser". Import is still B's explicit choice; it is not blocked because the browser cannot know who owns the data (open question 5).

**The hosted domain (empty localStorage).** `localStorage` is per origin, so the new domain starts empty and the button never appears. Path for you: on `localhost:5173` (local data intact) use **Export JSON** (formatVersion 2, includes plans) → on the hosted domain sign in → **Import JSON → Merge**. Same idempotent `importMissing`. Alternatively run the local import on localhost against the same Supabase project (dev build with the `server` flag) and the data is already in your account when you open the hosted site. Either way you compare count / net P&L / hash per §8.

## 5. What changes in the code, concretely (for Phase 2, not done)

- `journalStore.ts` / `tradePlanStore.ts`: actions route through the adapter; `persist` kept for `local` mode exactly as today (same keys, same shape, same `safeStorage`); no-op storage in `server` mode.
- `journalBackup.ts`: `buildBackup` unchanged; `applyMerge` delegates to the adapter in server mode; `applyReplace` throws a clear error in server mode; both keep their current behaviour in local mode.
- New: `lib/userData/*`, `lib/legacyLocal.ts`, `components/journal/ImportLocalDialog.tsx`, a small `SaveStatusBanner`.
- `copilotTools.ts`: see §6. `copilotConfig.ts`: no change.

## 6. Copilot tools

The tools run in the browser against the store, so they read only what is loaded for the signed-in user (RLS guarantees the server only returned that user's rows; the store reset on user change guarantees nothing stale). Changes:
- `get_track_record_stats` / `get_trade_plans`: if `status !== "ready"` or `ownerId !== current user`, return `{ available: false, reason: "Journal is still loading / could not be loaded: …" }` instead of today's "No trades logged yet", so Copilot never reports a load failure as an empty journal.
- No new write tool. `prefill_track_record_entry` stays UI-only; saving still requires the user clicking "Log Trade", which now goes through the optimistic adapter path.
- Journal contents are already sent to the model as tool results today; that does not change (worth knowing once the journal is multi-user: each user's own data only goes in their own session).

## 7. Test plan

**Unit (vitest, existing setup, no network)**
1. `mapping.test.ts`: `rowToTrade(tradeToRow(t))` deep-equals `t` for: full trade, minimal trade, price 0, `exitAt` absent, empty-string optional fields, unknown extra field; same for plans incl. `context`, `review`, `targets: []`, naive and `Z` timestamps. Canonical-key-order output.
2. `importMissing.test.ts` with an in-memory fake adapter that enforces the PK: import the real-shaped fixture twice → 2nd run adds 0; import after one partial failure → completes without duplicates; signature-duplicate with a different id is skipped; settings not overwritten when present.
3. `storeServerMode.test.ts`: raw `localStorage` strings byte-identical before/after load/add/update/delete; user switch A→B shows no A rows at any point (subscribe and record every state); failed save rolls back and sets `saveError`; `loading/empty/error` states.
4. Existing `journalBackup.plans.test.ts` must still pass untouched (local mode).
5. `copilotTools` tests: not-ready/other-owner → `available:false`.

**RLS isolation (run with you present)**
- A. SQL: `supabase/tests/rls_isolation.sql` in the SQL editor (two existing user ids, runs in a rolled-back transaction, PASS/FAIL notices).
- B. End to end, two real accounts that **you** create/sign in (I will not create or handle accounts or passwords): in two separate browser profiles log in as A and B; A adds a trade and a plan; B must see 0 rows and an empty state; with B's session in devtools run `supabase.from('trades').select()` → `[]`, an update/delete on A's id → 0 rows, insert with A's `user_id` → error; sign out/in as B in A's profile → no A data; check the Network tab of both profiles shows only the user JWT and the publishable key (no service key).

**Before/after evidence for your real data (checklist)**
1. Before touching anything (on the pre-feature build): record in the localhost browser: 67 trades, net P&L 30 340.71 USD, base capital 43 000, `pricesHidden` true, and SHA-256 of the **raw** `localStorage` values of both keys (so we can prove they never change).
2. Export JSON → file F0. Canonical hash `H0` = SHA-256 of `JSON.stringify` of `data` with keys sorted and trades/plans sorted by id (the header's `exportedAt` always differs, so it is excluded).
3. Build the feature branch, run in `local` mode: repeat step 1; hashes **identical** (proves no regression).
4. `server` mode, signed in as you: preview shows 67 / 30 340.71 / date range; import; verification line shows the same; export again → F1; canonical hash `H1` must equal `H0`; run the import a second time → 0 new.
5. Re-check step 1 raw localStorage hashes: **identical to step 1**.
6. Clear the browser cache on a fresh profile, sign in: the 67 trades are still there; open on the hosted domain via Export/Import Merge → same `H1`.

## 8. Risks and rollback

| Risk | Mitigation |
|---|---|
| Server data written into the local persist key and overwriting the real journal | No-op storage in server mode + a test asserting byte-identical raw localStorage |
| Account B sees A's local data | Server-mode stores never read localStorage; legacy data reachable only through the explicit dialog; reset-then-load on user change |
| Duplicate trades on re-import/retry | PK `(user_id,id)` + `ignoreDuplicates` + signature dedupe |
| Silent save failure | Rollback + persistent banner with Retry |
| Reading a failed load as an empty journal (Copilot, stats) | `status/ownerId` gating, tools return `available:false` |
| PostgREST 1 000-row cap truncating reads | Paginated `loadAll` + a test with 2 500 rows |
| Float/key-order/timestamp drift breaks round-trip | text timestamps, canonical mapping, hash test |
| Replace wiping server data | Disabled in v1 |
| RLS mistake | Migration + SQL test + two-account test; FORCE RLS; anon revoked |
| Dev build pointed at the production project writes test rows | Use throwaway test accounts you create; rows are only the test account's |
| Supabase unavailable | Banner + read-only; you can still Export from memory; rollback below |

**Rollback to localStorage-only**
1. Set `VITE_USER_DATA_BACKEND=local` and rebuild (or revert the merge). The app then behaves exactly as today with the untouched local data; the server tables are simply unused.
2. Data safety: before any server-mode use keep F0 (export) and the raw-localStorage hashes.
3. Dropping the server side, only if you want it gone (run by you; destroys server data): `drop table public.trade_plans, public.trades, public.setups, public.user_settings; drop function public.touch_row_updated_at();`

## 9. Proposed commits (each small, buildable, tests green)

1. `docs: user-data design + migration SQL + RLS test script` (this phase; SQL applied by you, separately).
2. `feat(userData): pure row mapping + canonical hash helper + tests` (no behaviour change).
3. `feat(userData): adapter interface, local adapter (current behaviour), fake in-memory adapter + tests`.
4. `feat(userData): supabase adapter (paginated reads, upsert/ignoreDuplicates) behind VITE_USER_DATA_BACKEND, default local`.
5. `refactor(stores): route journal/plan actions through the adapter; server-mode no-op storage, status/ownerId/saveError; local mode byte-identical` + store tests.
6. `feat(ui): loading/empty/error states + save-error banner + offline read-only banner (TRACK, PLAN)`.
7. `feat(backup): server-mode Merge via importMissing, Replace disabled`.
8. `feat(migration): readLegacyLocal + "Import my local journal into this account" dialog (preview, confirm, verify, marker key)`.
9. `feat(copilot): not-ready/other-owner guards in get_track_record_stats / get_trade_plans` + tests.
10. `docs: DEPLOY.md (flag, migration order, rollback)`.

I would stop for your review after commits 3, 5 and 8, and the two-account RLS test happens before 8 is used on real data.

## 10. Open questions (no answers assumed)

1. **Setups table**: OK to add `setups` as a fourth table (vs. a jsonb blob in `user_settings`)?
2. **Timestamps as verbatim `text`** (my recommendation, for byte-exact round trips and because `entryAt` is timezone-naive) vs. proper `timestamptz` (better SQL, but converts values and changes hashes)?
3. **Default base capital** for other invited users: keep 43 000, or start others at a neutral value / force them to set it at first use?
4. **`pricesHidden`**: per account (as designed) or per device (a display preference you may want different on a shared screen)?
5. **Local data and a second account in the same browser**: is "explicit choice + warning + marker" enough, or do you want the import limited to one account per browser, or an extra typed confirmation?
6. **Replace import** for server accounts: disable in v1 (my proposal), or implement with a typed confirmation + forced pre-export + an RPC for an atomic replace?
7. **Feature flag**: build-time `VITE_USER_DATA_BACKEND` (simple, needs a rebuild to roll back) or also a runtime switch inside the app?
8. **Which Supabase project / environment** do I test against? Dev and prod share one project today; do you want a separate test project, or should tests use throwaway accounts you create in the existing one?
9. **Concurrency**: last-write-wins per row with refetch on focus acceptable, or do you want realtime sync across devices?
10. **Offline**: read-only offline acceptable for v1, or do you need offline writes (needs a per-user IndexedDB queue, a larger design)?
11. **Hosted-domain move**: do you prefer Export/Import JSON from localhost, or importing directly from localhost into the account (dev build in `server` mode)? Is the hosted domain already fixed (needed for the Supabase redirect URLs, unrelated to this feature)?
12. **Scope**: `portfolioStore` (open positions), favorites and workspace layout are also localStorage-only. Out of scope here (my proposal), or the same treatment next?
13. **Delete account data**: `on delete cascade` removes a user's journal if you delete the user in the dashboard. Intended?
14. **Copilot**: any objection that journal figures keep being sent to the model as tool results for the signed-in user (unchanged from today)?
15. **Input limits**: I added no length/size limits on free-text fields so no real data can be rejected. Add generous caps (e.g. notes ≤ 20 000 chars) for abuse protection?
