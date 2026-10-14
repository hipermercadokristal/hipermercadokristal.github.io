create extension if not exists pgcrypto;

create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  departamento text not null
);

create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria_id uuid not null references public.categorias(id),
  precio numeric(10, 2) not null check (precio >= 0),
  precio_oferta numeric(10, 2) check (precio_oferta is null or precio_oferta >= 0),
  es_destacado boolean not null default false,
  disponible boolean not null default true,
  imagen_url text not null,
  imagen_path text,
  presentacion text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint precio_oferta_menor_que_regular check (precio_oferta is null or precio_oferta < precio)
);

create table if not exists public.producto_eventos (
  id smallint primary key default 1 check (id = 1),
  producto_id uuid not null,
  updated_at timestamptz not null default now()
);

insert into public.categorias (nombre, departamento) values
  ('Víveres y Alacena', 'Víveres y Alacena'),
  ('Harinas', 'Víveres y Alacena'),
  ('Arroz', 'Víveres y Alacena'),
  ('Pastas', 'Víveres y Alacena'),
  ('Aceites', 'Víveres y Alacena'),
  ('Lácteos', 'Víveres y Alacena'),
  ('Huevos', 'Carnes, Aves y Charcutería'),
  ('Bebidas, Licores y Tabaco', 'Bebidas, Licores y Tabaco'),
  ('Bebidas y Licores', 'Bebidas, Licores y Tabaco'),
  ('Maltas', 'Bebidas, Licores y Tabaco'),
  ('Refrescos', 'Bebidas, Licores y Tabaco'),
  ('Papel higiénico', 'Cuidado del Hogar y Limpieza'),
  ('Detergentes', 'Cuidado del Hogar y Limpieza'),
  ('Cuidado del Hogar y Limpieza', 'Cuidado del Hogar y Limpieza'),
  ('Frutas y Verduras', 'Frutas y Verduras'),
  ('Carnes, Aves y Charcutería', 'Carnes, Aves y Charcutería'),
  ('Snacks, Golosinas y Confitería', 'Snacks, Golosinas y Confitería'),
  ('Cuidado Personal e Higiene', 'Cuidado Personal e Higiene'),
  ('Hogar, Bazar y Utensilios', 'Hogar, Bazar y Utensilios'),
  ('Electrodomésticos y Ferretería', 'Electrodomésticos y Ferretería'),
  ('Mascotas', 'Mascotas'),
  ('Congelados', 'Congelados')
on conflict (nombre) do update set departamento = excluded.departamento;

alter table public.categorias enable row level security;
alter table public.productos enable row level security;
alter table public.producto_eventos enable row level security;
grant select on public.categorias to anon, authenticated;
grant insert, update, delete on public.categorias to authenticated;
grant select on public.productos to anon, authenticated;
grant insert, update, delete on public.productos to authenticated;
grant select on public.producto_eventos to anon, authenticated;

drop policy if exists "Public can read categories" on public.categorias;
create policy "Public can read categories"
  on public.categorias for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins can manage categories" on public.categorias;
create policy "Admins can manage categories"
  on public.categorias for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Public can read available products" on public.productos;
create policy "Public can read available products"
  on public.productos for select
  to anon, authenticated
  using (disponible = true);

drop policy if exists "Admins can manage products" on public.productos;
create policy "Admins can manage products"
  on public.productos for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Public can receive product change events" on public.producto_eventos;
create policy "Public can receive product change events"
  on public.producto_eventos for select
  to anon, authenticated
  using (true);

create or replace function public.registrar_evento_producto()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_product_id uuid;
begin
  changed_product_id := case when tg_op = 'DELETE' then old.id else new.id end;
  insert into public.producto_eventos (id, producto_id, updated_at)
  values (1, changed_product_id, now())
  on conflict (id) do update
  set producto_id = excluded.producto_id,
      updated_at = excluded.updated_at;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.registrar_evento_producto() from public, anon, authenticated;

drop trigger if exists productos_emitir_evento on public.productos;
create trigger productos_emitir_evento
  after insert or update or delete on public.productos
  for each row execute function public.registrar_evento_producto();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view product images" on storage.objects;
create policy "Public can view product images"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-images');

drop policy if exists "Admins can upload product images" on storage.objects;
create policy "Admins can upload product images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists "Admins can update product images" on storage.objects;
create policy "Admins can update product images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (
    bucket_id = 'product-images'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists "Admins can delete product images" on storage.objects;
create policy "Admins can delete product images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'producto_eventos'
  ) then
    alter publication supabase_realtime add table public.producto_eventos;
  end if;
end
$$;
