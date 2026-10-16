begin;

alter table public.store_orders
  add column if not exists assigned_courier_id uuid references auth.users(id) on delete set null;

create index if not exists store_orders_courier_status_idx
  on public.store_orders (assigned_courier_id, order_status, created_at desc)
  where fulfillment = 'delivery';

drop policy if exists "Customers and admins can read orders" on public.store_orders;
create policy "Customers and authorized staff can read orders"
  on public.store_orders for select to authenticated
  using (
    user_id = (select auth.uid())
    or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'operator')
    or (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'courier'
      and assigned_courier_id = (select auth.uid())
    )
  );

drop policy if exists "Customers and admins can read order items" on public.store_order_items;
create policy "Customers and authorized staff can read order items"
  on public.store_order_items for select to authenticated
  using (
    exists (
      select 1
      from public.store_orders orders
      where orders.id = order_id
        and (
          orders.user_id = (select auth.uid())
          or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'operator')
          or (
            (auth.jwt() -> 'app_metadata' ->> 'role') = 'courier'
            and orders.assigned_courier_id = (select auth.uid())
          )
        )
    )
  );

drop policy if exists "Customers and admins can view payment proofs" on storage.objects;
create policy "Customers and payment staff can view payment proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'operator')
    )
  );

create or replace function public.list_delivery_couriers()
returns table (id uuid, full_name text, phone text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('admin', 'operator') then
    raise exception 'Solo administración o caja puede consultar el equipo de reparto.';
  end if;

  return query
  select
    users.id,
    coalesce(nullif(profiles.full_name, ''), nullif(users.raw_user_meta_data ->> 'full_name', ''), 'Repartidor'),
    coalesce(nullif(profiles.phone, ''), nullif(users.raw_user_meta_data ->> 'phone', ''), '')
  from auth.users as users
  left join public.customer_profiles as profiles on profiles.user_id = users.id
  where users.raw_app_meta_data ->> 'role' = 'courier'
    and (users.banned_until is null or users.banned_until < now())
  order by 2, users.id;
end;
$$;

create or replace function public.assign_store_order_courier(
  p_order_id uuid,
  p_courier_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.store_orders%rowtype;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('admin', 'operator') then
    raise exception 'Solo administración o caja puede asignar repartidores.';
  end if;
  if p_courier_id is null or not exists (
    select 1
    from auth.users as users
    where users.id = p_courier_id
      and users.raw_app_meta_data ->> 'role' = 'courier'
      and (users.banned_until is null or users.banned_until < now())
  ) then
    raise exception 'Selecciona una cuenta activa con rol de repartidor.';
  end if;

  select * into v_order
  from public.store_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'No se encontró el pedido.';
  end if;
  if v_order.fulfillment <> 'delivery'
    or v_order.order_status not in ('ready', 'delivering')
    or v_order.payment_status not in ('verified', 'awaiting_delivery') then
    raise exception 'El pedido debe ser delivery, estar listo y tener el pago autorizado para salir.';
  end if;

  update public.store_orders
  set assigned_courier_id = p_courier_id,
      order_status = 'delivering',
      updated_at = now()
  where id = p_order_id;
  return p_order_id;
end;
$$;

create or replace function public.set_store_order_payment_status(
  p_order_id uuid,
  p_decision text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.store_orders%rowtype;
  v_status text;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('admin', 'operator') then
    raise exception 'Solo caja o administración puede validar pagos.';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'La decisión de pago no es válida.';
  end if;

  select * into v_order
  from public.store_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'No se encontró el pedido.';
  end if;

  if p_decision = 'reject' then
    if v_order.payment_method <> 'mobile_payment' or v_order.payment_status <> 'pending_verification' then
      raise exception 'Solo se puede rechazar un Pago Móvil pendiente de verificación.';
    end if;
    v_status := 'rejected';
  else
    if v_order.payment_status not in ('pending_verification', 'awaiting_instructions', 'awaiting_in_store', 'awaiting_delivery') then
      raise exception 'Este pago ya fue procesado.';
    end if;
    v_status := 'verified';
  end if;

  update public.store_orders
  set payment_status = v_status, updated_at = now()
  where id = p_order_id;
  return v_status;
end;
$$;

create or replace function public.set_store_order_status(
  p_order_id uuid,
  p_order_status text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.store_orders%rowtype;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') not in ('admin', 'operator') then
    raise exception 'Solo caja o administración puede actualizar el estado del pedido.';
  end if;
  if p_order_status is null or p_order_status not in ('received', 'preparing', 'ready', 'delivered', 'cancelled') then
    raise exception 'Usa el flujo de asignación para iniciar un delivery o el QR para confirmarlo.';
  end if;

  select * into v_order
  from public.store_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'No se encontró el pedido.';
  end if;
  if v_order.order_status in ('delivered', 'cancelled') then
    raise exception 'El pedido ya está cerrado y no admite más cambios.';
  end if;
  if p_order_status <> v_order.order_status
    and not (
      (v_order.order_status = 'received' and p_order_status in ('preparing', 'cancelled'))
      or (v_order.order_status = 'preparing' and p_order_status in ('ready', 'cancelled'))
      or (v_order.order_status = 'ready' and p_order_status in ('preparing', 'cancelled'))
      or (v_order.order_status = 'delivering' and p_order_status = 'cancelled')
    ) then
    raise exception 'El pedido debe avanzar por los estados de preparación en orden.';
  end if;
  if p_order_status = 'delivered' and v_order.fulfillment = 'delivery' then
    raise exception 'El delivery solo se completa escaneando el QR del cliente.';
  end if;
  if p_order_status = 'delivered' and (
    v_order.order_status <> 'ready'
    or v_order.payment_status not in ('verified', 'awaiting_in_store')
  ) then
    raise exception 'El pedido de retiro debe estar listo y el pago autorizado antes de cerrarlo.';
  end if;

  update public.store_orders
  set order_status = p_order_status,
      updated_at = now()
  where id = p_order_id;
  return p_order_status;
end;
$$;

create or replace function public.complete_delivery_by_qr(p_token text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order_id uuid;
  v_role text := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
begin
  if v_role not in ('admin', 'courier') then
    raise exception 'Solo el repartidor asignado puede confirmar la entrega.';
  end if;

  select orders.id into v_order_id
  from public.store_order_qr_tokens as tokens
  join public.store_orders as orders on orders.id = tokens.order_id
  where tokens.token = p_token
    and tokens.purpose = 'delivery'
    and tokens.expires_at > now()
    and tokens.consumed_at is null
    and orders.fulfillment = 'delivery'
    and orders.order_status = 'delivering'
    and (v_role = 'admin' or orders.assigned_courier_id = auth.uid())
  for update of tokens, orders;

  if v_order_id is null then
    raise exception 'El código expiró, ya fue utilizado o el pedido no está asignado a esta cuenta.';
  end if;

  update public.store_order_qr_tokens
  set consumed_at = now()
  where token = p_token and purpose = 'delivery' and consumed_at is null;
  if not found then
    raise exception 'El código ya fue utilizado por otra sesión.';
  end if;

  update public.store_orders
  set order_status = 'delivered', updated_at = now()
  where id = v_order_id and order_status = 'delivering';
  if not found then
    raise exception 'No se pudo completar el pedido; actualiza e inténtalo de nuevo.';
  end if;
  return v_order_id;
end;
$$;

revoke all on function public.list_delivery_couriers() from public, anon;
revoke all on function public.assign_store_order_courier(uuid, uuid) from public, anon;
revoke all on function public.set_store_order_payment_status(uuid, text) from public, anon;
revoke all on function public.set_store_order_status(uuid, text) from public, anon;
revoke all on function public.complete_delivery_by_qr(text) from public, anon;

grant execute on function public.list_delivery_couriers() to authenticated;
grant execute on function public.assign_store_order_courier(uuid, uuid) to authenticated;
grant execute on function public.set_store_order_payment_status(uuid, text) to authenticated;
grant execute on function public.set_store_order_status(uuid, text) to authenticated;
grant execute on function public.complete_delivery_by_qr(text) to authenticated;

commit;
