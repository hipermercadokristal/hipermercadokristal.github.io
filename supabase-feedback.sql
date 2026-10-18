create extension if not exists pgcrypto;

create table if not exists public.store_feedback (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  kind text not null check (kind in ('opinion', 'pregunta')),
  rating smallint,
  message text not null check (char_length(btrim(message)) between 1 and 1200),
  created_at timestamptz not null default now(),
  constraint store_feedback_rating_matches_kind check (
    (kind = 'opinion' and rating between 1 and 5)
    or (kind = 'pregunta' and rating is null)
  )
);

create index if not exists store_feedback_created_at_idx
  on public.store_feedback (created_at desc);

alter table public.store_feedback enable row level security;

revoke all on public.store_feedback from public, anon, authenticated;
grant select on public.store_feedback to anon, authenticated;
grant insert (display_name, kind, rating, message)
  on public.store_feedback to anon, authenticated;

drop policy if exists "Public can read published feedback" on public.store_feedback;
create policy "Public can read published feedback"
  on public.store_feedback for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can publish feedback" on public.store_feedback;
create policy "Public can publish feedback"
  on public.store_feedback for insert
  to anon, authenticated
  with check (
    char_length(btrim(display_name)) between 1 and 80
    and char_length(btrim(message)) between 1 and 1200
    and (
      (kind = 'opinion' and rating between 1 and 5)
      or (kind = 'pregunta' and rating is null)
    )
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'store_feedback'
     ) then
    execute 'alter publication supabase_realtime add table public.store_feedback';
  end if;
end;
$$;
