-- Mutual friends, catch-location privacy, and friend read-only session access.
-- Drops leftover sessions/catches/anglers "anon_all" policies (USING true) so
-- friend visibility and GPS masking can actually be enforced.

-- ---------------------------------------------------------------------------
-- 1. Remove wide-open ALL policies (owner/participant policies stay)
-- ---------------------------------------------------------------------------
drop policy if exists "sessions_anon_all" on public.sessions;
drop policy if exists "catches_anon_all" on public.catches;
drop policy if exists "anglers_anon_all" on public.anglers;

-- ---------------------------------------------------------------------------
-- 2. Friendships (one row per pair)
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_no_self check (requester_id <> addressee_id)
);

create unique index if not exists friendships_pair_unique
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create index if not exists friendships_requester_status_idx
  on public.friendships (requester_id, status);

create index if not exists friendships_addressee_status_idx
  on public.friendships (addressee_id, status);

comment on table public.friendships is
  'Mutual friendship. Accepted = both users are friends. One row per user pair.';

alter table public.friendships enable row level security;
alter table public.friendships force row level security;

create or replace function public.friendships_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  other uuid;
begin
  if uid is null then
    raise exception 'Not signed in.';
  end if;

  if tg_op = 'INSERT' then
    if new.requester_id is distinct from uid then
      raise exception 'You can only send a friend request as yourself.';
    end if;
    if new.status is distinct from 'pending' then
      raise exception 'New friend requests must be pending.';
    end if;
    new.responded_at := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if uid is distinct from old.requester_id and uid is distinct from old.addressee_id then
      raise exception 'Not allowed to change this friendship.';
    end if;

    if old.status = 'pending' and new.status = 'accepted' then
      if uid is distinct from old.addressee_id then
        raise exception 'Only the recipient can accept a friend request.';
      end if;
      new.requester_id := old.requester_id;
      new.addressee_id := old.addressee_id;
      new.responded_at := coalesce(new.responded_at, now());
      return new;
    end if;

    if old.status = 'pending' and new.status = 'declined' then
      new.requester_id := old.requester_id;
      new.addressee_id := old.addressee_id;
      new.responded_at := coalesce(new.responded_at, now());
      return new;
    end if;

    if old.status = 'declined' and new.status = 'pending' then
      if new.requester_id is distinct from uid then
        raise exception 'Resent requests must come from you.';
      end if;
      other := case
        when uid = old.requester_id then old.addressee_id
        else old.requester_id
      end;
      if new.addressee_id is distinct from other then
        raise exception 'Resent request must target the same other user.';
      end if;
      new.responded_at := null;
      new.created_at := now();
      return new;
    end if;

    if old.status = 'accepted' and new.status = 'declined' then
      new.requester_id := old.requester_id;
      new.addressee_id := old.addressee_id;
      new.responded_at := now();
      return new;
    end if;

    raise exception 'Illegal friendship status change.';
  end if;

  return new;
end;
$$;

drop trigger if exists friendships_before_write on public.friendships;
create trigger friendships_before_write
  before insert or update on public.friendships
  for each row
  execute function public.friendships_before_write();

drop policy if exists "friendships_select_involved" on public.friendships;
drop policy if exists "friendships_insert_self" on public.friendships;
drop policy if exists "friendships_update_involved" on public.friendships;
drop policy if exists "friendships_delete_involved" on public.friendships;

create policy "friendships_select_involved"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

create policy "friendships_insert_self"
  on public.friendships for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and status = 'pending'
  );

create policy "friendships_update_involved"
  on public.friendships for update to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id))
  with check ((select auth.uid()) in (requester_id, addressee_id));

create policy "friendships_delete_involved"
  on public.friendships for delete to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

grant select, insert, update, delete on public.friendships to authenticated;
revoke all on public.friendships from anon;

-- ---------------------------------------------------------------------------
-- 3. Privacy settings (extensible; catch_locations is the first key)
-- ---------------------------------------------------------------------------
create table if not exists public.user_privacy_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  catch_locations text not null default 'only_me'
    check (catch_locations in ('only_me', 'friends')),
  updated_at timestamptz not null default now()
);

comment on table public.user_privacy_settings is
  'Per-user privacy keys. catch_locations: only_me | friends. More keys can be added later.';

alter table public.user_privacy_settings enable row level security;
alter table public.user_privacy_settings force row level security;

drop policy if exists "user_privacy_settings_select_own" on public.user_privacy_settings;
drop policy if exists "user_privacy_settings_insert_own" on public.user_privacy_settings;
drop policy if exists "user_privacy_settings_update_own" on public.user_privacy_settings;

create policy "user_privacy_settings_select_own"
  on public.user_privacy_settings for select to authenticated
  using (user_id = (select auth.uid()));

create policy "user_privacy_settings_insert_own"
  on public.user_privacy_settings for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "user_privacy_settings_update_own"
  on public.user_privacy_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.user_privacy_settings to authenticated;
revoke all on public.user_privacy_settings from anon;

