# Auth V1 — `user_id` and Row Level Security

The app links all Supabase rows to **`auth.users`** via **`user_id`** (same value as `auth.uid()` in policies).

Run these in the Supabase SQL editor after enabling email/password auth in the dashboard.

## 1. Columns (if missing)

```sql
alter table public.sessions
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

alter table public.anglers
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

alter table public.catches
  add column if not exists user_id uuid references auth.users (id) on delete cascade;
```

Optional: index for policy performance:

```sql
create index if not exists sessions_user_id_idx on public.sessions (user_id);
create index if not exists anglers_user_id_idx on public.anglers (user_id);
create index if not exists catches_user_id_idx on public.catches (user_id);
```

Existing rows without `user_id` will not match RLS until backfilled or removed.

## 1b. Helper functions (avoid infinite RLS recursion)

If **`sessions`** policies reference **`session_anglers`** and **`session_anglers`** policies reference **`sessions`**, PostgreSQL raises **`infinite recursion detected in policy for relation "sessions"`** (e.g. when embedding `sessions` on `session_anglers` queries).

Use **`SECURITY DEFINER`** helpers so membership checks run **outside** the recursive policy chain. Create these **once** (before the policies below that reference them):

```sql
-- True if auth.uid() is a roster participant for this session (reads session_anglers; bypasses RLS inside the definer context).
create or replace function public.is_session_participant(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.session_anglers sa
    where sa.session_id = p_session_id
      and sa.user_id = auth.uid()
  );
$$;

-- True if auth.uid() owns the session row (reads sessions; bypasses RLS inside the definer context).
create or replace function public.is_session_owner(p_session_id uuid)
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
      and s.user_id = auth.uid()
  );
$$;

grant execute on function public.is_session_participant(uuid) to authenticated;
grant execute on function public.is_session_owner(uuid) to authenticated;
```

**Migration from broken policies:** if you already created `sessions_select_participant` with an inline `EXISTS (... session_anglers ...)`, run:

```sql
drop policy if exists "sessions_select_participant" on public.sessions;
```

Then recreate it using **`is_session_participant(id)`** as shown in §3.

## 2. Enable RLS

```sql
alter table public.sessions enable row level security;
alter table public.anglers enable row level security;
alter table public.catches enable row level security;
```

## 3. Policies (own rows only)

Replace policy names if they already exist in your project.

### `sessions`

```sql
create policy "sessions_select_own"
  on public.sessions for select
  using (auth.uid() = user_id);

create policy "sessions_insert_own"
  on public.sessions for insert
  with check (auth.uid() = user_id);

create policy "sessions_update_own"
  on public.sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "sessions_delete_own"
  on public.sessions for delete
  using (auth.uid() = user_id);
```

**Participants (not only the session owner)** must be able to **read** session rows for sessions they joined. Add a separate `SELECT` policy; permissive policies are combined with **OR**, so keep `sessions_select_own` for owners.

**Do not** use an inline `EXISTS (SELECT … FROM session_anglers …)` here — it causes **RLS recursion** with owner policies on `session_anglers` that reference `sessions`. Use **`is_session_participant`** from §1b instead.

Run this **in addition** to the policies above (do **not** remove `sessions_select_own` unless you replace it with equivalent logic):

```sql
drop policy if exists "sessions_select_participant" on public.sessions;

create policy "sessions_select_participant"
  on public.sessions for select
  to authenticated
  using (public.is_session_participant(id));
```

**Note:** The app loads participant membership via `public.session_anglers` (`user_id = auth.uid()`). Ensure participants can **select** their own `session_anglers` rows (see **`session_anglers_select_self`** in `SUPABASE_PROFILES_SESSION_ANGLERS.md`). Owner-based `session_anglers` policies should use **`is_session_owner(session_id)`** from §1b, not inline `EXISTS` on `sessions`.

### `anglers`

```sql
create policy "anglers_select_own"
  on public.anglers for select
  using (auth.uid() = user_id);

create policy "anglers_insert_own"
  on public.anglers for insert
  with check (auth.uid() = user_id);

create policy "anglers_update_own"
  on public.anglers for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "anglers_delete_own"
  on public.anglers for delete
  using (auth.uid() = user_id);
```

**Multi-device:** Other participants must **read** session-scoped `anglers` rows for the same session (names / FK for catches). Add a separate `SELECT` policy (uses **`is_session_participant`** from §1b; does not recurse):

```sql
drop policy if exists "anglers_select_session_participant" on public.anglers;

create policy "anglers_select_session_participant"
  on public.anglers for select
  to authenticated
  using (public.is_session_participant(session_id));
```

### `catches`

```sql
create policy "catches_select_own"
  on public.catches for select
  using (auth.uid() = user_id);

create policy "catches_insert_own"
  on public.catches for insert
  with check (auth.uid() = user_id);

create policy "catches_update_own"
  on public.catches for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "catches_delete_own"
  on public.catches for delete
  using (auth.uid() = user_id);
```

**Multi-device:** `catches.user_id` is the **account that logged** the catch (see `supabaseCatchSync.js`), so `catches_select_own` alone does **not** show fish logged by the host on another device. Participants need **`SELECT`** on rows in the same session:

```sql
drop policy if exists "catches_select_session_participant" on public.catches;

create policy "catches_select_session_participant"
  on public.catches for select
  to authenticated
  using (public.is_session_participant(session_id));
```

## 4. Sign-up metadata

The client sets **`user_metadata`** on sign-up:

- `first_name`
- `last_name`
- `full_name` (e.g. `"First Last"`)

The UI reads **`full_name`** for display and does not use email as a visible name.

## 5. Deletes from the app

Session delete in the client removes **`catches`**, then **`anglers`**, then **`sessions`**, each filtered by **`session_id`** (or `id`) **and** **`user_id = auth.uid()`**. That matches the policies above.

- If **`DELETE` policies are missing** on any of these tables, Postgres will not remove rows (the app now reports when the session row count is zero).
- If **`user_id` is NULL** on existing rows, RLS will not match and deletes will affect **zero** rows. Backfill, e.g.  
  `update public.catches set user_id = '<your-user-uuid>' where user_id is null;`  
  (only for your own test data), then retry.
