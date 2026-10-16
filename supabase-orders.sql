create extension if not exists pgcrypto;

create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  default_address text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.store_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  customer_name text not null,
  customer_phone text not null,
  fulfillment text not null check (fulfillment in ('pickup', 'delivery')),
  delivery_address text,
  payment_method text not null check (payment_method in ('mobile_payment', 'zelle', 'cash_pos')),
  payment_bank_code text,
  payment_reference text,
  payment_proof_path text,
  exchange_rate numeric(12, 4),
  total_ves numeric(14, 2),
  total_usd numeric(12, 2) not null check (total_usd > 0),
  payment_status text not null check (
    payment_status in ('pending_verification', 'awaiting_instructions', 'awaiting_in_store', 'awaiting_delivery', 'verified', 'rejected')
  ),
  order_status text not null default 'received' check (
    order_status in ('received', 'preparing', 'ready', 'delivering', 'delivered', 'cancelled')
  ),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_requires_address check (fulfillment <> 'delivery' or nullif(trim(delivery_address), '') is not null),
  constraint mobile_payment_requires_reference_and_bank check (
    payment_method <> 'mobile_payment'
    or (
      nullif(trim(payment_reference), '') is not null
      and nullif(trim(payment_bank_code), '') is not null
      and payment_bank_code in ('0102', '0105', '0108', '0134')
    )
  ),
  constraint mobile_payment_requires_proof check (
    payment_method <> 'mobile_payment' or nullif(trim(payment_proof_path), '') is not null
  ),
  constraint exchange_rate_and_total_ves_together check (
    (exchange_rate is null and total_ves is null)
    or (exchange_rate is not null and exchange_rate > 0 and total_ves is not null and total_ves >= 0)
  )
);

create table if not exists public.store_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.store_orders(id) on delete cascade,
  product_id uuid references public.productos(id) on delete set null,
  product_name text not null,
  presentation text,
  quantity integer not null check (quantity between 1 and 99),
  unit_price_usd numeric(10, 2) not null check (unit_price_usd >= 0),
  line_total_usd numeric(12, 2) not null check (line_total_usd >= 0)
);

create index if not exists store_orders_user_created_idx
  on public.store_orders (user_id, created_at desc);
create index if not exists store_orders_admin_created_idx
  on public.store_orders (created_at desc);
create index if not exists store_order_items_order_idx
  on public.store_order_items (order_id);

alter table public.customer_profiles enable row level security;
alter table public.store_orders enable row level security;
alter table public.store_order_items enable row level security;

grant select, insert, update on public.customer_profiles to authenticated;
grant select, update on public.store_orders to authenticated;
grant select on public.store_order_items to authenticated;

drop policy if exists "Customers can read their profile" on public.customer_profiles;
create policy "Customers can read their profile"
  on public.customer_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Customers can create their profile" on public.customer_profiles;
create policy "Customers can create their profile"
  on public.customer_profiles for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Customers can update their profile" on public.customer_profiles;
create policy "Customers can update their profile"
  on public.customer_profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Customers and admins can read orders" on public.store_orders;
create policy "Customers and admins can read orders"
  on public.store_orders for select to authenticated
  using (user_id = (select auth.uid()) or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Admins can update orders" on public.store_orders;
create policy "Admins can update orders"
  on public.store_orders for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Customers and admins can read order items" on public.store_order_items;
create policy "Customers and admins can read order items"
  on public.store_order_items for select to authenticated
  using (
    exists (
      select 1
      from public.store_orders orders
      where orders.id = order_id
        and (
          orders.user_id = (select auth.uid())
          or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        )
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Customers can upload their payment proof" on storage.objects;
create policy "Customers can upload their payment proof"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Customers and admins can view payment proofs" on storage.objects;
create policy "Customers and admins can view payment proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    )
  );

drop policy if exists "Customers can remove unassociated payment proofs" on storage.objects;
create policy "Customers can remove unassociated payment proofs"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1
      from public.store_orders orders
      where orders.user_id = (select auth.uid())
        and orders.payment_proof_path = name
    )
  );

