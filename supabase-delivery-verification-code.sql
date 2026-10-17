begin;

create table if not exists public.store_order_delivery_codes (
  order_id uuid primary key references public.store_orders(id) on delete cascade,
  code text not null check (code ~ '^[A-HJ-NP-Z2-9]{4}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table if not exists public.store_delivery_code_attempts (
  courier_id uuid primary key references auth.users(id) on delete cascade,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz
);

alter table public.store_order_delivery_codes enable row level security;
alter table public.store_delivery_code_attempts enable row level security;
revoke all on public.store_order_delivery_codes from public, anon, authenticated;
revoke all on public.store_delivery_code_attempts from public, anon, authenticated;

create or replace function public.issue_delivery_verification_code(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_order public.store_orders%rowtype;
  v_code text;
  v_random bytea;
  v_index integer;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesión para ver el código de entrega.';
  end if;

  select * into v_order
  from public.store_orders
  where id = p_order_id
    and user_id = auth.uid()
    and fulfillment = 'delivery'
    and order_status = 'delivering'
  for update;
  if not found then
    raise exception 'El código estará disponible cuando tu pedido vaya en camino.';
  end if;

  select code into v_code
  from public.store_order_delivery_codes
  where order_id = p_order_id
    and expires_at > now()
    and consumed_at is null
  for update;
  if found then
    return v_code;
  end if;

  loop
    v_random := extensions.gen_random_bytes(4);
    v_code := '';
    for v_index in 0..3 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_random, v_index) & 31) + 1, 1);
    end loop;
    perform pg_advisory_xact_lock(hashtextextended(v_code, 1));
    if exists (
      select 1
      from public.store_order_delivery_codes
      where code = v_code
        and order_id <> p_order_id
        and expires_at > now()
        and consumed_at is null
    ) then
      continue;
    end if;

    insert into public.store_order_delivery_codes (order_id, code, expires_at, consumed_at)
    values (p_order_id, v_code, now() + interval '24 hours', null)
    on conflict (order_id) do update
    set code = excluded.code,
        expires_at = excluded.expires_at,
        consumed_at = null;
    return v_code;
  end loop;
end;
$$;

create or replace function public.complete_delivery_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
  v_courier_id uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
  v_order_id uuid;
  v_attempts public.store_delivery_code_attempts%rowtype;
begin
  if v_role not in ('admin', 'courier') or v_courier_id is null then
    raise exception 'Solo el repartidor autorizado puede confirmar una entrega.';
  end if;

  insert into public.store_delivery_code_attempts (courier_id)
  values (v_courier_id)
  on conflict (courier_id) do nothing;

  select * into v_attempts
  from public.store_delivery_code_attempts
  where courier_id = v_courier_id
  for update;

  if v_attempts.locked_until > now() then
    return jsonb_build_object(
      'success', false,
      'message', 'Se alcanzó el límite de intentos. Vuelve a probar después de 15 minutos.'
    );
  end if;
  if v_attempts.locked_until is not null then
    update public.store_delivery_code_attempts
    set failed_attempts = 0,
        locked_until = null
    where courier_id = v_courier_id;
  end if;

  if v_code ~ '^[A-HJ-NP-Z2-9]{4}$' then
    select orders.id into v_order_id
    from public.store_order_delivery_codes as codes
    join public.store_orders as orders on orders.id = codes.order_id
    where codes.code = v_code
      and codes.expires_at > now()
      and codes.consumed_at is null
      and orders.fulfillment = 'delivery'
      and orders.order_status = 'delivering'
      and (v_role = 'admin' or orders.assigned_courier_id = v_courier_id)
    for update of codes, orders;
  end if;

  if v_order_id is null then
    update public.store_delivery_code_attempts
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
    where courier_id = v_courier_id
    returning * into v_attempts;
    return jsonb_build_object(
      'success', false,
      'message', case
        when v_attempts.locked_until > now() then 'Código incorrecto. Se alcanzó el límite; vuelve a probar después de 15 minutos.'
        else 'El código no es válido, expiró o no corresponde a una entrega asignada a tu cuenta.'
      end
    );
  end if;

  update public.store_order_delivery_codes
  set consumed_at = now()
  where order_id = v_order_id and consumed_at is null;
  if not found then
    return jsonb_build_object('success', false, 'message', 'El código ya fue utilizado.');
  end if;

  update public.store_order_qr_tokens
  set consumed_at = now()
  where order_id = v_order_id
    and purpose = 'delivery'
    and consumed_at is null;

  update public.store_orders
  set order_status = 'delivered',
      updated_at = now()
  where id = v_order_id
    and order_status = 'delivering';
  if not found then
    raise exception 'No se pudo completar el pedido; actualiza e inténtalo de nuevo.';
  end if;

  update public.store_delivery_code_attempts
  set failed_attempts = 0,
      locked_until = null
  where courier_id = v_courier_id;

  return jsonb_build_object('success', true, 'order_id', v_order_id);
end;
$$;

revoke all on function public.issue_delivery_verification_code(uuid) from public, anon;
revoke all on function public.complete_delivery_by_code(text) from public, anon;
grant execute on function public.issue_delivery_verification_code(uuid) to authenticated;
grant execute on function public.complete_delivery_by_code(text) to authenticated;

commit;
