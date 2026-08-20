-- Prepare public.catches for phone + handheld origin, idempotent inserts, and salmon.
-- Safe for the current empty catches table; also backfills if any rows appear.

alter table public.catches
  add column if not exists source text;

update public.catches
  set source = 'phone'
  where source is null;

alter table public.catches
  alter column source set default 'phone';

alter table public.catches
  alter column source set not null;

alter table public.catches
  drop constraint if exists catches_source_allowed;

alter table public.catches
  add constraint catches_source_allowed
  check (source in ('phone', 'handheld'));

alter table public.catches
  add column if not exists device_id text;

alter table public.catches
  add column if not exists client_event_id uuid;

update public.catches
  set client_event_id = gen_random_uuid()
  where client_event_id is null;

alter table public.catches
  alter column client_event_id set not null;

alter table public.catches
  drop constraint if exists catches_client_event_id_key;

alter table public.catches
  add constraint catches_client_event_id_key unique (client_event_id);

alter table public.catches
  drop constraint if exists catches_species_allowed;

alter table public.catches
  add constraint catches_species_allowed
  check (species in ('pike', 'perch', 'zander', 'trout', 'salmon', 'other'));

comment on column public.catches.source is
  'Catch origin: phone UI or BLE handheld. Phone inserts always send phone.';

comment on column public.catches.device_id is
  'Unique handheld device id. NULL for phone-created catches.';

comment on column public.catches.client_event_id is
  'Idempotency key generated once when the catch is originally created. Retries reuse this value.';