create or replace function public.create_store_order(
  p_order_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_fulfillment text,
  p_delivery_address text,
  p_payment_method text,
  p_payment_bank_code text,
  p_payment_reference text,
  p_payment_proof_path text,
  p_exchange_rate numeric,
  p_items jsonb
)
returns table (
  order_id uuid,
  total_usd numeric,
  total_ves numeric,
  payment_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  selected_product public.productos%rowtype;
  item_quantity integer;
  order_total numeric(12, 2) := 0;
  created_order_id uuid;
  initial_payment_status text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para confirmar el pedido.';
  end if;
  if p_order_id is null then
    raise exception 'El identificador del pedido no es válido.';
  end if;
  if nullif(trim(coalesce(p_customer_name, '')), '') is null or length(trim(p_customer_name)) > 80 then
    raise exception 'Indica un nombre válido.';
  end if;
  if length(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g')) < 7
    or length(coalesce(p_customer_phone, '')) > 25 then
    raise exception 'Indica un teléfono válido.';
  end if;
  if p_fulfillment is null or p_fulfillment not in ('pickup', 'delivery') then
    raise exception 'Selecciona un método de entrega válido.';
  end if;
  if p_fulfillment = 'delivery'
    and (
      nullif(trim(coalesce(p_delivery_address, '')), '') is null
      or length(p_delivery_address) > 300
    ) then
    raise exception 'Indica la dirección de entrega.';
  end if;
  if p_payment_method is null or p_payment_method not in ('mobile_payment', 'zelle', 'cash_pos') then
    raise exception 'Selecciona un método de pago válido.';
  end if;
  if p_payment_method = 'mobile_payment'
    and (
      nullif(trim(coalesce(p_payment_bank_code, '')), '') is null
      or p_payment_bank_code not in ('0102', '0105', '0108', '0134')
      or nullif(trim(p_payment_reference), '') is null
      or length(trim(p_payment_reference)) > 40
      or nullif(trim(p_payment_proof_path), '') is null
      or p_payment_proof_path !~ ('^' || auth.uid()::text || '/' || p_order_id::text || '/[^/]+$')
      or p_exchange_rate is null
    ) then
    raise exception 'Pago Móvil requiere cuenta receptora, referencia, comprobante y tasa BCV.';
  end if;
  if p_payment_method <> 'mobile_payment'
    and (
      nullif(trim(p_payment_reference), '') is not null
      or nullif(trim(p_payment_bank_code), '') is not null
      or nullif(trim(p_payment_proof_path), '') is not null
    ) then
    raise exception 'No se debe enviar comprobante ni referencia para este método de pago.';
  end if;
  if p_payment_method = 'mobile_payment' and not exists (
    select 1 from storage.objects
    where bucket_id = 'payment-proofs' and name = p_payment_proof_path
  ) then
    raise exception 'El comprobante no se encuentra en el almacenamiento privado.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'El pedido debe incluir productos.';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe incluir productos.';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'El pedido supera el máximo de productos permitido.';
  end if;
  if p_exchange_rate is not null and (p_exchange_rate <= 0 or p_exchange_rate > 10000000) then
    raise exception 'La tasa indicada no es válida.';
  end if;

  for item in
    select value from jsonb_array_elements(p_items)
    order by value ->> 'product_id'
  loop
    if coalesce(item ->> 'quantity', '') !~ '^[1-9][0-9]*$' then
      raise exception 'La cantidad de un producto no es válida.';
    end if;
    item_quantity := (item ->> 'quantity')::integer;
    if item_quantity > 99 then
      raise exception 'La cantidad de un producto supera el máximo permitido.';
    end if;
    select * into selected_product
    from public.productos
    where id = (item ->> 'product_id')::uuid
      and disponible = true
    for share;
    if not found then
      raise exception 'Un producto ya no está disponible. Actualiza el carrito.';
    end if;
    order_total := order_total + round(coalesce(selected_product.precio_oferta, selected_product.precio) * item_quantity, 2);
  end loop;
  order_total := round(order_total, 2);
  if order_total <= 0 then
    raise exception 'El total del pedido no es válido.';
  end if;

  initial_payment_status := case
    when p_payment_method = 'mobile_payment' then 'pending_verification'
    when p_payment_method = 'zelle' then 'awaiting_instructions'
    when p_fulfillment = 'delivery' then 'awaiting_delivery'
    else 'awaiting_in_store'
  end;

  insert into public.store_orders (
    id, user_id, customer_name, customer_phone, fulfillment, delivery_address,
    payment_method, payment_bank_code, payment_reference, payment_proof_path,
    exchange_rate, total_ves, total_usd, payment_status
  )
  values (
    p_order_id, auth.uid(), trim(p_customer_name), trim(p_customer_phone), p_fulfillment,
    nullif(trim(p_delivery_address), ''), p_payment_method,
    nullif(trim(p_payment_bank_code), ''), nullif(trim(p_payment_reference), ''),
    nullif(trim(p_payment_proof_path), ''),
    p_exchange_rate,
    case when p_exchange_rate is null then null else round(order_total * p_exchange_rate, 2) end,
    order_total, initial_payment_status
  )
  returning id into created_order_id;

  for item in
    select value from jsonb_array_elements(p_items)
    order by value ->> 'product_id'
  loop
    item_quantity := (item ->> 'quantity')::integer;
    select * into selected_product
    from public.productos
    where id = (item ->> 'product_id')::uuid
      and disponible = true
    for share;
    if not found then
      raise exception 'Un producto ya no está disponible. Actualiza el carrito.';
    end if;
    insert into public.store_order_items (
      order_id, product_id, product_name, presentation, quantity, unit_price_usd, line_total_usd
    )
    values (
      created_order_id, selected_product.id, selected_product.nombre, selected_product.presentacion,
      item_quantity, coalesce(selected_product.precio_oferta, selected_product.precio),
      round(coalesce(selected_product.precio_oferta, selected_product.precio) * item_quantity, 2)
    );
  end loop;

  return query select created_order_id, order_total, (
    case when p_exchange_rate is null then null else round(order_total * p_exchange_rate, 2) end
  ), initial_payment_status;
end;
$$;

revoke all on function public.create_store_order(uuid, text, text, text, text, text, text, text, text, numeric, jsonb) from public, anon;
grant execute on function public.create_store_order(uuid, text, text, text, text, text, text, text, text, numeric, jsonb) to authenticated;

create or replace function public.update_mobile_payment_reference(
  p_order_id uuid,
  p_payment_reference text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.store_orders%rowtype;
  v_reference text := btrim(coalesce(p_payment_reference, ''));
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para actualizar la referencia.';
  end if;

  if v_reference !~ '^[0-9]{4,20}$' then
    raise exception 'La referencia debe contener entre 4 y 20 dígitos.';
  end if;

  select *
  into v_order
  from public.store_orders
  where id = p_order_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'No se encontró el pedido.';
  end if;
  if v_order.payment_method <> 'mobile_payment'
     or v_order.payment_status <> 'pending_verification' then
    raise exception 'Solo se puede corregir la referencia de un Pago Móvil pendiente.';
  end if;

  update public.store_orders
  set payment_reference = v_reference,
      updated_at = now()
  where id = p_order_id;

  return 'pending_verification';
end;
$$;

revoke all on function public.update_mobile_payment_reference(uuid, text) from public, anon;
grant execute on function public.update_mobile_payment_reference(uuid, text) to authenticated;

do $$
begin
  alter table public.store_orders replica identity full;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'store_orders'
  ) then
    alter publication supabase_realtime add table public.store_orders;
  end if;
end
$$;
