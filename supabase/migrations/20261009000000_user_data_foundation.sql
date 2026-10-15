-- ============================================================================
-- User data foundation: per-user Track Record (trades, setups), Trade Plans and
-- settings, protected by row-level security.
--
-- NOT APPLIED. To be reviewed and run by the project owner in the Supabase SQL
-- editor. Re-runnable: every statement is idempotent (IF NOT EXISTS / OR REPLACE
-- / DROP POLICY IF EXISTS). It creates new tables only; it never touches
-- auth.* or any existing table.
--
-- Mapping rules (see docs/user-data-design.md):
--  * `id` is the app's own id (text, preserved verbatim). Primary key is
--    (user_id, id), so two users importing the same backup never collide.
--  * Client-origin timestamps (entry_at, exit_at, created_at, updated_at) are
--    stored as TEXT exactly as the app wrote them, so an export after a round
--    trip is byte-identical. Server bookkeeping uses row_* timestamptz columns.
--  * Fields the app does not know about yet are kept in `extra` (jsonb), the
--    same forward-compat behaviour as the JSON backup importer.
--  * user_id defaults to auth.uid(); RLS checks it on every operation.
-- ============================================================================

-- ── Shared helper: keep row_updated_at honest ───────────────────────────────
create or replace function public.touch_row_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.row_updated_at := now();
  return new;
end;
$$;

-- ── user_settings (one row per user, created on first change) ───────────────
-- base_capital is NULL until the user sets it: a new account has NO base
-- capital, and capital-relative stats show n/a until it is set. The privacy
-- toggle (pricesHidden) is a per-device preference and is NOT stored here.
create table if not exists public.user_settings (
  user_id         uuid primary key default auth.uid()
                    references auth.users (id) on delete cascade,
  base_capital    numeric check (base_capital is null or base_capital > 0),
  schema_version  integer not null default 1,
  row_created_at  timestamptz not null default now(),
  row_updated_at  timestamptz not null default now()
);

