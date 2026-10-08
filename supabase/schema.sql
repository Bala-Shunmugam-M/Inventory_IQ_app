-- InventoryIQ cloud sync schema. Run once in Supabase → SQL Editor (safe to re-run).
--
-- Security model: the anon key can NOT read or list the table. The only way in
-- is two functions keyed by an exact Device ID (IQ-XXXXX-XXXXX), so the ID acts
-- as the password for that store's data. Treat it like one: don't post it publicly.

create table if not exists inventory_v8 (
  device_id   text primary key,
  data        jsonb not null,
  sales_log   jsonb,
  updated_at  timestamptz default now()
);
alter table inventory_v8 enable row level security;

-- Earlier versions of this README created wide-open policies that let anyone
-- with the anon key list every store's data. Remove them.
drop policy if exists "anon read"   on inventory_v8;
drop policy if exists "anon write"  on inventory_v8;
drop policy if exists "anon update" on inventory_v8;
revoke all on inventory_v8 from anon, authenticated;

create or replace function iq_push(p_device_id text, p_data jsonb, p_sales jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_device_id !~ '^IQ-[A-Z0-9]{1,10}-[A-Z0-9]{1,10}$' then
    raise exception 'invalid device id';
  end if;
  if jsonb_typeof(p_data) is distinct from 'array' then
    raise exception 'data must be a JSON array';
  end if;
  if pg_column_size(p_data) + coalesce(pg_column_size(p_sales), 0) > 2000000 then
    raise exception 'payload too large';
  end if;
  insert into inventory_v8 (device_id, data, sales_log, updated_at)
  values (p_device_id, p_data, p_sales, now())
  on conflict (device_id) do update
    set data = excluded.data, sales_log = excluded.sales_log, updated_at = now();
end;
$$;

create or replace function iq_pull(p_device_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('data', data, 'sales_log', sales_log, 'updated_at', updated_at)
  from inventory_v8
  where device_id = p_device_id;
$$;

revoke all on function iq_push(text, jsonb, jsonb) from public;
revoke all on function iq_pull(text) from public;
grant execute on function iq_push(text, jsonb, jsonb) to anon, authenticated;
grant execute on function iq_pull(text) to anon, authenticated;
