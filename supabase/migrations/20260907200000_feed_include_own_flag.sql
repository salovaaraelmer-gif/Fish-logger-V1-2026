-- Feed: optional own sessions (default off) and an explicit viewer-id exclusion.
-- Drop the zero-arg overload so PostgREST binds the defaulted boolean parameter.

drop function if exists public.list_friend_feed_sessions();

create or replace function public.list_friend_feed_sessions(p_include_own boolean default false)
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
    s.location_names,
    s.catch_count,
    s.latest_species,
    s.latest_length_cm,
    s.latest_caught_at,
    s.latest_angler_id,
    s.species_keys
  from (
    select case
      when fr.requester_id = (select auth.uid()) then fr.addressee_id
      else fr.requester_id
    end as owner_id
    from public.friendships fr
    where fr.status = 'accepted'
      and (select auth.uid()) in (fr.requester_id, fr.addressee_id)
    union all
    select (select auth.uid()) as owner_id
    where coalesce(p_include_own, false)
      and (select auth.uid()) is not null
  ) f
  cross join lateral public.list_owned_sessions_for_viewer(f.owner_id) s
  where coalesce(p_include_own, false)
    or s.user_id is distinct from (select auth.uid());
$$;

comment on function public.list_friend_feed_sessions(boolean) is
  'Friend-owned sessions for Feed. p_include_own is the future "Show my sessions in Feed" switch; default false.';

revoke all on function public.list_friend_feed_sessions(boolean) from public, anon;
grant execute on function public.list_friend_feed_sessions(boolean) to authenticated;
