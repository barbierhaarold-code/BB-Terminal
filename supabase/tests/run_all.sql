-- ############################################################################
-- ##  WARNING: DESTRUCTIVE TEST. NEVER RUN THIS AGAINST ACCOUNTS THAT HOLD   ##
-- ##  REAL DATA. RUN IT ONLY WITH TWO EMPTY, THROWAWAY ACCOUNTS.             ##
-- ##                                                                        ##
-- ##  As a test, this script writes, UPDATES and DELETES rows, including     ##
-- ##  `update public.trades ... where user_id = a` and                      ##
-- ##  `delete from public.trades where user_id = a` (account A's trades).    ##
-- ##  Those statements run as B and are expected to hit 0 rows because RLS  ##
-- ##  blocks them, and everything is meant to be rolled back. But if RLS is  ##
-- ##  misconfigured, or the rollback does not happen (e.g. the editor runs   ##
-- ##  statements differently), A's REAL trades would be modified or deleted. ##
-- ##  Both accounts must own no rows in any of the four tables before you   ##
-- ##  run it. Keep the EMAIL_A / EMAIL_B placeholders in the committed file; ##
-- ##  never commit real e-mail addresses.                                   ##
-- ############################################################################
-- ============================================================================
-- run_all.sql: ONE script for the Supabase SQL editor, run AFTER the migration
-- (supabase/migrations/20261009000000_user_data_foundation.sql).
--
-- 1. Put the two account e-mails in the two lines marked EDIT below
--    (A and B = two EMPTY throwaway test accounts that own no rows yet; see WARNING above).
-- 2. Run the whole script. The result grid lists every check as PASS / FAIL.
--
-- Safety:
--  * Nothing is kept. Every test write happens inside a PL/pgSQL block that is
--    deliberately aborted at the end, which rolls back all test rows AND the
--    role switches (a subtransaction rollback undoes both). Results survive in
--    PL/pgSQL variables and are written to a session temp table afterwards.
--  * It only reads auth.users (to turn the e-mails into ids). It never creates,
--    changes or deletes an account. It DOES issue update/delete statements on
--    A's trades as B (expected to affect 0 rows under RLS), so A must be empty.
--  * Combines: the migration self-check, the 8-check RLS isolation test
--    (rls_isolation.sql) and the schema checks for B (schema_checks.sql).
-- ============================================================================

drop table if exists pg_temp.run_all_results;
create temp table run_all_results (n int, section text, result text, detail text);

do $outer$
declare
  email_a text := 'EMAIL_A';   -- EDIT: account A e-mail
  email_b text := 'EMAIL_B';   -- EDIT: account B e-mail (throwaway test account, no rows yet)
  a uuid; b uuid;
  r text[] := '{}';            -- "section|PASS/FAIL|detail" entries; plain variables survive the rollbacks
  n int; ok boolean; i int := 0;
  t text;