-- ── setups ──────────────────────────────────────────────────────────────────
create table if not exists public.setups (
  user_id         uuid not null default auth.uid()
                    references auth.users (id) on delete cascade,
  id              text not null,
  name            text not null check (length(btrim(name)) > 0),
  schema_version  integer not null default 1,
  row_created_at  timestamptz not null default now(),
  row_updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── trades (1:1 with the Trade interface in app/src/lib/journal.ts) ─────────
create table if not exists public.trades (
  user_id         uuid not null default auth.uid()
                    references auth.users (id) on delete cascade,
  id              text not null,
  -- stable insertion order (the local store is an ordered array)
  seq             bigint generated always as identity,
  symbol          text not null check (length(symbol) > 0),
  direction       text not null check (direction in ('buy', 'sell')),
  size            numeric not null,
  entry_price     numeric not null,
  exit_price      numeric not null,
  result          numeric not null,
  entry_at        text not null,
  exit_at         text,
  setup_id        text,            -- soft reference to setups.id (no FK, like the local store)
  macro_bias      text,
  conviction      text,
  news_event      text,
  feeling         text,
  notes           text,
  source          text not null check (source in ('manual', 'import')),
  created_at      text not null,
  extra           jsonb not null default '{}'::jsonb,
  schema_version  integer not null default 1,
  row_created_at  timestamptz not null default now(),
  row_updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists trades_user_entry_at_idx on public.trades (user_id, entry_at);
create index if not exists trades_user_seq_idx      on public.trades (user_id, seq);

-- ── trade_plans (1:1 with TradePlan in app/src/lib/tradePlan.ts) ────────────
create table if not exists public.trade_plans (
  user_id          uuid not null default auth.uid()
                     references auth.users (id) on delete cascade,
  id               text not null,
  seq              bigint generated always as identity,
  title            text,
  symbol           text not null check (length(btrim(symbol)) > 0),
  direction        text not null check (direction in ('buy', 'sell')),
  thesis_macro     text not null default '',
  thesis_technical text not null default '',
  setup_id         text,           -- soft reference to setups.id
  timeframe        text not null default '',
  entry_low        numeric,
  entry_high       numeric,
  stop             numeric,
  targets          jsonb not null default '[]'::jsonb check (jsonb_typeof(targets) = 'array'),
  risk_pct         numeric,
  catalysts        text not null default '',
  conviction       numeric,
  status           text not null check (status in
                     ('draft', 'active', 'triggered', 'invalidated', 'closed', 'cancelled')),
  created_at       text not null,
  updated_at       text not null,
  context          jsonb,          -- frozen Market Context / COT snapshot, opaque to the DB
  review_trade_id  text,           -- soft reference to trades.id (plan → trade, never the reverse)
  review_followed  text check (review_followed in ('yes', 'partly', 'no')),
  review_lesson    text not null default '',
  extra            jsonb not null default '{}'::jsonb,
  schema_version   integer not null default 1,   -- = PLAN_SCHEMA_VERSION
  row_created_at   timestamptz not null default now(),
  row_updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists trade_plans_user_seq_idx on public.trade_plans (user_id, seq);

-- ── updated-at triggers ─────────────────────────────────────────────────────
drop trigger if exists touch_user_settings on public.user_settings;
create trigger touch_user_settings before update on public.user_settings
  for each row execute function public.touch_row_updated_at();

drop trigger if exists touch_setups on public.setups;
create trigger touch_setups before update on public.setups
  for each row execute function public.touch_row_updated_at();

drop trigger if exists touch_trades on public.trades;
create trigger touch_trades before update on public.trades
  for each row execute function public.touch_row_updated_at();

drop trigger if exists touch_trade_plans on public.trade_plans;
create trigger touch_trade_plans before update on public.trade_plans
  for each row execute function public.touch_row_updated_at();

-- ── Privileges: signed-in users only; anonymous gets nothing ────────────────
revoke all on public.user_settings, public.setups, public.trades, public.trade_plans from anon, public;
grant select, insert, update, delete
  on public.user_settings, public.setups, public.trades, public.trade_plans to authenticated;

-- ── Row-level security ──────────────────────────────────────────────────────
-- Every operation is restricted to rows where user_id = the caller's auth.uid().
-- (select auth.uid()) is evaluated once per statement instead of once per row.
-- No policy exists for anon, and there is deliberately no service_role usage
-- anywhere in the app.
alter table public.user_settings enable row level security;
alter table public.setups        enable row level security;
alter table public.trades        enable row level security;
alter table public.trade_plans   enable row level security;
-- Also apply RLS to the table owner's sessions, so a mistake in a SECURITY
-- DEFINER function added later cannot silently bypass it.
alter table public.user_settings force row level security;
alter table public.setups        force row level security;
alter table public.trades        force row level security;
alter table public.trade_plans   force row level security;

-- user_settings
drop policy if exists user_settings_select on public.user_settings;
drop policy if exists user_settings_insert on public.user_settings;
drop policy if exists user_settings_update on public.user_settings;
drop policy if exists user_settings_delete on public.user_settings;
create policy user_settings_select on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy user_settings_insert on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy user_settings_update on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy user_settings_delete on public.user_settings for delete to authenticated
  using (user_id = (select auth.uid()));

-- setups
drop policy if exists setups_select on public.setups;
drop policy if exists setups_insert on public.setups;
drop policy if exists setups_update on public.setups;
drop policy if exists setups_delete on public.setups;
create policy setups_select on public.setups for select to authenticated
  using (user_id = (select auth.uid()));
create policy setups_insert on public.setups for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy setups_update on public.setups for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy setups_delete on public.setups for delete to authenticated
  using (user_id = (select auth.uid()));

-- trades
drop policy if exists trades_select on public.trades;
drop policy if exists trades_insert on public.trades;
drop policy if exists trades_update on public.trades;
drop policy if exists trades_delete on public.trades;
create policy trades_select on public.trades for select to authenticated
  using (user_id = (select auth.uid()));
create policy trades_insert on public.trades for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy trades_update on public.trades for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy trades_delete on public.trades for delete to authenticated
  using (user_id = (select auth.uid()));

-- trade_plans
drop policy if exists trade_plans_select on public.trade_plans;
drop policy if exists trade_plans_insert on public.trade_plans;
drop policy if exists trade_plans_update on public.trade_plans;
drop policy if exists trade_plans_delete on public.trade_plans;
create policy trade_plans_select on public.trade_plans for select to authenticated
  using (user_id = (select auth.uid()));
create policy trade_plans_insert on public.trade_plans for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy trade_plans_update on public.trade_plans for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy trade_plans_delete on public.trade_plans for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── Post-run self-check (read-only; every row must show rls_enabled = true) ─
-- select c.relname, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--  where n.nspname = 'public'
--    and c.relname in ('user_settings', 'setups', 'trades', 'trade_plans');
