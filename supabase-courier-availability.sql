begin;

create table if not exists public.courier_availability (
  courier_id uuid primary key references auth.users(id) on delete cascade,
  availability text not null default 'offline'
    check (availability in ('available', 'on_route', 'offline')),
  updated_at timestamptz not null default now()
);

alter table public.courier_availability enable row level security;

drop policy if exists "Couriers can view own availability" on public.courier_availability;
create policy "Couriers can view own availability"
  on public.courier_availability for select to authenticated
  using (
    courier_id = (select auth.uid())
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'courier'
  );

drop policy if exists "Authorized staff can view courier availability" on public.courier_availability;
create policy "Authorized staff can view courier availability"
  on public.courier_availability for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('admin', 'operator'));

drop policy if exists "Couriers can create own availability" on public.courier_availability;
create policy "Couriers can create own availability"
  on public.courier_availability for insert to authenticated
  with check (
    courier_id = (select auth.uid())
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'courier'
  );

drop policy if exists "Couriers can update own availability" on public.courier_availability;
create policy "Couriers can update own availability"
  on public.courier_availability for update to authenticated
  using (
    courier_id = (select auth.uid())
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'courier'
  )
  with check (
    courier_id = (select auth.uid())
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'courier'
  );

grant select, insert, update on public.courier_availability to authenticated;
revoke all on public.courier_availability from public, anon;

commit;
