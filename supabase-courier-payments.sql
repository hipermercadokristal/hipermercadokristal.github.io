begin;

create table if not exists public.courier_delivery_earnings (
  order_id uuid primary key references public.store_orders(id) on delete restrict,
  courier_id uuid not null references auth.users(id) on delete restrict,
  courier_name text not null,
  amount_usd numeric(10, 2) not null default 4.00 check (amount_usd = 4.00),
  earned_at timestamptz not null default now()
);

create index if not exists courier_delivery_earnings_courier_date_idx
  on public.courier_delivery_earnings (courier_id, earned_at desc);

create table if not exists public.courier_payouts (
  id uuid primary key default gen_random_uuid(),
  courier_id uuid not null references auth.users(id) on delete restrict,
  courier_name text not null,
  amount_usd numeric(12, 2) not null check (amount_usd > 0),
  paid_by uuid references auth.users(id) on delete set null,
  paid_by_name text not null,
  paid_at timestamptz not null default now()
);

create index if not exists courier_payouts_courier_date_idx
  on public.courier_payouts (courier_id, paid_at desc);

alter table public.courier_delivery_earnings enable row level security;
alter table public.courier_payouts enable row level security;
revoke all on public.courier_delivery_earnings from public, anon, authenticated;
revoke all on public.courier_payouts from public, anon, authenticated;

create or replace function public.accrue_courier_delivery_earning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_courier_name text;
begin
  if old.order_status is distinct from 'delivered'
    and new.order_status = 'delivered'
    and new.fulfillment = 'delivery'
    and new.assigned_courier_id is not null then
    perform 1
    from auth.users
    where id = new.assigned_courier_id
    for update;

    select coalesce(
      nullif(profile.full_name, ''),
      nullif(user_record.raw_user_meta_data ->> 'full_name', ''),
      nullif(user_record.email, ''),
      'Repartidor'
    )
    into v_courier_name
    from auth.users as user_record
    left join public.customer_profiles as profile on profile.user_id = user_record.id
    where user_record.id = new.assigned_courier_id;

    insert into public.courier_delivery_earnings (
      order_id, courier_id, courier_name, amount_usd
    )
    values (new.id, new.assigned_courier_id, v_courier_name, 4.00)
    on conflict (order_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists store_orders_accrue_courier_earning on public.store_orders;
create trigger store_orders_accrue_courier_earning
after update of order_status on public.store_orders
for each row execute function public.accrue_courier_delivery_earning();

revoke all on function public.accrue_courier_delivery_earning() from public, anon, authenticated;

create or replace function public.get_courier_balance_summary()
returns table (
  courier_id uuid,
  courier_name text,
  courier_email text,
  balance_usd numeric,
  completed_deliveries bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Solo administración puede consultar los saldos de delivery.';
  end if;

  return query
  select user_record.id,
         coalesce(
           nullif(profile.full_name, ''),
           nullif(user_record.raw_user_meta_data ->> 'full_name', ''),
           nullif(user_record.email, ''),
           'Repartidor'
         ),
         coalesce(user_record.email, ''),
         (
           coalesce((
             select sum(earning.amount_usd)
             from public.courier_delivery_earnings as earning
             where earning.courier_id = user_record.id
           ), 0)
           - coalesce((
             select sum(payout.amount_usd)
             from public.courier_payouts as payout
             where payout.courier_id = user_record.id
           ), 0)
         )::numeric,
         (
           select count(*)
           from public.courier_delivery_earnings as earning
           where earning.courier_id = user_record.id
         )
  from auth.users as user_record
  left join public.customer_profiles as profile on profile.user_id = user_record.id
  where user_record.raw_app_meta_data ->> 'role' = 'courier'
     or exists (
       select 1
       from public.courier_delivery_earnings as earning
       where earning.courier_id = user_record.id
     )
     or exists (
       select 1
       from public.courier_payouts as payout
       where payout.courier_id = user_record.id
     )
  order by 2, user_record.id;
end;
$$;

create or replace function public.get_courier_payout_history()
returns table (
  payout_id uuid,
  courier_name text,
  amount_usd numeric,
  paid_by_name text,
  paid_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Solo administración puede consultar el historial de pagos.';
  end if;

  return query
  select payout.id, payout.courier_name, payout.amount_usd, payout.paid_by_name, payout.paid_at
  from public.courier_payouts as payout
  order by payout.paid_at desc
  limit 100;
end;
$$;

create or replace function public.settle_courier_balance(p_courier_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_courier_name text;
  v_admin_name text;
  v_balance numeric(12, 2);
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
    or auth.uid() is null then
    raise exception 'Solo administración puede registrar pagos a repartidores.';
  end if;
  if p_courier_id is null then
    raise exception 'Selecciona un repartidor válido.';
  end if;

  perform 1
  from auth.users
  where id = p_courier_id
  for update;
  if not found then
    raise exception 'No se encontró la cuenta del repartidor.';
  end if;

  select coalesce(
    nullif(profile.full_name, ''),
    nullif(user_record.raw_user_meta_data ->> 'full_name', ''),
    nullif(user_record.email, ''),
    'Repartidor'
  )
  into v_courier_name
  from auth.users as user_record
  left join public.customer_profiles as profile on profile.user_id = user_record.id
  where user_record.id = p_courier_id;

  select coalesce(
    nullif(profile.full_name, ''),
    nullif(user_record.raw_user_meta_data ->> 'full_name', ''),
    nullif(user_record.email, ''),
    'Administración'
  )
  into v_admin_name
  from auth.users as user_record
  left join public.customer_profiles as profile on profile.user_id = user_record.id
  where user_record.id = auth.uid();

  select (
    coalesce((
      select sum(earning.amount_usd)
      from public.courier_delivery_earnings as earning
      where earning.courier_id = p_courier_id
    ), 0)
    - coalesce((
      select sum(payout.amount_usd)
      from public.courier_payouts as payout
      where payout.courier_id = p_courier_id
    ), 0)
  )::numeric(12, 2)
  into v_balance;

  if v_balance <= 0 then
    raise exception 'Este repartidor no tiene saldo pendiente para liquidar.';
  end if;

  insert into public.courier_payouts (
    courier_id, courier_name, amount_usd, paid_by, paid_by_name
  )
  values (p_courier_id, v_courier_name, v_balance, auth.uid(), v_admin_name);

  return v_balance;
end;
$$;

revoke all on function public.get_courier_balance_summary() from public, anon;
revoke all on function public.get_courier_payout_history() from public, anon;
revoke all on function public.settle_courier_balance(uuid) from public, anon;
grant execute on function public.get_courier_balance_summary() to authenticated;
grant execute on function public.get_courier_payout_history() to authenticated;
grant execute on function public.settle_courier_balance(uuid) to authenticated;

commit;
