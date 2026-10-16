begin;

alter table public.productos
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

drop policy if exists "Public can read available products" on public.productos;
drop policy if exists "Admins can manage products" on public.productos;
drop policy if exists "Admins can read all products" on public.productos;
drop policy if exists "Admins can insert products" on public.productos;
drop policy if exists "Admins can update products" on public.productos;

create policy "Public can read available products"
  on public.productos for select
  to anon, authenticated
  using (disponible = true and deleted_at is null);

create policy "Admins can read all products"
  on public.productos for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can insert products"
  on public.productos for insert
  to authenticated
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "Admins can update products"
  on public.productos for update
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

revoke delete on public.productos from authenticated;

create or replace function public.archive_store_product(p_product_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted_at timestamptz;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Solo el propietario puede archivar productos.';
  end if;

  update public.productos
  set deleted_at = now(),
      deleted_by = auth.uid(),
      disponible = false,
      es_destacado = false,
      updated_at = now()
  where id = p_product_id
    and deleted_at is null
  returning deleted_at into v_deleted_at;

  if v_deleted_at is null then
    raise exception 'El producto no existe o ya está archivado.';
  end if;

  return v_deleted_at;
end;
$$;

create or replace function public.set_store_staff_role(
  p_email text,
  p_role text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user_id uuid;
  v_existing_role text;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Solo el propietario puede administrar los accesos del equipo.';
  end if;
  if p_role is null or p_role not in ('operator', 'courier') then
    raise exception 'Elige Caja u operador o Repartidor.';
  end if;
  if v_email = '' or length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Indica un correo válido de una cuenta existente.';
  end if;

  select users.id, users.raw_app_meta_data ->> 'role'
    into v_user_id, v_existing_role
  from auth.users as users
  where lower(users.email) = v_email
    and (users.banned_until is null or users.banned_until < now())
  for update;

  if v_user_id is null then
    raise exception 'No existe una cuenta activa con ese correo. Invítala primero desde Authentication → Users.';
  end if;
  if v_user_id = auth.uid() or v_existing_role = 'admin' then
    raise exception 'No puedes cambiar desde aquí una cuenta de propietario.';
  end if;

  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p_role)
  where id = v_user_id;

  return v_user_id;
end;
$$;

create or replace function public.scan_store_pickup_ticket(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'operator' then
    raise exception 'Solo el personal de caja puede validar tickets de retiro.';
  end if;

  select jsonb_build_object(
    'id', orders.id,
    'customer_name', orders.customer_name,
    'customer_phone', orders.customer_phone,
    'total_usd', orders.total_usd,
    'payment_status', orders.payment_status,
    'order_status', orders.order_status,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_name', items.product_name,
        'quantity', items.quantity,
        'line_total_usd', items.line_total_usd
      ) order by items.product_name)
      from public.store_order_items as items
      where items.order_id = orders.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.store_order_qr_tokens as tokens
  join public.store_orders as orders on orders.id = tokens.order_id
  where tokens.token = p_token
    and tokens.purpose = 'pickup'
    and tokens.expires_at > now()
    and tokens.consumed_at is null
    and orders.fulfillment = 'pickup'
    and orders.payment_method = 'cash_pos'
    and orders.payment_status = 'awaiting_in_store'
    and orders.order_status not in ('delivered', 'cancelled');

  if v_result is null then
    raise exception 'El ticket expiró, ya fue utilizado o no corresponde a un retiro pendiente.';
  end if;
  return v_result;
end;
$$;

revoke all on function public.archive_store_product(uuid) from public, anon;
revoke all on function public.set_store_staff_role(text, text) from public, anon;
revoke all on function public.scan_store_pickup_ticket(text) from public, anon;
grant execute on function public.archive_store_product(uuid) to authenticated;
grant execute on function public.set_store_staff_role(text, text) to authenticated;
grant execute on function public.scan_store_pickup_ticket(text) to authenticated;

commit;
