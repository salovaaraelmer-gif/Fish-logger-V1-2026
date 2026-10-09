# Session fishing locations, target species, and `started_at`

Run in the **Supabase SQL Editor**. This is **additive** for targets / `started_at` — fishing locations are now a **global** catalog (see migration `supabase/migrations/20261009120000_global_fishing_locations.sql`).

**Prerequisites:** `public.is_session_owner` and `public.is_session_participant` from [`SUPABASE_AUTH_RLS.md`](../SUPABASE_AUTH_RLS.md) §1b.

---

## 1. `sessions.started_at`

Editable session start time (do not rewrite `created_at` when the user edits times).

```sql
alter table public.sessions
  add column if not exists started_at timestamptz;

comment on column public.sessions.started_at is
  'User-editable session start; NULL means fall back to created_at in the app.';
```

Optional backfill for ended sessions:

```sql
update public.sessions
set started_at = created_at
where started_at is null and created_at is not null;
```

---

## 2. Participants may update session rows they joined

Needed for title, `started_at`, and `ended_at` when a roster member edits (not only the host).

```sql
drop policy if exists "sessions_update_participant" on public.sessions;

create policy "sessions_update_participant"
  on public.sessions for update
  to authenticated
  using (public.is_session_participant(id))
  with check (public.is_session_participant(id));
```

---

## 3. `fishing_locations` (global shared catalog)

| Column       | Type          | Notes |
|--------------|---------------|-------|
| `id`         | `uuid` PK     | `default gen_random_uuid()` |
| `name`       | `text`        | `NOT NULL`, human-readable display name |
| `created_at` | `timestamptz` | `default now()` |

Uniqueness: `unique index` on `lower(trim(name))` so `Inkoo` / `inkoo` / ` INKOO ` collide.

```sql
create table if not exists public.fishing_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint fishing_locations_name_not_blank check (length(trim(name)) > 0)
);

create unique index if not exists fishing_locations_name_normalized_uidx
  on public.fishing_locations (lower(trim(name)));
```

Find-or-create helper (handles concurrent inserts): `public.ensure_fishing_location(text)`.

Canonical migration: `supabase/migrations/20261009120000_global_fishing_locations.sql`.

---

## 4. `user_target_species`

Still per-user (unchanged).

```sql
create table if not exists public.user_target_species (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  user_number int not null,
  created_at timestamptz not null default now(),
  constraint user_target_species_user_name_unique unique (user_id, name),
  constraint user_target_species_user_number_unique unique (user_id, user_number)
);

create index if not exists user_target_species_user_id_idx
  on public.user_target_species (user_id);
```

---

## 5. Session junction tables

```sql
create table if not exists public.session_fishing_locations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  location_id uuid not null references public.fishing_locations (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint session_fishing_locations_unique unique (session_id, location_id)
);

create index if not exists session_fishing_locations_session_id_idx
  on public.session_fishing_locations (session_id);

create table if not exists public.session_target_species (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  target_species_id uuid not null references public.user_target_species (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint session_target_species_unique unique (session_id, target_species_id)
);

create index if not exists session_target_species_session_id_idx
  on public.session_target_species (session_id);
```

---

## 6. Row Level Security

```sql
alter table public.fishing_locations enable row level security;
alter table public.user_target_species enable row level security;
alter table public.session_fishing_locations enable row level security;
alter table public.session_target_species enable row level security;

-- Global locations: all authenticated users can read + create (no update/delete)
create policy "fishing_locations_select_authenticated"
  on public.fishing_locations for select to authenticated
  using (true);
create policy "fishing_locations_insert_authenticated"
  on public.fishing_locations for insert to authenticated
  with check (true);

-- Target species: own rows only
create policy "user_target_species_select_own"
  on public.user_target_species for select to authenticated
  using (auth.uid() = user_id);
create policy "user_target_species_insert_own"
  on public.user_target_species for insert to authenticated
  with check (auth.uid() = user_id);
create policy "user_target_species_update_own"
  on public.user_target_species for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_target_species_delete_own"
  on public.user_target_species for delete to authenticated
  using (auth.uid() = user_id);

-- Junctions: roster participants read and manage links
create policy "session_fishing_locations_select_participant"
  on public.session_fishing_locations for select to authenticated
  using (public.is_session_participant(session_id) or public.is_session_owner(session_id));
create policy "session_fishing_locations_insert_participant"
  on public.session_fishing_locations for insert to authenticated
  with check (public.is_session_participant(session_id) or public.is_session_owner(session_id));
create policy "session_fishing_locations_delete_participant"
  on public.session_fishing_locations for delete to authenticated
  using (public.is_session_participant(session_id) or public.is_session_owner(session_id));

create policy "session_target_species_select_participant"
  on public.session_target_species for select to authenticated
  using (public.is_session_participant(session_id) or public.is_session_owner(session_id));
create policy "session_target_species_insert_participant"
  on public.session_target_species for insert to authenticated
  with check (public.is_session_participant(session_id) or public.is_session_owner(session_id));
create policy "session_target_species_delete_participant"
  on public.session_target_species for delete to authenticated
  using (public.is_session_participant(session_id) or public.is_session_owner(session_id));
```

If policies already exist, `drop policy if exists ...` before recreating.

---

## 7. GRANTs (PostgREST / supabase-js)

```sql
grant select, insert on public.fishing_locations to authenticated;
grant select, insert, update, delete on public.user_target_species to authenticated;
grant select, insert, delete on public.session_fishing_locations to authenticated;
grant select, insert, delete on public.session_target_species to authenticated;
```

No `anon` grants unless you use the anon key for this app.

---

## 8. Verify

As an authenticated user:

```sql
select * from public.fishing_locations order by name limit 20;
select * from public.ensure_fishing_location('Inkoo');
select * from public.ensure_fishing_location(' inkoo '); -- same id
```
