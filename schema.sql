-- Trade-in Slots: database setup for a SHARED Supabase project.
-- Paste the whole file into Supabase > SQL Editor and run it once.
-- It is safe to run again.
--
-- Everything this file creates starts with "tradein_".
-- It does not change, drop or read any other table, trigger or setting in the project.
-- It does not touch existing users.

-- ---------------------------------------------------------------- tables

-- Who may use the trade-in tool, and in which role.
-- A login with no row here can sign in but sees nothing.
create table if not exists public.tradein_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  full_name text not null default '',
  role text not null default 'pending' check (role in ('admin', 'manager', 'sales', 'pending')),
  created_at timestamptz not null default now()
);

create table if not exists public.tradein_cities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  buyer_limit integer not null check (buyer_limit between 1 and 1000),
  used integer not null default 0,
  is_open boolean not null default true,
  kecamatan text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.tradein_user_cities (
  user_id uuid not null references public.tradein_profiles(id) on delete cascade,
  city_id uuid not null references public.tradein_cities(id) on delete cascade,
  primary key (user_id, city_id)
);

create table if not exists public.tradein_buyers (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.tradein_cities(id),
  buyer_name text not null check (char_length(buyer_name) between 2 and 80),
  kecamatan text not null check (char_length(kecamatan) between 2 and 60),
  created_by uuid not null references public.tradein_profiles(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.tradein_profiles(id)
);

create index if not exists tradein_buyers_city_idx on public.tradein_buyers (city_id, created_at desc);

-- ------------------------------------------------------- helper functions

create or replace function public.tradein_my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.tradein_profiles where id = auth.uid()
$$;

create or replace function public.tradein_can_see_city(p_city uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.tradein_my_role() = 'admin'
    or (public.tradein_my_role() in ('manager', 'sales')
        and exists (select 1 from public.tradein_user_cities where user_id = auth.uid() and city_id = p_city)),
    false)
$$;

-- Used only by the app's server endpoint, to give an existing login access to this tool.
create or replace function public.tradein_find_user(p_email text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(btrim(p_email)) limit 1
$$;

-- Keep tradein_cities.used equal to the number of active buyers.
create or replace function public.tradein_sync_city_used()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_city uuid;
begin
  if tg_op = 'DELETE' then v_city := old.city_id; else v_city := new.city_id; end if;
  update public.tradein_cities
     set used = (select count(*) from public.tradein_buyers where city_id = v_city and cancelled_at is null)
   where id = v_city;
  return null;
end $$;

drop trigger if exists tradein_buyers_sync_used on public.tradein_buyers;
create trigger tradein_buyers_sync_used
  after insert or update or delete on public.tradein_buyers
  for each row execute function public.tradein_sync_city_used();

-- ------------------------------------------------------------ add a buyer
-- The limit is checked here, inside the database. The city row is locked
-- while one buyer is added, so two sales people cannot take the last slot
-- at the same time.

create or replace function public.tradein_add_buyer(p_city uuid, p_name text, p_kecamatan text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_city public.tradein_cities%rowtype;
  v_used integer;
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_kec text := btrim(regexp_replace(coalesce(p_kecamatan, ''), '\s+', ' ', 'g'));
  v_match text;
  v_id uuid;
begin
  select role into v_role from public.tradein_profiles where id = v_uid;
  if v_role is null or v_role not in ('admin', 'sales') then
    raise exception 'NO_ACCESS';
  end if;
  if v_role = 'sales' and not exists (
    select 1 from public.tradein_user_cities where user_id = v_uid and city_id = p_city) then
    raise exception 'NO_ACCESS';
  end if;
  if char_length(v_name) < 2 then raise exception 'NAME_REQUIRED'; end if;
  if char_length(v_kec) < 2 then raise exception 'KECAMATAN_REQUIRED'; end if;

  select * into v_city from public.tradein_cities where id = p_city for update;
  if not found then raise exception 'NO_ACCESS'; end if;
  if not v_city.is_open then raise exception 'CLOSED'; end if;

  if cardinality(v_city.kecamatan) > 0 then
    select k into v_match from unnest(v_city.kecamatan) as k where lower(k) = lower(v_kec) limit 1;
    if v_match is null then raise exception 'KECAMATAN_INVALID'; end if;
    v_kec := v_match;
  end if;

  select count(*) into v_used from public.tradein_buyers where city_id = p_city and cancelled_at is null;
  if v_used >= v_city.buyer_limit then raise exception 'FULL'; end if;

  if exists (
    select 1 from public.tradein_buyers
     where city_id = p_city and cancelled_at is null
       and lower(buyer_name) = lower(v_name) and lower(kecamatan) = lower(v_kec)) then
    raise exception 'DUPLICATE';
  end if;

  insert into public.tradein_buyers (city_id, buyer_name, kecamatan, created_by)
  values (p_city, v_name, v_kec, v_uid)
  returning id into v_id;

  return json_build_object('id', v_id, 'used', v_used + 1, 'remaining', v_city.buyer_limit - v_used - 1);
end $$;

-- --------------------------------------------------------- cancel a buyer
-- Admin: any entry. Manager: entries in their cities. Sales: their own entries.

create or replace function public.tradein_cancel_buyer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_b public.tradein_buyers%rowtype;
begin
  select role into v_role from public.tradein_profiles where id = v_uid;
  select * into v_b from public.tradein_buyers where id = p_id for update;
  if not found or v_b.cancelled_at is not null then raise exception 'NOT_FOUND'; end if;

  if v_role = 'admin' then
    null;
  elsif v_role = 'manager' and exists (
    select 1 from public.tradein_user_cities where user_id = v_uid and city_id = v_b.city_id) then
    null;
  elsif v_role = 'sales' and v_b.created_by = v_uid and exists (
    select 1 from public.tradein_user_cities where user_id = v_uid and city_id = v_b.city_id) then
    null;
  else
    raise exception 'NO_ACCESS';
  end if;

  update public.tradein_buyers set cancelled_at = now(), cancelled_by = v_uid where id = p_id;
end $$;

-- ----------------------------------------------------------- access rules

alter table public.tradein_profiles enable row level security;
alter table public.tradein_cities enable row level security;
alter table public.tradein_user_cities enable row level security;
alter table public.tradein_buyers enable row level security;

revoke all on public.tradein_profiles, public.tradein_cities, public.tradein_user_cities, public.tradein_buyers from anon, authenticated;
grant select on public.tradein_profiles, public.tradein_user_cities, public.tradein_buyers to authenticated;
grant select, insert, update on public.tradein_cities to authenticated;

-- The server endpoint (api/users.js) uses the service role.
grant usage on schema public to authenticated, service_role;
grant all on public.tradein_profiles, public.tradein_cities, public.tradein_user_cities, public.tradein_buyers to service_role;

-- Profiles: you see your own. Admin and managers see all (to show who added a buyer).
-- Changes to users go through the app's server endpoint only.
drop policy if exists tradein_profiles_read on public.tradein_profiles;
create policy tradein_profiles_read on public.tradein_profiles for select to authenticated
  using (id = auth.uid() or public.tradein_my_role() in ('admin', 'manager'));

-- Cities: you see the cities you are assigned to. Only the admin adds or edits.
drop policy if exists tradein_cities_read on public.tradein_cities;
create policy tradein_cities_read on public.tradein_cities for select to authenticated
  using (public.tradein_can_see_city(id));
drop policy if exists tradein_cities_insert on public.tradein_cities;
create policy tradein_cities_insert on public.tradein_cities for insert to authenticated
  with check (public.tradein_my_role() = 'admin');
drop policy if exists tradein_cities_update on public.tradein_cities;
create policy tradein_cities_update on public.tradein_cities for update to authenticated
  using (public.tradein_my_role() = 'admin') with check (public.tradein_my_role() = 'admin');

-- City assignments: you see your own. Admin sees all.
drop policy if exists tradein_user_cities_read on public.tradein_user_cities;
create policy tradein_user_cities_read on public.tradein_user_cities for select to authenticated
  using (user_id = auth.uid() or public.tradein_my_role() = 'admin');

-- Buyers: admin sees all, a manager sees their cities, sales sees only their own entries.
-- Nobody writes to this table directly. Use tradein_add_buyer and tradein_cancel_buyer.
drop policy if exists tradein_buyers_read on public.tradein_buyers;
create policy tradein_buyers_read on public.tradein_buyers for select to authenticated
  using (
    public.tradein_my_role() = 'admin'
    or (public.tradein_my_role() = 'manager' and public.tradein_can_see_city(city_id))
    or (public.tradein_my_role() = 'sales' and created_by = auth.uid() and public.tradein_can_see_city(city_id))
  );

revoke all on function public.tradein_add_buyer(uuid, text, text) from public, anon;
revoke all on function public.tradein_cancel_buyer(uuid) from public, anon;
revoke all on function public.tradein_my_role() from public, anon;
revoke all on function public.tradein_can_see_city(uuid) from public, anon;
revoke all on function public.tradein_find_user(text) from public, anon, authenticated;
revoke all on function public.tradein_sync_city_used() from public, anon, authenticated;
grant execute on function public.tradein_add_buyer(uuid, text, text) to authenticated;
grant execute on function public.tradein_cancel_buyer(uuid) to authenticated;
grant execute on function public.tradein_my_role() to authenticated;
grant execute on function public.tradein_can_see_city(uuid) to authenticated;
grant execute on function public.tradein_find_user(text) to service_role;

-- ------------------------------------------------------------ live updates

do $$
begin
  alter publication supabase_realtime add table public.tradein_cities;
exception when duplicate_object then null; when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.tradein_buyers;
exception when duplicate_object then null; when undefined_object then null;
end $$;
