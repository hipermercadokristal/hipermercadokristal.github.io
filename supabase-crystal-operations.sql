begin;

alter table public.productos
  add column if not exists codigo_barras text,
  add column if not exists precio_ves numeric(14, 2),
  add column if not exists stock numeric(14, 3) not null default 0;

alter table public.productos
  drop constraint if exists productos_stock_nonnegative,
  drop constraint if exists productos_precio_ves_nonnegative,
  add constraint productos_stock_nonnegative check (stock >= 0),
  add constraint productos_precio_ves_nonnegative check (precio_ves is null or precio_ves >= 0);

create unique index if not exists productos_codigo_barras_uidx
  on public.productos (codigo_barras);

alter table public.store_orders
  add column if not exists customer_document text,
  add column if not exists delivery_reference text,
  add column if not exists delivery_latitude numeric(10, 7),
  add column if not exists delivery_longitude numeric(10, 7);

alter table public.store_orders
  drop constraint if exists store_orders_delivery_coordinates_pair,
  add constraint store_orders_delivery_coordinates_pair check (
    (delivery_latitude is null and delivery_longitude is null)
    or (
      delivery_latitude is not null
      and delivery_longitude is not null
      and
      delivery_latitude between -90 and 90
      and delivery_longitude between -180 and 180
    )
  );

create index if not exists store_orders_customer_document_idx
  on public.store_orders (customer_document)
  where customer_document is not null;

create or replace function public.create_store_order_with_location(
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
  p_items jsonb,
  p_customer_document text,
  p_delivery_reference text,
  p_delivery_latitude numeric,
  p_delivery_longitude numeric
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
  created_order record;
  normalized_document text;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para confirmar el pedido.';
  end if;
  if p_customer_document is not null
    and (
      length(btrim(p_customer_document)) > 30
      or btrim(p_customer_document) !~* '^[a-z0-9][a-z0-9 .-]{3,29}$'
    ) then
    raise exception 'Indica una cédula o documento válido.';
  end if;
  if p_fulfillment = 'delivery' then
    if nullif(btrim(coalesce(p_delivery_reference, '')), '') is null
      or length(p_delivery_reference) > 200 then
      raise exception 'Indica un punto de referencia de entrega válido.';
    end if;
    if (p_delivery_latitude is null) <> (p_delivery_longitude is null)
      or (p_delivery_latitude is not null and (
        p_delivery_latitude not between -90 and 90
        or p_delivery_longitude not between -180 and 180
      )) then
      raise exception 'Las coordenadas de ubicación no son válidas.';
    end if;
  end if;

  select *
    into created_order
  from public.create_store_order(
    p_order_id,
    p_customer_name,
    p_customer_phone,
    p_fulfillment,
    p_delivery_address,
    p_payment_method,
    p_payment_bank_code,
    p_payment_reference,
    p_payment_proof_path,
    p_exchange_rate,
    p_items
  );

  normalized_document := nullif(upper(regexp_replace(btrim(coalesce(p_customer_document, '')), '[^A-Za-z0-9]', '', 'g')), '');
  update public.store_orders
  set customer_document = normalized_document,
      delivery_reference = case when p_fulfillment = 'delivery' then nullif(btrim(p_delivery_reference), '') else null end,
      delivery_latitude = case when p_fulfillment = 'delivery' then p_delivery_latitude else null end,
      delivery_longitude = case when p_fulfillment = 'delivery' then p_delivery_longitude else null end
  where id = created_order.order_id
    and user_id = auth.uid();

  if not found then
    raise exception 'No se pudo guardar la información de entrega.';
  end if;

  return query select
    created_order.order_id,
    created_order.total_usd,
    created_order.total_ves,
    created_order.payment_status;
end;
$$;

create or replace function public.find_store_pickup_orders_by_document(p_document text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_document text;
  result jsonb;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'operator' then
    raise exception 'Solo el personal de caja puede buscar pedidos para retiro.';
  end if;
  normalized_document := upper(regexp_replace(btrim(coalesce(p_document, '')), '[^A-Za-z0-9]', '', 'g'));
  if length(normalized_document) < 5 or length(normalized_document) > 30 then
    raise exception 'Indica una cédula o documento válido para buscar.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', orders.id,
    'customer_name', orders.customer_name,
    'customer_phone', orders.customer_phone,
    'total_usd', orders.total_usd,
    'payment_status', orders.payment_status,
    'order_status', orders.order_status,
    'created_at', orders.created_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_name', items.product_name,
        'quantity', items.quantity,
        'line_total_usd', items.line_total_usd
      ) order by items.product_name)
      from public.store_order_items as items
      where items.order_id = orders.id
    ), '[]'::jsonb)
  ) order by orders.created_at desc), '[]'::jsonb)
    into result
  from public.store_orders as orders
  where upper(regexp_replace(coalesce(orders.customer_document, ''), '[^A-Za-z0-9]', '', 'g')) = normalized_document
    and orders.fulfillment = 'pickup'
    and orders.payment_method = 'cash_pos'
    and orders.payment_status in ('awaiting_in_store', 'verified')
    and orders.order_status = 'ready';

  return result;
end;
$$;

