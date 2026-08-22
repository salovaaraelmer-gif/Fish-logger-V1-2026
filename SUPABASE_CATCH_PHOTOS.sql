-- Catch photos: column + public Storage bucket (max 2 URLs per catch).
-- Applied via MCP; keep this file as the fallback SQL.

alter table public.catches
  add column if not exists photo_urls text[] not null default '{}'::text[];

alter table public.catches
  drop constraint if exists catches_photo_urls_max_two;

alter table public.catches
  add constraint catches_photo_urls_max_two
  check (cardinality(photo_urls) between 0 and 2);

comment on column public.catches.photo_urls is
  'Public Storage URLs for up to two catch photos. Empty array if none.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catch-photos',
  'catch-photos',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "catch_photos_select_public" on storage.objects;
drop policy if exists "catch_photos_insert_own" on storage.objects;
drop policy if exists "catch_photos_update_own" on storage.objects;
drop policy if exists "catch_photos_delete_own" on storage.objects;

create policy "catch_photos_select_public"
  on storage.objects for select
  using (bucket_id = 'catch-photos');

create policy "catch_photos_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'catch-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "catch_photos_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'catch-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'catch-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "catch_photos_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'catch-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );
