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
