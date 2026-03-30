# Supabase `catches` table — sync with the app

The app stores the remote row UUID on each local catch as **`supabase_id`** (IndexedDB `CatchRecord`, DB version **4**).

## IndexedDB

- Opening the app upgrades **`FishLoggerV1`** to version **4**.
- Existing catch rows get **`supabase_id: null`** until a new catch is synced or you re-log catches.

## Required `public.catches` columns

The client sends **snake_case** fields aligned with local names. Ensure your table includes at least:

| Column | Type (suggested) | Notes |
|--------|------------------|--------|
| `id` | `uuid` | Primary key, default `gen_random_uuid()` |
| `session_id` | `uuid` | FK to your sessions table |
| `angler_id` | `uuid` | FK to your anglers table |
| `species` | `text` | e.g. `pike`, `perch`, … |
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

## Old local catches

Catches with **`supabase_id === null`** are **not** guessed or back-filled: create/update/delete against Supabase only runs when **`supabase_id`** is set (update/delete) or after a successful insert (create).
