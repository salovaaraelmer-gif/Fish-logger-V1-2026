-- Standalone catches: a fish may exist without a fishing session.
-- Session catches still require session_id + angler_id. Deleting a session
-- still cascades only rows that reference that session.

alter table public.catches
  alter column session_id drop not null;

alter table public.catches
  alter column angler_id drop not null;

alter table public.catches
  drop constraint if exists catches_session_or_standalone;

alter table public.catches
  add constraint catches_session_or_standalone
  check (
    (session_id is not null and angler_id is not null)
    or (session_id is null and angler_id is null)
  );

comment on column public.catches.session_id is
  'Fishing session. NULL = standalone catch not tied to a session.';

comment on column public.catches.angler_id is
  'Session-scoped public.anglers.id. NULL for standalone catches (user_id is the owner).';

create index if not exists catches_standalone_user_caught_idx
  on public.catches (user_id, caught_at desc)
  where session_id is null;

create or replace function public.list_user_catches_for_viewer(p_user_id uuid)
returns table (
  id uuid,
  session_id uuid,
  user_id uuid,
  species text,
  length_cm numeric,
  weight_kg numeric,
  depth_m numeric,
  water_temp_c numeric,
  notes text,
  caught_at timestamptz,
  created_at timestamptz,
  location_lat double precision,
  location_lng double precision,
  location_accuracy_m numeric,
  photo_urls text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.session_id,
    c.user_id,
    c.species,
    c.length_cm,
    c.weight_kg,
    c.depth_m,
    c.water_temp_c,
    c.notes,
    c.caught_at,
    c.created_at,
    case
      when public.viewer_can_see_catch_coordinates(c.user_id, c.session_id) then c.location_lat
      else null
    end as location_lat,
    case
      when public.viewer_can_see_catch_coordinates(c.user_id, c.session_id) then c.location_lng
      else null
    end as location_lng,
    case
      when public.viewer_can_see_catch_coordinates(c.user_id, c.session_id) then c.location_accuracy_m
      else null
    end as location_accuracy_m,
    c.photo_urls
  from public.catches c
  left join public.sessions s on s.id = c.session_id
  where c.user_id = p_user_id
    and (
      c.session_id is null
      or s.user_id = p_user_id
    )
    and (
      (select auth.uid()) = p_user_id
      or public.is_accepted_friend(p_user_id)
    )
  order by coalesce(c.caught_at, c.created_at) asc;
$$;
