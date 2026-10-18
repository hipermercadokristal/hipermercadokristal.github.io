begin;

create or replace function public.purge_deleted_store_products()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted_count integer;
begin
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin' then
    raise exception 'Solo el propietario puede vaciar la papelera de productos.';
  end if;

  delete from public.productos
  where deleted_at is not null;

  get diagnostics v_deleted_count = row_count;
  return v_deleted_count;
end;
$$;

revoke all on function public.purge_deleted_store_products() from public, anon;
grant execute on function public.purge_deleted_store_products() to authenticated;

commit;
