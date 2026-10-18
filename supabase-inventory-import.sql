begin;

create or replace function public.resolve_inventory_departments(p_names text[])
returns table (normalized_department text, category_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_input text;
  v_clean text;
  v_key text;
  v_category_id uuid;
  v_seen text[] := array[]::text[];
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Solo el propietario puede importar departamentos.';
  end if;
  if p_names is null then
    raise exception 'No se recibieron departamentos para resolver.';
  end if;

  foreach v_input in array p_names loop
    v_clean := regexp_replace(btrim(coalesce(v_input, '')), '\s+', ' ', 'g');
    if v_clean = '' or length(v_clean) > 120 then
      raise exception 'El nombre de un departamento está vacío o supera 120 caracteres.';
    end if;
    v_key := regexp_replace(
      lower(translate(v_clean, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
      '[^a-z0-9]',
      '',
      'g'
    );
    if v_key = '' then
      raise exception 'No se pudo normalizar el nombre de un departamento.';
    end if;
    if v_key = any(v_seen) then
      continue;
    end if;
    v_seen := array_append(v_seen, v_key);

    perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
    select category.id
      into v_category_id
    from public.categorias as category
    where regexp_replace(
        lower(translate(category.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
        '[^a-z0-9]',
        '',
        'g'
      ) = v_key
      or regexp_replace(
        lower(translate(category.departamento, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
        '[^a-z0-9]',
        '',
        'g'
      ) = v_key
    order by (
      regexp_replace(
        lower(translate(category.nombre, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
        '[^a-z0-9]',
        '',
        'g'
      ) = v_key
    ) desc, category.id
    limit 1;

    if v_category_id is null then
      insert into public.categorias (nombre, departamento)
      values (initcap(v_clean), initcap(v_clean))
      returning id into v_category_id;
    end if;

    normalized_department := v_key;
    category_id := v_category_id;
    return next;
  end loop;
end;
$$;

create or replace function public.apply_inventory_product_updates(p_products jsonb)
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
    raise exception 'Solo el propietario puede importar actualizaciones de productos.';
  end if;
  if p_products is null or jsonb_typeof(p_products) <> 'array' then
    raise exception 'Las actualizaciones deben enviarse como un arreglo JSON.';
  end if;
  if jsonb_array_length(p_products) < 1 or jsonb_array_length(p_products) > 200 then
    raise exception 'El bloque de actualización debe contener entre 1 y 200 productos.';
  end if;

  for v_product in select value from jsonb_array_elements(p_products)
  loop
    if jsonb_typeof(v_product) <> 'object'
      or nullif(v_product ->> 'id', '') is null
      or nullif(v_product ->> 'nombre', '') is null
      or nullif(v_product ->> 'precio', '') is null then
      raise exception 'Cada actualización requiere id, nombre y precio.';
    end if;

    v_product_id := (v_product ->> 'id')::uuid;

    update public.productos as product
    set nombre = v_product ->> 'nombre',
        precio = (v_product ->> 'precio')::numeric,
        precio_oferta = case
          when coalesce((v_product ->> 'precio_oferta_provided')::boolean, false)
            then nullif(v_product ->> 'precio_oferta', '')::numeric
          else product.precio_oferta
        end,
        precio_ves = case
          when coalesce((v_product ->> 'precio_ves_provided')::boolean, false)
            then nullif(v_product ->> 'precio_ves', '')::numeric
          else product.precio_ves
        end,
        stock = case
          when coalesce((v_product ->> 'stock_provided')::boolean, false)
            then nullif(v_product ->> 'stock', '')::numeric
          else product.stock
        end,
        stock_tracked = case
          when coalesce((v_product ->> 'stock_provided')::boolean, false) then true
          else product.stock_tracked
        end,
        imagen_url = case
          when coalesce((v_product ->> 'reset_image')::boolean, false)
            then '/assets/products/imported-product-placeholder.svg'
          else product.imagen_url
        end,
        imagen_path = case
          when coalesce((v_product ->> 'reset_image')::boolean, false) then null
          else product.imagen_path
        end,
        updated_at = now()
    where product.id = v_product_id;

    get diagnostics v_rows_updated = row_count;
    if v_rows_updated <> 1 then
      raise exception 'No se encontró el producto % para actualizar.', v_product_id;
    end if;
    v_updated_count := v_updated_count + v_rows_updated;
  end loop;

  return v_updated_count;
end;
$$;

revoke all on function public.resolve_inventory_departments(text[]) from public, anon;
revoke all on function public.apply_inventory_product_updates(jsonb) from public, anon;
grant execute on function public.resolve_inventory_departments(text[]) to authenticated;
grant execute on function public.apply_inventory_product_updates(jsonb) to authenticated;

commit;
