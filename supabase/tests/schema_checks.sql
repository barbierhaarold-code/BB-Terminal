-- Schema behaviour checks (idempotent import, constraints, ownership). NOT RUN
-- on Supabase. Replace the uuid with ONE existing user id that owns NO rows yet
-- (use the second test user, not your real account: the 'no settings row' check
-- expects a fresh account). Runs in a transaction that is rolled back.
begin;
do $$
declare
  a uuid := '00000000-0000-0000-0000-00000000000a';  -- REPLACE: an existing user id
  other uuid := '00000000-0000-0000-0000-0000000000ff';
  n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  -- user_id defaults to auth.uid(); numeric/text round trip
  insert into public.trades (id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
  values ('t1', 'XAUUSD', 'sell', 0.3, 0, 0, 3132.4, '2026-08-14T17:01:56', 'import', '2026-07-14T14:30:00.000Z');
  perform 1 from public.trades where id = 't1' and user_id = a and result = 3132.4 and entry_price = 0
    and entry_at = '2026-08-14T17:01:56' and created_at = '2026-07-14T14:30:00.000Z';
  raise notice '% defaults + verbatim round trip', case when found then 'PASS' else 'FAIL' end;

  -- idempotent import: same (user_id,id) twice → second is a no-op, no duplicate
  insert into public.trades (id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
  values ('t1', 'XAUUSD', 'sell', 0.3, 0, 0, 999, 'x', 'import', 'x')
  on conflict (user_id, id) do nothing;
  select count(*) into n from public.trades where id = 't1';
  raise notice '% ON CONFLICT DO NOTHING keeps one row (%), original kept', case when n = 1 and exists (select 1 from public.trades where id='t1' and result=3132.4) then 'PASS' else 'FAIL' end, n;

  -- plain duplicate insert is rejected by the primary key
  begin
    insert into public.trades (id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
    values ('t1', 'X', 'buy', 1, 1, 1, 1, 'x', 'manual', 'x');
    raise notice 'FAIL duplicate id accepted';
  exception when unique_violation then raise notice 'PASS duplicate (user_id,id) rejected'; end;

  -- constraints
  begin
    insert into public.trades (id, symbol, direction, size, entry_price, exit_price, result, entry_at, source, created_at)
    values ('bad', 'X', 'long', 1, 1, 1, 1, 'x', 'manual', 'x');
    raise notice 'FAIL bad direction accepted';
  exception when check_violation then raise notice 'PASS bad direction rejected'; end;

  -- cannot hand a row to another user via UPDATE
  begin
    update public.trades set user_id = other where id = 't1';
    raise notice 'FAIL user_id reassigned';
  exception when others then raise notice 'PASS cannot reassign user_id (%)', sqlerrm; end;

  -- settings: a new account has no base capital; 0 / negative rejected; NULL allowed
  select count(*) into n from public.user_settings;
  raise notice '% no settings row for a new account', case when n = 0 then 'PASS' else 'FAIL' end;
  insert into public.user_settings (base_capital) values (null);
  update public.user_settings set base_capital = 43000;
  begin
    update public.user_settings set base_capital = 0;
    raise notice 'FAIL base_capital 0 accepted';
  exception when check_violation then raise notice 'PASS base_capital must be > 0'; end;

  -- plan with jsonb context/targets + review columns round trip
  insert into public.trade_plans (id, symbol, direction, status, created_at, updated_at, targets, context, review_followed)
  values ('p1', 'XAUUSD', 'buy', 'active', '2026-07-14T08:00:00.000Z', '2026-07-14T08:00:00.000Z', '[4020, 4030.5]', '{"market":{"available":false}}', 'partly');
  perform 1 from public.trade_plans where id='p1' and targets = '[4020, 4030.5]'::jsonb and review_followed = 'partly';
  raise notice '% plan jsonb round trip', case when found then 'PASS' else 'FAIL' end;
end
$$;
rollback;
