-- Session owner can manage fishing-spot / target-species links before session_anglers exists.
drop policy if exists "session_target_species_select_participant" on public.session_target_species;
drop policy if exists "session_target_species_insert_participant" on public.session_target_species;
drop policy if exists "session_target_species_delete_participant" on public.session_target_species;
drop policy if exists "session_fishing_locations_select_participant" on public.session_fishing_locations;
drop policy if exists "session_fishing_locations_insert_participant" on public.session_fishing_locations;
drop policy if exists "session_fishing_locations_delete_participant" on public.session_fishing_locations;

create policy "session_target_species_select_participant"
  on public.session_target_species for select to authenticated
  using (public.is_session_participant(session_id) or public.is_session_owner(session_id));
create policy "session_target_species_insert_participant"
  on public.session_target_species for insert to authenticated
  with check (public.is_session_participant(session_id) or public.is_session_owner(session_id));
create policy "session_target_species_delete_participant"
  on public.session_target_species for delete to authenticated
  using (public.is_session_participant(session_id) or public.is_session_owner(session_id));

create policy "session_fishing_locations_select_participant"
  on public.session_fishing_locations for select to authenticated
  using (public.is_session_participant(session_id) or public.is_session_owner(session_id));
create policy "session_fishing_locations_insert_participant"
  on public.session_fishing_locations for insert to authenticated
  with check (public.is_session_participant(session_id) or public.is_session_owner(session_id));
create policy "session_fishing_locations_delete_participant"
  on public.session_fishing_locations for delete to authenticated
  using (public.is_session_participant(session_id) or public.is_session_owner(session_id));
