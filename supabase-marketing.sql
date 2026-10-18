alter table public.productos
  add column if not exists es_oferta_dia boolean not null default false,
  add column if not exists oferta_dia_hasta timestamptz;

create table if not exists public.store_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  image_url text not null,
  image_path text not null,
  link_url text not null default '/catalogo',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_announcement (
  id smallint primary key default 1 check (id = 1),
  message text not null default '',
  active boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.store_announcement (id, message, active)
values (1, '', false)
on conflict (id) do nothing;

alter table public.store_banners enable row level security;
alter table public.store_announcement enable row level security;

drop policy if exists "Public can read active store banners" on public.store_banners;
create policy "Public can read active store banners"
  on public.store_banners for select
  to anon, authenticated
  using (active = true);

drop policy if exists "Admins can manage store banners" on public.store_banners;
create policy "Admins can manage store banners"
  on public.store_banners for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "Public can read active store announcement" on public.store_announcement;
create policy "Public can read active store announcement"
  on public.store_announcement for select
  to anon, authenticated
  using (active = true);

drop policy if exists "Admins can manage store announcement" on public.store_announcement;
create policy "Admins can manage store announcement"
  on public.store_announcement for all
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

grant select on public.store_banners, public.store_announcement to anon, authenticated;
grant insert, update, delete on public.store_banners, public.store_announcement to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing-assets', 'marketing-assets', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view marketing assets" on storage.objects;
create policy "Public can view marketing assets"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'marketing-assets');

drop policy if exists "Admins can upload marketing assets" on storage.objects;
create policy "Admins can upload marketing assets"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'marketing-assets'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists "Admins can update marketing assets" on storage.objects;
create policy "Admins can update marketing assets"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'marketing-assets'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (
    bucket_id = 'marketing-assets'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists "Admins can delete marketing assets" on storage.objects;
create policy "Admins can delete marketing assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'marketing-assets'
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'store_banners'
  ) then
    alter publication supabase_realtime add table public.store_banners;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'store_announcement'
  ) then
    alter publication supabase_realtime add table public.store_announcement;
  end if;
end
$$;