-- ---------------------------------------------------------------------------
-- 4. SECURITY DEFINER helpers (same pattern as is_session_owner)
-- ---------------------------------------------------------------------------
create or replace function public.is_accepted_friend(p_other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_other is not null
    and (select auth.uid()) is not null
    and p_other <> (select auth.uid())
    and exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = (select auth.uid()) and f.addressee_id = p_other)
          or (f.addressee_id = (select auth.uid()) and f.requester_id = p_other)
        )
    );
$$;

create or replace function public.is_friend_of_session_owner(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    where s.id = p_session_id
      and public.is_accepted_friend(s.user_id)
  );
$$;

create or replace function public.catch_locations_shared_with_friends(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_privacy_settings s
    where s.user_id = p_owner
      and s.catch_locations = 'friends'
  );
$$;

create or replace function public.can_viewer_read_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_session_owner(p_session_id)
    or public.is_session_participant(p_session_id)
    or public.is_friend_of_session_owner(p_session_id);
$$;

-- GPS: owner/participant keep existing session access. Friends only if the
-- catch owner opted in. Missing privacy row = only_me.
create or replace function public.viewer_can_see_catch_coordinates(p_owner uuid, p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select auth.uid()) is not null
    and p_owner is not null
    and (
      (select auth.uid()) = p_owner
      or public.is_session_owner(p_session_id)
      or public.is_session_participant(p_session_id)
      or (
        public.is_accepted_friend(p_owner)
        and public.catch_locations_shared_with_friends(p_owner)
      )
    );
$$;

revoke all on function public.is_accepted_friend(uuid) from public, anon;
revoke all on function public.is_friend_of_session_owner(uuid) from public, anon;
revoke all on function public.catch_locations_shared_with_friends(uuid) from public, anon;
revoke all on function public.can_viewer_read_session(uuid) from public, anon;
revoke all on function public.viewer_can_see_catch_coordinates(uuid, uuid) from public, anon;
revoke all on function public.friendships_before_write() from public, anon;
grant execute on function public.friendships_before_write() to authenticated;

grant execute on function public.is_accepted_friend(uuid) to authenticated;
grant execute on function public.is_friend_of_session_owner(uuid) to authenticated;
grant execute on function public.catch_locations_shared_with_friends(uuid) to authenticated;
grant execute on function public.can_viewer_read_session(uuid) to authenticated;
grant execute on function public.viewer_can_see_catch_coordinates(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Friend SELECT on sessions + roster (read-only; no write policies)
-- ---------------------------------------------------------------------------
drop policy if exists "sessions_select_friend" on public.sessions;
create policy "sessions_select_friend"
  on public.sessions for select to authenticated
  using (public.is_accepted_friend(user_id));

drop policy if exists "session_anglers_select_friend" on public.session_anglers;
create policy "session_anglers_select_friend"
  on public.session_anglers for select to authenticated
  using (public.is_friend_of_session_owner(session_id));

-- ---------------------------------------------------------------------------
-- 6. RPCs: friend catch reads with GPS masking (no catches_select_friend)
-- ---------------------------------------------------------------------------
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
      select array_agg(ufl.name order by ufl.name)
      from public.session_fishing_locations sfl
      join public.user_fishing_locations ufl on ufl.id = sfl.location_id
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
      select array_agg(ufl.name order by ufl.name)
      from public.session_fishing_locations sfl
      join public.user_fishing_locations ufl on ufl.id = sfl.location_id
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

create or replace function public.list_session_catches_for_viewer(p_session_id uuid)
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
  where c.session_id = p_session_id
    and public.can_viewer_read_session(p_session_id)
  order by coalesce(c.caught_at, c.created_at) asc;
$$;

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
  join public.sessions s on s.id = c.session_id
  where s.user_id = p_user_id
    and c.user_id = p_user_id
    and (
      (select auth.uid()) = p_user_id
      or public.is_accepted_friend(p_user_id)
    )
  order by coalesce(c.caught_at, c.created_at) asc;
$$;

revoke all on function public.list_owned_sessions_for_viewer(uuid) from public, anon;
revoke all on function public.list_friend_feed_sessions(boolean) from public, anon;
revoke all on function public.list_session_detail_for_viewer(uuid) from public, anon;
revoke all on function public.list_session_catches_for_viewer(uuid) from public, anon;
revoke all on function public.list_user_catches_for_viewer(uuid) from public, anon;

grant execute on function public.list_owned_sessions_for_viewer(uuid) to authenticated;
grant execute on function public.list_friend_feed_sessions(boolean) to authenticated;
grant execute on function public.list_session_detail_for_viewer(uuid) to authenticated;
grant execute on function public.list_session_catches_for_viewer(uuid) to authenticated;
grant execute on function public.list_user_catches_for_viewer(uuid) to authenticated;

revoke execute on function public.catch_locations_shared_with_friends(uuid) from public, anon, authenticated;
revoke execute on function public.viewer_can_see_catch_coordinates(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_viewer_read_session(uuid) from public, anon, authenticated;
