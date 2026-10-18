begin;

create table if not exists public.product_image_rules (
  id uuid primary key default gen_random_uuid(),
  keywords text[] not null,
  image_url text not null,
  image_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_image_rules_keywords_valid
    check (
      cardinality(keywords) between 1 and 20
      and array_position(keywords, null) is null
      and not ('' = any(keywords))
    ),
  constraint product_image_rules_image_url_valid
    check (image_url ~ '^https?://'),
  constraint product_image_rules_image_path_valid
    check (btrim(image_path) <> '')
);

create index if not exists product_image_rules_keywords_gin_idx
  on public.product_image_rules using gin (keywords);

alter table public.product_image_rules enable row level security;

drop policy if exists "Admins manage product image rules" on public.product_image_rules;
create policy "Admins manage product image rules"
  on public.product_image_rules
  for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

revoke all on public.product_image_rules from public, anon;
grant select, insert, update, delete on public.product_image_rules to authenticated;

create or replace function public.apply_inventory_product_images(p_products jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_product jsonb;
  v_product_id uuid;
  v_updated_count integer := 0;
  v_rows_updated integer;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Solo el propietario puede asignar imágenes durante la importación.';
  end if;
  if p_products is null or jsonb_typeof(p_products) <> 'array' then
    raise exception 'Las imágenes deben enviarse como un arreglo JSON.';
  end if;
  if jsonb_array_length(p_products) < 1 or jsonb_array_length(p_products) > 200 then
    raise exception 'El bloque de imágenes debe contener entre 1 y 200 productos.';
  end if;

  for v_product in select value from jsonb_array_elements(p_products)
  loop
    if jsonb_typeof(v_product) <> 'object'
      or nullif(v_product ->> 'id', '') is null
      or nullif(v_product ->> 'image_url', '') is null
      or (v_product ->> 'image_url') !~ '^https?://'
      or length(v_product ->> 'image_url') > 2048 then
      raise exception 'Cada imagen requiere un id y una URL HTTP(S) válida.';
    end if;

    v_product_id := (v_product ->> 'id')::uuid;

    update public.productos as product
    set imagen_url = v_product ->> 'image_url',
        imagen_path = null,
        updated_at = now()
    where product.id = v_product_id
      and (
        product.imagen_url is null
        or btrim(product.imagen_url) = ''
        or product.imagen_url like '%imported-product-placeholder.svg%'
      );

    get diagnostics v_rows_updated = row_count;
    v_updated_count := v_updated_count + v_rows_updated;
  end loop;

  return v_updated_count;
end;
$$;

revoke all on function public.apply_inventory_product_images(jsonb) from public, anon;
grant execute on function public.apply_inventory_product_images(jsonb) to authenticated;

commit;
