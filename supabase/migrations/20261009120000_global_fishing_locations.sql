-- Global shared fishing locations (replaces per-user user_fishing_locations).
-- Tables were wiped empty before this migration; no row backfill required.

-- 1) Detach session links from the old per-user catalog
alter table public.session_fishing_locations
  drop constraint if exists session_fishing_locations_location_id_fkey;

-- 2) Drop old per-user catalog (policies/grants go with the table)
drop table if exists public.user_fishing_locations;

-- 3) Global catalog
create table public.fishing_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint fishing_locations_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.fishing_locations is
  'Global shared fishing-spot catalog. Not owned by a user.';

-- Trim + case-insensitive uniqueness (display name stays human-readable)
create unique index fishing_locations_name_normalized_uidx
  on public.fishing_locations (lower(trim(name)));

-- 4) Session links point at the global catalog
alter table public.session_fishing_locations
  add constraint session_fishing_locations_location_id_fkey
  foreign key (location_id) references public.fishing_locations (id) on delete cascade;

-- 5) RLS: authenticated can read all + create; no update/delete for normal users
alter table public.fishing_locations enable row level security;

drop policy if exists "fishing_locations_select_authenticated" on public.fishing_locations;
drop policy if exists "fishing_locations_insert_authenticated" on public.fishing_locations;

create policy "fishing_locations_select_authenticated"
  on public.fishing_locations for select to authenticated
  using (true);

create policy "fishing_locations_insert_authenticated"
  on public.fishing_locations for insert to authenticated
  with check (true);

revoke all on table public.fishing_locations from anon;
grant select, insert on table public.fishing_locations to authenticated;

-- 6) Find-or-create under the unique index (handles concurrent creates)
create or replace function public.ensure_fishing_location(p_name text)
returns table (id uuid, name text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  cleaned text := trim(both from coalesce(p_name, ''));
  found_id uuid;
  found_name text;
begin
  if cleaned = '' then
    raise exception 'Fishing location name is required';
  end if;

  select fl.id, fl.name
    into found_id, found_name
  from public.fishing_locations fl
  where lower(trim(fl.name)) = lower(cleaned)
  limit 1;

  if found_id is not null then
    id := found_id;
    name := found_name;
    return next;
    return;
  end if;

  begin
    insert into public.fishing_locations (name)
    values (cleaned)
    returning fishing_locations.id, fishing_locations.name
      into found_id, found_name;
  exception
    when unique_violation then
      select fl.id, fl.name
        into found_id, found_name
      from public.fishing_locations fl
      where lower(trim(fl.name)) = lower(cleaned)
      limit 1;
  end;

  if found_id is null then
    raise exception 'Could not ensure fishing location';
  end if;

  id := found_id;
  name := found_name;
  return next;
end;
$$;

revoke all on function public.ensure_fishing_location(text) from public, anon;
grant execute on function public.ensure_fishing_location(text) to authenticated;

-- 7) Viewer RPCs: join global fishing_locations
create or replace function public.list_owned_sessions_for_viewer(p_user_id uuid)
returns table (
  id uuid,
  user_id uuid,
  title text,
  notes text,
  started_at timestamptz,
  created_at timestamptz,
  ended_at timestamptz,
  location_names text[],
  catch_count integer,
  latest_species text,
  latest_length_cm numeric,
  latest_caught_at timestamptz,
  latest_angler_id uuid,
  species_keys text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.user_id,
    s.title,
    s.notes,
    s.started_at,
    s.created_at,
    s.ended_at,
    coalesce((
      select array_agg(fl.name order by fl.name)
      from public.session_fishing_locations sfl
      join public.fishing_locations fl on fl.id = sfl.location_id
      where sfl.session_id = s.id
    ), '{}'::text[]) as location_names,
    (select count(*)::int from public.catches c where c.session_id = s.id) as catch_count,
    lc.species as latest_species,
    lc.length_cm as latest_length_cm,
    lc.caught_at as latest_caught_at,
    lc.user_id as latest_angler_id,
    coalesce((
      select array_agg(distinct x.species)
      from public.catches x
      where x.session_id = s.id
    ), '{}'::text[]) as species_keys
  from public.sessions s
  left join lateral (
    select c.species, c.length_cm, c.caught_at, c.user_id
    from public.catches c
    where c.session_id = s.id
    order by coalesce(c.caught_at, c.created_at) desc nulls last
    limit 1
  ) lc on true
  where s.user_id = p_user_id
    and (
      (select auth.uid()) = p_user_id
      or public.is_accepted_friend(p_user_id)
    )
  order by coalesce(s.ended_at, s.started_at, s.created_at) desc nulls last;
$$;

create or replace function public.list_session_detail_for_viewer(p_session_id uuid)
returns table (
  id uuid,
  user_id uuid,
  title text,
  notes text,
  started_at timestamptz,
  created_at timestamptz,
  ended_at timestamptz,
  location_names text[],
  target_names text[],
  roster_user_ids uuid[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.user_id,
    s.title,
    s.notes,
    s.started_at,
    s.created_at,
    s.ended_at,
    coalesce((
      select array_agg(fl.name order by fl.name)
      from public.session_fishing_locations sfl
      join public.fishing_locations fl on fl.id = sfl.location_id
      where sfl.session_id = s.id
    ), '{}'::text[]) as location_names,
    coalesce((
      select array_agg(uts.name order by uts.name)
      from public.session_target_species sts
      join public.user_target_species uts on uts.id = sts.target_species_id
      where sts.session_id = s.id
    ), '{}'::text[]) as target_names,
    coalesce((
      select array_agg(sa.user_id)
      from public.session_anglers sa
      where sa.session_id = s.id
    ), '{}'::uuid[]) as roster_user_ids
  from public.sessions s
  where s.id = p_session_id
    and public.can_viewer_read_session(p_session_id);
$$;
