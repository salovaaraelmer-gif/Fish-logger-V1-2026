# Profiles + `session_anglers` (user-based session roster)

Run in the **Supabase SQL editor** (or a migration). This **does not** delete existing `sessions` / `anglers` / `catches` data. The legacy `public.anglers` table can stay until the app migrates.

**Active session (for app logic later):** `sessions.ended_at IS NULL`. Add `ended_at` below if your `sessions` table does not have it yet.

---

## 1. `public.profiles`

**Target shape**

| Column         | Type        | Notes                                      |
|----------------|-------------|--------------------------------------------|
| `id`           | `uuid` PK   | `references auth.users (id) on delete cascade` |
| `username`     | `text`      | `NOT NULL`, **unique**                     |
| `display_name` | `text`      | `NOT NULL`                                 |

### SQL

```sql
-- Table shell (safe if something already created profiles with only id)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade
);

alter table public.profiles
  add column if not exists username text;

alter table public.profiles
  add column if not exists display_name text;

-- Backfill existing rows before setting NOT NULL (adjust if you already have data)
update public.profiles
set username = coalesce(
    nullif(trim(username), ''),
    'user_' || replace(id::text, '-', '')
  )
where username is null or trim(username) = '';

update public.profiles
set display_name = coalesce(nullif(trim(display_name), ''), 'User')
where display_name is null or trim(display_name) = '';

alter table public.profiles
  alter column username set not null;

alter table public.profiles
  alter column display_name set not null;

-- Unique username (partial unique index allows skipping empty strings if you ever relax NOT NULL)
create unique index if not exists profiles_username_unique
  on public.profiles (username);
```

---

## 2. `sessions.ended_at` (optional but recommended)

Aligns “active session” with **`ended_at IS NULL`** in the database.

```sql
alter table public.sessions
  add column if not exists ended_at timestamptz;

comment on column public.sessions.ended_at is
  'NULL = session active; set when session ends. App may still use other columns until migrated.';
```

Do **not** drop existing columns (e.g. legacy end metadata). You can backfill `ended_at` from app data later.

---

## 3. `public.session_anglers`

**Target shape**

| Column        | Type           | Notes |
|---------------|----------------|-------|
| `id`          | `uuid` PK      | `default gen_random_uuid()` |
| `session_id`  | `uuid` NOT NULL | FK → `public.sessions(id)` **ON DELETE CASCADE** |
| `user_id`     | `uuid` NOT NULL | FK → `public.profiles(id)` **ON DELETE CASCADE** |
| `created_at`  | `timestamptz` NOT NULL | `default now()` |

**Unique:** `(session_id, user_id)` so the same user cannot be added twice to one session.

### SQL

```sql
create table if not exists public.session_anglers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint session_anglers_session_user_unique unique (session_id, user_id)
);

create index if not exists session_anglers_session_id_idx
  on public.session_anglers (session_id);

create index if not exists session_anglers_user_id_idx
  on public.session_anglers (user_id);
```

If the table already exists without the unique constraint:

```sql
alter table public.session_anglers
  add constraint session_anglers_session_user_unique unique (session_id, user_id);
```

(Run only if that constraint name does not already exist.)

---

## 4. Row Level Security (recommended)

Enable RLS and policies so users only touch their own profile and session rows they own (tune to match your `sessions.user_id` model).

```sql
alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- App: session creation searches users and resolves display names by `id`.
-- Any authenticated client can read profile rows (adjust if you need stricter privacy).
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- Optional: restrict delete on profiles (often omitted so only service role deletes)

alter table public.session_anglers enable row level security;

-- Session owner can read/write roster for their sessions
create policy "session_anglers_select_session_owner"
  on public.session_anglers for select
  using (
    exists (
      select 1 from public.sessions s
      where s.id = session_anglers.session_id
        and s.user_id = auth.uid()
    )
  );

create policy "session_anglers_insert_session_owner"
  on public.session_anglers for insert
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = session_anglers.session_id
        and s.user_id = auth.uid()
    )
    and exists (
      select 1 from public.profiles p
      where p.id = session_anglers.user_id
    )
  );

create policy "session_anglers_delete_session_owner"
  on public.session_anglers for delete
  using (
    exists (
      select 1 from public.sessions s
      where s.id = session_anglers.session_id
        and s.user_id = auth.uid()
    )
  );
```

If you already created **`session_anglers_insert_session_owner`** with `user_id = auth.uid()`, run `drop policy "session_anglers_insert_session_owner" on public.session_anglers;` and recreate the insert policy as above (session owner + `user_id` exists in `profiles`).

---

## 5. Verify in Supabase

1. **Table Editor → `profiles`:** columns `id`, `username`, `display_name`.
2. **Indexes:** unique on `username` (`profiles_username_unique`).
3. **Table `session_anglers`:** columns `id`, `session_id`, `user_id`, `created_at`.
4. **Foreign keys:** `session_id` → `sessions.id`, `user_id` → `profiles.id`.
5. **Cascade:** delete a `sessions` row → related `session_anglers` rows removed.
6. **Duplicate guard:** inserting the same `(session_id, user_id)` twice fails.

---

## Post-migration checklist (answers for your task)

After you run the SQL and confirm in the dashboard:

| Item | Expected |
|------|----------|
| **`profiles` columns** | `id` (uuid, PK, FK → `auth.users`), `username` (text, NOT NULL), `display_name` (text, NOT NULL) |
| **`session_anglers` columns** | `id` (uuid, PK, default `gen_random_uuid()`), `session_id` (uuid, NOT NULL), `user_id` (uuid, NOT NULL), `created_at` (timestamptz, NOT NULL, default `now()`) |
| **Username unique** | Yes — `profiles_username_unique` on `profiles(username)` |
| **Both FKs** | Yes — `session_id` → `sessions.id`, `user_id` → `profiles.id` |
| **`ON DELETE CASCADE` on `session_id`** | Yes — deleting a session deletes its `session_anglers` rows |
| **`ON DELETE CASCADE` on `user_id`** | Yes — deleting a profile deletes their `session_anglers` rows |

**Note:** “One user cannot be in multiple active sessions” is **not** enforced in SQL here (per your request); the schema supports adding a partial unique index or trigger later (e.g. on `session_anglers` joined to `sessions` where `ended_at is null`).
