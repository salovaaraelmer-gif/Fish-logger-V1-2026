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

Run this **in addition** to the policies above (do **not** remove `sessions_select_own` unless you replace it with equivalent logic):

```sql
create policy "sessions_select_participant"
  on public.sessions for select
  to authenticated
  using (
    exists (
      select 1
      from public.session_anglers sa
      where sa.session_id = sessions.id
        and sa.user_id = auth.uid()
    )
  );
```

If the policy name already exists, run `drop policy "sessions_select_participant" on public.sessions;` first.

**Note:** The app loads participant membership via `public.session_anglers` (`user_id = auth.uid()`). Ensure participants can **select** their own `session_anglers` rows as well (e.g. a policy `using (auth.uid() = user_id)` on `session_anglers` for `select`), in addition to the owner-based policies in `SUPABASE_PROFILES_SESSION_ANGLERS.md`.

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
