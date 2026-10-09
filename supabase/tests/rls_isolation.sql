-- ============================================================================
-- RLS isolation check. NOT RUN. To be executed by the project owner in the
-- Supabase SQL editor, AFTER the migration, with two EXISTING user ids
-- (Authentication → Users; the owner creates / signs in the accounts, nothing
-- here creates or touches an account). Safe to run when both users already own
-- real data: it only counts/touches rows owned by A, and rolls back.
--
-- Everything runs inside one transaction that is ROLLED BACK at the end, so no
-- row is kept. Replace the two uuids below, run the whole script, and read the
-- NOTICE lines: each must say PASS.
-- ============================================================================
begin;

do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';  -- REPLACE: user A id
  b uuid := '00000000-0000-0000-0000-00000000000b';  -- REPLACE: user B id
  n int;
begin
  -- act as user A
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  insert into public.trades (id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
  values ('rls-test-a', 'XAUUSD', 'buy', 0.1, 1, 2, 3, '2026-01-01T00:00:00', 'manual', '2026-01-01T00:00:00.000Z');
  insert into public.trade_plans (id, symbol, direction, status, created_at, updated_at)
  values ('rls-plan-a', 'XAUUSD', 'buy', 'draft', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  select count(*) into n from public.trades where id = 'rls-test-a';
  raise notice '% A sees own trade (expect 1): %', case when n = 1 then 'PASS' else 'FAIL' end, n;

  -- act as user B
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from public.trades where user_id = a;
  raise notice '% B selects A trades (expect 0): %', case when n = 0 then 'PASS' else 'FAIL' end, n;
  select count(*) into n from public.trade_plans where user_id = a;
  raise notice '% B selects A plans (expect 0): %', case when n = 0 then 'PASS' else 'FAIL' end, n;

  update public.trades set result = 999 where user_id = a;
  get diagnostics n = row_count;
  raise notice '% B updates A trade (expect 0 rows): %', case when n = 0 then 'PASS' else 'FAIL' end, n;

  delete from public.trades where user_id = a;
  get diagnostics n = row_count;
  raise notice '% B deletes A trade (expect 0 rows): %', case when n = 0 then 'PASS' else 'FAIL' end, n;

  begin
    insert into public.trades (user_id, id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
    values (a, 'rls-forged', 'XAUUSD', 'buy', 1, 1, 1, 1, 'x', 'manual', 'x');
    raise notice 'FAIL B inserted a row owned by A';
  exception when others then
    raise notice 'PASS B cannot insert a row for A (%).', sqlerrm;
  end;

  -- B can reuse the same app id for its own row (PK is (user_id, id))
  insert into public.trades (id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
  values ('rls-test-a', 'EURUSD', 'sell', 1, 1, 1, 1, '2026-01-02T00:00:00', 'manual', '2026-01-02T00:00:00.000Z');
  raise notice 'PASS B can hold the same app id as A without collision';

  -- anonymous
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform 1 from public.trades limit 1;
    raise notice 'FAIL anon could query trades';
  exception when insufficient_privilege then
    raise notice 'PASS anon has no privilege on trades';
  end;
end
$$;

rollback;  -- nothing above is kept
