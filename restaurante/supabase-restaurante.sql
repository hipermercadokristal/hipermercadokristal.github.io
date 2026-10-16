create table if not exists public.restaurant_categories (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.restaurant_products (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria_id uuid not null references public.restaurant_categories(id),
  precio numeric(10, 2) not null check (precio > 0),
  descripcion text,
  disponible boolean not null default true,
  imagen_url text not null,
  imagen_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.restaurant_product_events (
  id smallint primary key default 1 check (id = 1),
  product_id uuid not null,
  updated_at timestamptz not null default now()
);

insert into public.restaurant_categories (nombre) values
  ('Entradas'),
  ('Sopas'),
  ('Arroces'),
  ('Tallarines'),
  ('Chop suey y vegetales'),
  ('Pollo'),
  ('Carnes y mariscos'),
  ('Carnes y cerdo'),
  ('Mariscos'),
  ('Especialidades'),
  ('Combos'),
  ('Buffet'),
  ('Bebidas')
on conflict (nombre) do nothing;

alter table public.restaurant_categories enable row level security;
alter table public.restaurant_products enable row level security;
alter table public.restaurant_product_events enable row level security;

grant select on public.restaurant_categories to anon, authenticated;
grant insert, update, delete on public.restaurant_categories to authenticated;
grant select on public.restaurant_products to anon, authenticated;
grant insert, update, delete on public.restaurant_products to authenticated;
grant select on public.restaurant_product_events to anon, authenticated;

drop policy if exists "Anyone can read restaurant categories" on public.restaurant_categories;
create policy "Anyone can read restaurant categories"
  on public.restaurant_categories for select
  to anon, authenticated using (true);

drop policy if exists "Admins can manage restaurant categories" on public.restaurant_categories;
create policy "Admins can manage restaurant categories"
  on public.restaurant_categories for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Anyone can read available restaurant dishes" on public.restaurant_products;
create policy "Anyone can read available restaurant dishes"
  on public.restaurant_products for select
  to anon, authenticated using (disponible = true);

drop policy if exists "Admins can manage restaurant dishes" on public.restaurant_products;
create policy "Admins can manage restaurant dishes"
  on public.restaurant_products for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Anyone can read restaurant product events" on public.restaurant_product_events;
create policy "Anyone can read restaurant product events"
  on public.restaurant_product_events for select
  to anon, authenticated using (true);

create or replace function public.registrar_evento_producto_restaurante()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_product_id uuid;
begin
  changed_product_id := case when tg_op = 'DELETE' then old.id else new.id end;
  insert into public.restaurant_product_events (id, product_id, updated_at)
  values (1, changed_product_id, now())
  on conflict (id) do update
  set product_id = excluded.product_id,
      updated_at = excluded.updated_at;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function public.registrar_evento_producto_restaurante() from public, anon, authenticated;

drop trigger if exists restaurant_products_emit_event on public.restaurant_products;
create trigger restaurant_products_emit_event
  after insert or update or delete on public.restaurant_products
  for each row execute function public.registrar_evento_producto_restaurante();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('restaurant-images', 'restaurant-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view restaurant images" on storage.objects;
create policy "Public can view restaurant images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'restaurant-images');

drop policy if exists "Admins can upload restaurant images" on storage.objects;
create policy "Admins can upload restaurant images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'restaurant-images'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists "Admins can update restaurant images" on storage.objects;
create policy "Admins can update restaurant images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'restaurant-images'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (
    bucket_id = 'restaurant-images'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists "Admins can delete restaurant images" on storage.objects;
create policy "Admins can delete restaurant images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'restaurant-images'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'restaurant_product_events'
  ) then
    alter publication supabase_realtime add table public.restaurant_product_events;
  end if;
end
$$;