create or replace function public.scan_store_pickup_ticket(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
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
    into result
  from public.store_order_qr_tokens as tokens
  join public.store_orders as orders on orders.id = tokens.order_id
  where tokens.token = p_token
    and tokens.purpose = 'pickup'
    and tokens.expires_at > now()
    and tokens.consumed_at is null
    and orders.fulfillment = 'pickup'
    and orders.payment_method = 'cash_pos'
    and orders.payment_status in ('awaiting_in_store', 'verified')
    and orders.order_status not in ('delivered', 'cancelled');

  if result is null then
    raise exception 'El ticket expiró, ya fue utilizado o no corresponde a un retiro pendiente.';
  end if;
  return result;
end;
$$;

create or replace function public.complete_store_pickup_by_qr(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'operator' then
    raise exception 'Solo el personal de caja puede confirmar retiros.';
  end if;

  select orders.id
    into v_order_id
  from public.store_order_qr_tokens as tokens
  join public.store_orders as orders on orders.id = tokens.order_id
  where tokens.token = p_token
    and tokens.purpose = 'pickup'
    and tokens.expires_at > now()
    and tokens.consumed_at is null
    and orders.fulfillment = 'pickup'
    and orders.payment_method = 'cash_pos'
    and orders.payment_status in ('awaiting_in_store', 'verified')
    and orders.order_status = 'ready'
  for update of tokens, orders;

  if v_order_id is null then
    raise exception 'El pedido no está listo, ya fue procesado o el ticket no es válido.';
  end if;

  update public.store_orders
  set order_status = 'delivered',
      payment_status = 'verified',
      updated_at = now()
  where id = v_order_id;
  update public.store_order_qr_tokens
  set consumed_at = now()
  where order_id = v_order_id
    and purpose = 'pickup'
    and consumed_at is null;

  return v_order_id;
end;
$$;

create or replace function public.complete_store_pickup_by_document(
  p_document text,
  p_order_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_document text;
  v_order_id uuid;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'operator' then
    raise exception 'Solo el personal de caja puede confirmar retiros.';
  end if;
  normalized_document := upper(regexp_replace(btrim(coalesce(p_document, '')), '[^A-Za-z0-9]', '', 'g'));
  if length(normalized_document) < 5 or length(normalized_document) > 30 then
    raise exception 'Indica una cédula o documento válido para confirmar.';
  end if;

  select orders.id
    into v_order_id
  from public.store_orders as orders
  where orders.id = p_order_id
    and upper(regexp_replace(coalesce(orders.customer_document, ''), '[^A-Za-z0-9]', '', 'g')) = normalized_document
    and orders.fulfillment = 'pickup'
    and orders.payment_method = 'cash_pos'
    and orders.payment_status in ('awaiting_in_store', 'verified')
    and orders.order_status = 'ready'
  for update;

  if v_order_id is null then
    raise exception 'El documento no coincide o el pedido no está listo para entregar.';
  end if;

  update public.store_orders
  set order_status = 'delivered',
      payment_status = 'verified',
      updated_at = now()
  where id = v_order_id;
  update public.store_order_qr_tokens
  set consumed_at = now()
  where order_id = v_order_id
    and purpose = 'pickup'
    and consumed_at is null;

  return v_order_id;
end;
$$;

create or replace function public.admin_store_sales_summary()
returns table (
  orders_today bigint,
  gross_today numeric,
  verified_today numeric,
  pending_payments bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Solo el propietario puede consultar las métricas de ventas.';
  end if;

  return query
  select
    count(*)::bigint,
    coalesce(sum(orders.total_usd), 0)::numeric,
    coalesce(sum(orders.total_usd) filter (where orders.payment_status = 'verified'), 0)::numeric,
    count(*) filter (where orders.payment_status in ('pending_verification', 'awaiting_instructions', 'awaiting_in_store', 'awaiting_delivery'))::bigint
  from public.store_orders as orders
  where orders.created_at >= (
    date_trunc('day', now() at time zone 'America/Caracas')
    at time zone 'America/Caracas'
  )
    and orders.order_status <> 'cancelled';
end;
$$;

revoke all on function public.create_store_order_with_location(uuid, text, text, text, text, text, text, text, text, numeric, jsonb, text, text, numeric, numeric) from public, anon;
revoke all on function public.find_store_pickup_orders_by_document(text) from public, anon;
revoke all on function public.scan_store_pickup_ticket(text) from public, anon;
revoke all on function public.complete_store_pickup_by_qr(text) from public, anon;
revoke all on function public.complete_store_pickup_by_document(text, uuid) from public, anon;
revoke all on function public.admin_store_sales_summary() from public, anon;
grant execute on function public.create_store_order_with_location(uuid, text, text, text, text, text, text, text, text, numeric, jsonb, text, text, numeric, numeric) to authenticated;
grant execute on function public.find_store_pickup_orders_by_document(text) to authenticated;
grant execute on function public.scan_store_pickup_ticket(text) to authenticated;
grant execute on function public.complete_store_pickup_by_qr(text) to authenticated;
grant execute on function public.complete_store_pickup_by_document(text, uuid) to authenticated;
grant execute on function public.admin_store_sales_summary() to authenticated;

commit;
