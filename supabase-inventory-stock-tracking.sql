begin;

alter table public.productos
  add column if not exists stock_tracked boolean;

update public.productos
set stock_tracked = coalesce(stock, 0) > 0
where stock_tracked is null;

alter table public.productos
  alter column stock_tracked set default true,
  alter column stock_tracked set not null,
  alter column stock drop not null;

create table if not exists public.store_inventory_daily (
  business_date date not null,
  product_id uuid not null references public.productos(id) on delete cascade,
  product_name text not null,
  opening_stock numeric(14, 3) not null check (opening_stock >= 0),
  units_sold numeric(14, 3) not null default 0 check (units_sold >= 0),
  closing_stock numeric(14, 3) not null check (closing_stock >= 0),
  updated_at timestamptz not null default now(),
  primary key (business_date, product_id)
);

create table if not exists public.store_inventory_order_items (
  order_item_id uuid primary key references public.store_order_items(id) on delete cascade,
  product_id uuid not null references public.productos(id) on delete cascade,
  business_date date not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  reversed_at timestamptz
);

alter table public.store_inventory_daily enable row level security;
alter table public.store_inventory_order_items enable row level security;
revoke all on public.store_inventory_daily from public, anon, authenticated;
revoke all on public.store_inventory_order_items from public, anon, authenticated;

create or replace function public.apply_inventory_stock_to_order_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stock numeric(14, 3);
  v_opening_stock numeric(14, 3);
  v_product_name text;
  v_business_date date := (now() at time zone 'America/Caracas')::date;
begin
  if new.product_id is null then
    return new;
  end if;

  select product.stock, product.nombre
  into v_opening_stock, v_product_name
  from public.productos as product
  where product.id = new.product_id
    and product.stock_tracked
    and product.stock is not null
  for update;
  if not found then
    return new;
  end if;

  update public.productos
  set stock = greatest(stock - new.quantity, 0),
      updated_at = now()
  where id = new.product_id
  returning stock into v_stock;

  insert into public.store_inventory_daily (
    business_date, product_id, product_name, opening_stock, units_sold, closing_stock
  )
  values (
    v_business_date,
    new.product_id,
    v_product_name,
    v_opening_stock,
    new.quantity,
    v_stock
  )
  on conflict (business_date, product_id) do update
  set product_name = excluded.product_name,
      units_sold = public.store_inventory_daily.units_sold + excluded.units_sold,
      closing_stock = excluded.closing_stock,
      updated_at = now();

  insert into public.store_inventory_order_items (
    order_item_id, product_id, business_date, quantity
  )
  values (new.id, new.product_id, v_business_date, new.quantity);

  return new;
end;
$$;

create or replace function public.restore_inventory_stock_for_closed_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement record;
begin
  if not (
    (new.order_status = 'cancelled' and old.order_status is distinct from 'cancelled')
    or (new.payment_status = 'rejected' and old.payment_status is distinct from 'rejected')
  ) then
    return new;
  end if;

  for v_movement in
    select movement.order_item_id, movement.product_id, movement.business_date, movement.quantity
    from public.store_inventory_order_items as movement
    join public.store_order_items as item on item.id = movement.order_item_id
    where item.order_id = new.id
      and movement.reversed_at is null
    for update of movement
  loop
    update public.productos
    set stock = stock + v_movement.quantity,
        updated_at = now()
    where id = v_movement.product_id
      and stock_tracked
      and stock is not null;

    update public.store_inventory_order_items
    set reversed_at = now()
    where order_item_id = v_movement.order_item_id;

    update public.store_inventory_daily
    set units_sold = greatest(units_sold - v_movement.quantity, 0),
        updated_at = now()
    where business_date = v_movement.business_date
      and product_id = v_movement.product_id;
  end loop;

  return new;
end;
$$;

create or replace function public.sync_inventory_daily_closing_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stock is distinct from old.stock
    or new.stock_tracked is distinct from old.stock_tracked then
    update public.store_inventory_daily
    set closing_stock = case when new.stock_tracked then coalesce(new.stock, 0) else closing_stock end,
        product_name = new.nombre,
        updated_at = now()
    where business_date = (now() at time zone 'America/Caracas')::date
      and product_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists store_order_items_apply_inventory_stock on public.store_order_items;
create trigger store_order_items_apply_inventory_stock
after insert on public.store_order_items
for each row execute function public.apply_inventory_stock_to_order_item();

drop trigger if exists store_orders_restore_inventory_stock on public.store_orders;
create trigger store_orders_restore_inventory_stock
after update of order_status, payment_status on public.store_orders
for each row execute function public.restore_inventory_stock_for_closed_order();

drop trigger if exists products_sync_inventory_daily_closing on public.productos;
create trigger products_sync_inventory_daily_closing
after update of stock, stock_tracked on public.productos
for each row execute function public.sync_inventory_daily_closing_stock();

create or replace function public.start_inventory_stock_day()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_date date := (now() at time zone 'America/Caracas')::date;
  v_rows integer;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Solo administración puede registrar el stock inicial.';
  end if;

  insert into public.store_inventory_daily (
    business_date, product_id, product_name, opening_stock, units_sold, closing_stock
  )
  select v_business_date, product.id, product.nombre, product.stock, 0, product.stock
  from public.productos as product
  where product.stock_tracked
    and product.stock is not null
  on conflict (business_date, product_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.get_inventory_stock_day()
returns table (
  product_id uuid,
  product_name text,
  opening_stock numeric,
  units_sold numeric,
  closing_stock numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Solo administración puede consultar el resumen de stock.';
  end if;

  return query
  select daily.product_id,
         daily.product_name,
         daily.opening_stock,
         daily.units_sold,
         coalesce(product.stock, daily.closing_stock) as closing_stock
  from public.store_inventory_daily as daily
  left join public.productos as product on product.id = daily.product_id
  where daily.business_date = (now() at time zone 'America/Caracas')::date
    and product.stock_tracked
  order by daily.product_name;
end;
$$;

revoke all on function public.start_inventory_stock_day() from public, anon;
revoke all on function public.get_inventory_stock_day() from public, anon;
grant execute on function public.start_inventory_stock_day() to authenticated;
grant execute on function public.get_inventory_stock_day() to authenticated;

commit;
