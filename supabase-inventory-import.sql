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

revoke all on function public.resolve_inventory_departments(text[]) from public, anon;
grant execute on function public.resolve_inventory_departments(text[]) to authenticated;

commit;