begin
  -- ── resolve the two accounts (read-only) ───────────────────────────────────
  select id into a from auth.users where lower(email) = lower(email_a);
  select id into b from auth.users where lower(email) = lower(email_b);
  r := array_append(r, format('setup|%s|account A found by e-mail', case when a is not null then 'PASS' else 'FAIL' end));
  r := array_append(r, format('setup|%s|account B found by e-mail', case when b is not null then 'PASS' else 'FAIL' end));
  r := array_append(r, format('setup|%s|A and B are different accounts', case when a is distinct from b and a is not null and b is not null then 'PASS' else 'FAIL' end));

  -- ── 1. migration self-check (catalog reads only) ───────────────────────────
  foreach t in array array['user_settings', 'setups', 'trades', 'trade_plans'] loop
    select c.relrowsecurity and c.relforcerowsecurity into ok
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
     where s.nspname = 'public' and c.relname = t;
    r := array_append(r, format('migration|%s|%s exists, RLS enabled and forced', case when ok then 'PASS' else 'FAIL' end, t));
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = t and roles = '{authenticated}';
    r := array_append(r, format('migration|%s|%s has 4 policies for authenticated (found %s)', case when n = 4 then 'PASS' else 'FAIL' end, t, n));
    ok := not (has_table_privilege('anon', format('public.%I', t), 'select') or has_table_privilege('anon', format('public.%I', t), 'insert')
            or has_table_privilege('anon', format('public.%I', t), 'update') or has_table_privilege('anon', format('public.%I', t), 'delete'));
    r := array_append(r, format('migration|%s|anon has no privilege on %s', case when ok then 'PASS' else 'FAIL' end, t));
    ok := has_table_privilege('authenticated', format('public.%I', t), 'select') and has_table_privilege('authenticated', format('public.%I', t), 'insert')
      and has_table_privilege('authenticated', format('public.%I', t), 'update') and has_table_privilege('authenticated', format('public.%I', t), 'delete');
    r := array_append(r, format('migration|%s|authenticated has select/insert/update/delete on %s', case when ok then 'PASS' else 'FAIL' end, t));
  end loop;
  select count(*) into n from pg_trigger where tgname in ('touch_user_settings', 'touch_setups', 'touch_trades', 'touch_trade_plans') and not tgisinternal;
  r := array_append(r, format('migration|%s|4 row_updated_at triggers present (found %s)', case when n = 4 then 'PASS' else 'FAIL' end, n));

  if a is null or b is null or a = b then
    r := array_append(r, 'rls|FAIL|skipped: both e-mails must match two different existing accounts');
  else
    -- ── 2. RLS isolation (8 checks), rolled back ─────────────────────────────
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      insert into public.trades (id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
      values ('rls-test-a', 'XAUUSD', 'buy', 0.1, 1, 2, 3, '2026-01-01T00:00:00', 'manual', '2026-01-01T00:00:00.000Z');
      insert into public.trade_plans (id, symbol, direction, status, created_at, updated_at)
      values ('rls-plan-a', 'XAUUSD', 'buy', 'draft', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      select count(*) into n from public.trades where id = 'rls-test-a';
      r := array_append(r, format('rls|%s|1. A sees its own test trade (expect 1, got %s)', case when n = 1 then 'PASS' else 'FAIL' end, n));

      perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
      select count(*) into n from public.trades where user_id = a;
      r := array_append(r, format('rls|%s|2. B selects A''s trades (expect 0, got %s)', case when n = 0 then 'PASS' else 'FAIL' end, n));
      select count(*) into n from public.trade_plans where user_id = a;
      r := array_append(r, format('rls|%s|3. B selects A''s plans (expect 0, got %s)', case when n = 0 then 'PASS' else 'FAIL' end, n));
      update public.trades set result = 999 where user_id = a;
      get diagnostics n = row_count;
      r := array_append(r, format('rls|%s|4. B updates A''s trades (expect 0 rows, got %s)', case when n = 0 then 'PASS' else 'FAIL' end, n));
      delete from public.trades where user_id = a;
      get diagnostics n = row_count;
      r := array_append(r, format('rls|%s|5. B deletes A''s trades (expect 0 rows, got %s)', case when n = 0 then 'PASS' else 'FAIL' end, n));
      begin
        insert into public.trades (user_id, id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
        values (a, 'rls-forged', 'XAUUSD', 'buy', 1, 1, 1, 1, 'x', 'manual', 'x');
        r := array_append(r, 'rls|FAIL|6. B inserted a row owned by A');
      exception when others then
        r := array_append(r, format('rls|PASS|6. B cannot insert a row owned by A (%s)', sqlerrm));
      end;
      insert into public.trades (id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
      values ('rls-test-a', 'EURUSD', 'sell', 1, 1, 1, 1, '2026-01-02T00:00:00', 'manual', '2026-01-02T00:00:00.000Z');
      r := array_append(r, 'rls|PASS|7. B can hold the same app id as A without collision');

      perform set_config('role', 'anon', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      begin
        perform 1 from public.trades limit 1;
        r := array_append(r, 'rls|FAIL|8. anon could query trades');
      exception when insufficient_privilege then
        r := array_append(r, 'rls|PASS|8. anon has no privilege on trades');
      end;

      raise exception using errcode = 'P0001', message = 'run_all_rollback';
    exception when others then
      if sqlerrm <> 'run_all_rollback' then r := array_append(r, format('rls|FAIL|unexpected error, remaining RLS checks not run: %s', sqlerrm)); end if;
    end;

    -- ── 3. schema checks for B (fresh account), rolled back ──────────────────
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

      select count(*) into n from public.trades;
      r := array_append(r, format('schema|%s|B owns no trades yet (expect 0, got %s)', case when n = 0 then 'PASS' else 'FAIL' end, n));
      select count(*) into n from public.user_settings;
      r := array_append(r, format('schema|%s|B has no settings row: no base capital (expect 0, got %s)', case when n = 0 then 'PASS' else 'FAIL' end, n));

      insert into public.trades (id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
      values ('run-all-t1', 'XAUUSD', 'sell', 0.3, 0, 0, 3132.4, '2026-08-14T17:01:56', 'import', '2026-07-14T14:30:00.000Z');
      perform 1 from public.trades where id = 'run-all-t1' and user_id = b and result = 3132.4 and entry_price = 0
        and entry_at = '2026-08-14T17:01:56' and created_at = '2026-07-14T14:30:00.000Z';
      r := array_append(r, format('schema|%s|user_id defaults to the caller; numbers and text round-trip verbatim', case when found then 'PASS' else 'FAIL' end));

      insert into public.trades (id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
      values ('run-all-t1', 'XAUUSD', 'sell', 0.3, 0, 0, 999, 'x', 'import', 'x')
      on conflict (user_id, id) do nothing;
      select count(*) into n from public.trades where id = 'run-all-t1';
      ok := n = 1 and exists (select 1 from public.trades where id = 'run-all-t1' and result = 3132.4);
      r := array_append(r, format('schema|%s|idempotent import: ON CONFLICT DO NOTHING keeps one row, original values (rows %s)', case when ok then 'PASS' else 'FAIL' end, n));

      begin
        insert into public.trades (id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
        values ('run-all-t1', 'X', 'buy', 1, 1, 1, 1, 'x', 'manual', 'x');
        r := array_append(r, 'schema|FAIL|duplicate (user_id, id) accepted');
      exception when unique_violation then r := array_append(r, 'schema|PASS|duplicate (user_id, id) rejected'); end;

      begin
        insert into public.trades (id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
        values ('run-all-bad', 'X', 'long', 1, 1, 1, 1, 'x', 'manual', 'x');
        r := array_append(r, 'schema|FAIL|invalid direction accepted');
      exception when check_violation then r := array_append(r, 'schema|PASS|invalid direction rejected'); end;

      begin
        update public.trades set user_id = a where id = 'run-all-t1';
        get diagnostics n = row_count;
        r := array_append(r, format('schema|FAIL|user_id reassigned to another account (%s rows)', n));
      exception when others then r := array_append(r, format('schema|PASS|cannot hand a row to another account (%s)', sqlerrm)); end;

      insert into public.user_settings (base_capital) values (null);
      update public.user_settings set base_capital = 43000;
      begin
        update public.user_settings set base_capital = 0;
        r := array_append(r, 'schema|FAIL|base_capital 0 accepted');
      exception when check_violation then r := array_append(r, 'schema|PASS|base_capital must be > 0 (NULL allowed)'); end;

      insert into public.trade_plans (id, symbol, direction, status, created_at, updated_at, targets, context, review_followed)
      values ('run-all-p1', 'XAUUSD', 'buy', 'active', '2026-07-14T08:00:00.000Z', '2026-07-14T08:00:00.000Z', '[4020, 4030.5]', '{"market":{"available":false}}', 'partly');
      perform 1 from public.trade_plans where id = 'run-all-p1' and targets = '[4020, 4030.5]'::jsonb and review_followed = 'partly';
      r := array_append(r, format('schema|%s|plan jsonb targets/context and review columns round-trip', case when found then 'PASS' else 'FAIL' end));

      raise exception using errcode = 'P0001', message = 'run_all_rollback';
    exception when others then
      if sqlerrm <> 'run_all_rollback' then r := array_append(r, format('schema|FAIL|unexpected error, remaining schema checks not run: %s', sqlerrm)); end if;
    end;

    -- ── nothing was kept (back as the editor's own role) ─────────────────────
    select count(*) into n from public.trades where id in ('rls-test-a', 'rls-forged', 'run-all-t1', 'run-all-bad');
    r := array_append(r, format('cleanup|%s|no test trade remains after the rollbacks (found %s)', case when n = 0 then 'PASS' else 'FAIL' end, n));
    select count(*) into n from public.trade_plans where id in ('rls-plan-a', 'run-all-p1');
    r := array_append(r, format('cleanup|%s|no test plan remains after the rollbacks (found %s)', case when n = 0 then 'PASS' else 'FAIL' end, n));
    select count(*) into n from public.user_settings where user_id = b;
    r := array_append(r, format('cleanup|%s|B still has no settings row (found %s)', case when n = 0 then 'PASS' else 'FAIL' end, n));
  end if;

  foreach t in array r loop
    i := i + 1;
    insert into run_all_results values (i, split_part(t, '|', 1), split_part(t, '|', 2), substr(t, length(split_part(t, '|', 1)) + length(split_part(t, '|', 2)) + 3));
  end loop;
end
$outer$;

-- One grid: a summary line first, then every check. Paste this grid back.
select 0 as n, 'SUMMARY' as section,
       case when count(*) filter (where result = 'FAIL') = 0 then 'PASS' else 'FAIL' end as result,
       format('%s checks, %s passed, %s failed', count(*), count(*) filter (where result = 'PASS'), count(*) filter (where result = 'FAIL')) as detail
  from run_all_results
union all
select n, section, result, detail from run_all_results
order by n;
