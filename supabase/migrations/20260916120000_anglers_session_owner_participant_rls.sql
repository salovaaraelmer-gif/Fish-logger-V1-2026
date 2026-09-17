-- Session-scoped public.anglers is the catch FK mapping (catches.angler_id).
-- public.session_anglers remains the source of truth for session membership
-- (history, participant visibility, is_session_participant).
--
-- The previous anglers INSERT policy (auth.uid() = user_id) blocked the session
-- owner from creating rows for other participants. A multi-person insert then
-- failed entirely, session_anglers was skipped, and the UI still entered the
-- session. Catch saves looked up anglers by (session_id, user_id) and failed.

-- 1. Repair known owner membership from sessions.user_id (do not invent guests).
insert into public.session_anglers (session_id, user_id)
select s.id, s.user_id
from public.sessions s
inner join public.profiles p on p.id = s.user_id
where not exists (
  select 1
  from public.session_anglers sa
  where sa.session_id = s.id
    and sa.user_id = s.user_id
);

insert into public.session_anglers (session_id, user_id)
select a.session_id, a.user_id
from public.anglers a
inner join public.profiles p on p.id = a.user_id
where not exists (
  select 1
  from public.session_anglers sa
  where sa.session_id = a.session_id
    and sa.user_id = a.user_id
);

insert into public.anglers (session_id, user_id, name)
select
  sa.session_id,
  sa.user_id,
  coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'Angler')
from public.session_anglers sa
inner join public.profiles p on p.id = sa.user_id
where not exists (
  select 1
  from public.anglers a
  where a.session_id = sa.session_id
    and a.user_id = sa.user_id
);

do $$
begin
  if exists (
    select 1
    from public.anglers a
    left join public.profiles p on p.id = a.user_id
    where p.id is null
  ) then
    raise exception 'anglers.user_id has values that are not in profiles';
  end if;
end
$$;

-- 2. One mapping row per user per session.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'anglers_session_user_unique'
  ) then
    alter table public.anglers
      add constraint anglers_session_user_unique unique (session_id, user_id);
  end if;
end
$$;

create index if not exists anglers_user_id_idx on public.anglers (user_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'anglers_user_id_fkey'
  ) then
    alter table public.anglers
      add constraint anglers_user_id_fkey
      foreign key (user_id) references public.profiles (id) on delete restrict;
  end if;
end
$$;

-- 3. RLS: owner manages mappings for their session; participants may repair self.
drop policy if exists "own data only anglers" on public.anglers;
drop policy if exists "anglers_insert_own" on public.anglers;
drop policy if exists "anglers_insert_session_owner" on public.anglers;
drop policy if exists "anglers_insert_self_if_participant" on public.anglers;
drop policy if exists "anglers_select_session_owner" on public.anglers;

create policy "anglers_insert_session_owner"
  on public.anglers for insert
  to authenticated
  with check (
    public.is_session_owner(session_id)
    and exists (
      select 1
      from public.profiles p
      where p.id = anglers.user_id
    )
  );

create policy "anglers_insert_self_if_participant"
  on public.anglers for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and public.is_session_participant(session_id)
    and exists (
      select 1
      from public.profiles p
      where p.id = anglers.user_id
    )
  );

create policy "anglers_select_session_owner"
  on public.anglers for select
  to authenticated
  using (public.is_session_owner(session_id));

-- 4. Standalone catches (null session_id + angler_id) must skip the session FK check.
create or replace function public.validate_catch_angler_session()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.session_id is null and new.angler_id is null then
    return new;
  end if;
  if new.session_id is null or new.angler_id is null then
    raise exception 'session catches require session_id and angler_id';
  end if;
  if not exists (
    select 1
    from public.anglers a
    where a.id = new.angler_id
      and a.session_id = new.session_id
  ) then
    raise exception 'angler_id must belong to the same session_id';
  end if;
  return new;
end;
$$;

-- 5. Atomic session + roster + catch-mapping create.
create or replace function public.create_fishing_session(
  p_title text,
  p_started_at timestamptz,
  p_participant_ids uuid[],
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session_id uuid;
  v_ids uuid[];
  v_user uuid;
  v_name text;
  v_angler_id uuid;
  v_participants jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_ids := array(
    select distinct x
    from unnest(coalesce(p_participant_ids, array[]::uuid[])) as x
    where x is not null
  );
  if v_ids is null then
    v_ids := array[]::uuid[];
  end if;
  if not (v_uid = any (v_ids)) then
    v_ids := v_uid || v_ids;
  end if;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'At least one participant is required';
  end if;
  if coalesce(array_length(v_ids, 1), 0) > 10 then
    raise exception 'Too many participants';
  end if;
  if exists (
    select 1
    from unnest(v_ids) as pid
    where not exists (select 1 from public.profiles p where p.id = pid)
  ) then
    raise exception 'Each participant must have a profile';
  end if;

  insert into public.sessions (title, notes, user_id, started_at)
  values (
    nullif(btrim(coalesce(p_title, '')), ''),
    p_notes,
    v_uid,
    coalesce(p_started_at, now())
  )
  returning id into v_session_id;

  foreach v_user in array v_ids loop
    select coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), ''), 'Angler')
      into v_name
    from public.profiles p
    where p.id = v_user;

    insert into public.session_anglers (session_id, user_id)
    values (v_session_id, v_user)
    on conflict (session_id, user_id) do nothing;

    insert into public.anglers (session_id, user_id, name)
    values (v_session_id, v_user, coalesce(v_name, 'Angler'))
    on conflict (session_id, user_id) do update
      set name = excluded.name
    returning id into v_angler_id;

    v_participants := v_participants || jsonb_build_array(
      jsonb_build_object('user_id', v_user, 'angler_id', v_angler_id)
    );
  end loop;

  return jsonb_build_object(
    'session_id', v_session_id,
    'participants', v_participants
  );
end;
$$;

comment on function public.create_fishing_session(text, timestamptz, uuid[], text) is
  'Creates a session owned by auth.uid() plus matching session_anglers and anglers rows in one transaction.';

revoke all on function public.create_fishing_session(text, timestamptz, uuid[], text) from public, anon;
grant execute on function public.create_fishing_session(text, timestamptz, uuid[], text) to authenticated;
