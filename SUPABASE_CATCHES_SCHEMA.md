# Supabase `catches` table — sync with the app

The app stores the remote row UUID on each local catch as **`supabase_id`** (IndexedDB `CatchRecord`, DB version **8**).

## IndexedDB

- Opening the app upgrades **`FishLoggerV1`** to version **8**.
- Version **7** backfills existing local catches with `source = 'phone'`, `device_id = null`, and a one-time `client_event_id`.
- Version **8** backfills `photo_urls = []`.
- Handheld-origin columns are applied in `supabase/migrations/20260820120000_catches_handheld_prep.sql`.
- Catch photos: `supabase/migrations/20260822120000_catches_photo_urls.sql` and `SUPABASE_CATCH_PHOTOS.sql`.

## Required `public.catches` columns

The client sends **snake_case** fields aligned with local names. Ensure your table includes at least:

| Column | Type (suggested) | Notes |
|--------|------------------|--------|
| `id` | `uuid` | Primary key, default `gen_random_uuid()` |
| `user_id` | `uuid` | Owner; FK to `auth.users`, must equal `auth.uid()` (see `SUPABASE_AUTH_RLS.md`) |
| `session_id` | `uuid` | FK to your sessions table |
| `angler_id` | `uuid` | FK to **`public.anglers`** (`id`). Rows are **session-scoped**: same user gets a new `anglers` row per session (`session_id` + `user_id`). The app creates those rows when the cloud session starts and resolves by **`session_id` + `user_id`**, not by `user_id` alone. |
| `species` | `text` | App sends `pike`, `perch`, `zander`, `trout`, `salmon`, `other` (same as internal keys). CHECK `catches_species_allowed`. |
| `length_cm` | `numeric` | Nullable |
| `weight_kg` | `numeric` | Kilograms, nullable |
| `depth_m` | `numeric` | Nullable |
| `water_temp_c` | `numeric` | Nullable |
| `notes` | `text` | Nullable |
| `caught_at` | `timestamptz` | From local `timestamp` (ISO string) |
| `location_lat` | `double precision` | Nullable |
| `location_lng` | `double precision` | Nullable |
| `location_accuracy_m` | `numeric` | Nullable |
| `location_timestamp` | `bigint` | Nullable, milliseconds |
| `depth_source` | `text` | Nullable |
| `water_temp_source` | `text` | Nullable |
| `location_source` | `text` | Nullable |
| `weather_summary` | `text` | Nullable |
| `air_temp_c` | `numeric` | Nullable |
| `wind_speed_ms` | `numeric` | Nullable |
| `wind_direction_deg` | `numeric` | Nullable |
| `source` | `text NOT NULL` | Catch origin. Default `'phone'`. CHECK `phone` \| `handheld`. Phone save always sends `'phone'`. |
| `device_id` | `text` | Handheld device id. **NULL** for phone-created catches. |
| `client_event_id` | `uuid NOT NULL` | Idempotency key generated once at create. UNIQUE. Retries reuse this value. |
| `photo_urls` | `text[] NOT NULL` | Public Storage URLs, 0–2 photos. Default `'{}'`. CHECK `catches_photo_urls_max_two`. Handheld sends empty. |

## Example: add missing columns (PostgreSQL)

Run in the Supabase SQL editor only for columns you do not already have:

```sql
alter table public.catches
  add column if not exists depth_m numeric,
  add column if not exists water_temp_c numeric,
  add column if not exists notes text,
  add column if not exists caught_at timestamptz,
  add column if not exists location_lat double precision,
  add column if not exists location_lng double precision,
  add column if not exists location_accuracy_m numeric,
  add column if not exists location_timestamp bigint,
  add column if not exists depth_source text,
  add column if not exists water_temp_source text,
  add column if not exists location_source text,
  add column if not exists weather_summary text,
  add column if not exists air_temp_c numeric,
  add column if not exists wind_speed_ms numeric,
  add column if not exists wind_direction_deg numeric;
```

If you still have **`weight_g`**, rename it to **`weight_kg`** and ensure values are in **kilograms** (the app does not convert grams).

## Check constraint `catches_species_allowed`

If inserts fail with:

`new row for relation "catches" violates check constraint "catches_species_allowed"`

your table only allows a fixed set of `species` values, and the **Muu** option uses **`other`**, which is often missing from that list.

**Option A — drop the check** (simplest; the app already restricts species in the UI):

```sql
alter table public.catches
  drop constraint if exists catches_species_allowed;
```

**Option B — keep a check but allow what the app sends**:

```sql
alter table public.catches
  drop constraint if exists catches_species_allowed;

alter table public.catches
  add constraint catches_species_allowed
  check (
    species in ('pike', 'perch', 'zander', 'trout', 'salmon', 'other')
  );
```

If your constraint used different spellings (e.g. Finnish `muu` instead of `other`), either include those strings in the `in (...)` list or change the species list in `js/catchSpecies.js` to match.

## Old local catches

Catches with **`supabase_id === null`** are **not** guessed or back-filled: create/update/delete against Supabase only runs when **`supabase_id`** is set (update/delete) or after a successful insert (create).
