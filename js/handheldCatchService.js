/**
 * Persistence for catches that originate on a BLE handheld.
 * BLE transport is not implemented here — callers pass an already-decoded payload.
 *
 * Do not route handheld data through `saveCatch()` (phone GPS, Date.now(), "manual" sources).
 * @module handheldCatchService
 */

import { getAuthUserId } from "./auth.js";
import {
  getCatchByClientEventId,
  getSessionBySupabaseCloudId,
  putCatch,
} from "./db.js";
import { newId } from "./sessionService.js";
import { fetchAnglerForHandheldCatch } from "./legacyAnglers.js";
import {
  CATCH_SOURCE_HANDHELD,
  catchRecordToSupabasePayload,
  handheldPayloadToCatchRecord,
  isAllowedSpecies,
} from "./catchRecordMap.js";
import { insertSupabaseCatch } from "./supabaseCatchSync.js";

/**
 * @typedef {{
 *   session_id: string,
 *   angler_id: string,
 *   species: string,
 *   length_cm: number | null,
 *   weight_kg: number | null,
 *   depth_m: number | null,
 *   depth_source: string | null,
 *   water_temp_c: number | null,
 *   water_temp_source: string | null,
 *   caught_at: string | number,
 *   location_lat: number | null,
 *   location_lng: number | null,
 *   location_source: string | null,
 *   location_timestamp: number | null,
 *   device_id: string,
 *   client_event_id: string,
 *   source: "handheld",
 * }} HandheldCatchPayload
 */

/**
 * Saves a handheld-originated catch. Idempotent on `client_event_id`:
 * retries reuse the same id and do not insert a second row.
 *
 * Cloud `angler_id` is always `public.anglers.id` (session-scoped).
 * `user_id` is the signed-in AnglrLog account.
 *
 * @param {HandheldCatchPayload | Record<string, unknown>} payload
 * @returns {Promise<{
 *   ok: true,
 *   record: import('./db.js').CatchRecord,
 *   reused: boolean,
 *   supabaseAnglerId: string,
 * } | { ok: false, reason: string }>}
 */
export async function saveHandheldCatch(payload) {
  const raw = payload && typeof payload === "object" ? payload : {};
  if (raw.source !== CATCH_SOURCE_HANDHELD) {
    return { ok: false, reason: "Handheld catch source must be 'handheld'." };
  }

  const authUserId = await getAuthUserId();
  if (!authUserId) {
    return { ok: false, reason: "Not signed in." };
  }

  const angler = await fetchAnglerForHandheldCatch(raw.session_id, raw.angler_id);
  if (!angler) {
    return {
      ok: false,
      reason:
        "No session-scoped anglers row found for this handheld catch (public.anglers.id).",
    };
  }

  const localSession = await getSessionBySupabaseCloudId(angler.session_id);
  const localSessionId = localSession?.id ?? null;
  if (!localSessionId) {
    return {
      ok: false,
      reason: "No local session is linked to this cloud session_id.",
    };
  }

  const existing = await getCatchByClientEventId(raw.client_event_id);
  const localCatchId = existing?.id ?? newId();
  const mapped = handheldPayloadToCatchRecord(raw, {
    localSessionId,
    localAnglerId: angler.user_id,
    localCatchId,
    supabaseId: existing?.supabase_id ?? null,
  });
  if (!mapped.ok) return mapped;

  const record = mapped.record;
  if (existing) {
    record.id = existing.id;
    record.client_event_id = existing.client_event_id;
    if (existing.supabase_id) record.supabase_id = existing.supabase_id;
  }

  if (!isAllowedSpecies(record.species)) {
    return { ok: false, reason: "Invalid species." };
  }

  try {
    await putCatch(record);
  } catch (err) {
    console.error("[handheld catch] local save failed:", err);
    return { ok: false, reason: "Local save failed." };
  }

  const speciesForDb = record.species;
  const cloudPayload = catchRecordToSupabasePayload(
    record,
    angler.session_id,
    angler.id,
    speciesForDb,
    authUserId
  );

  if (record.supabase_id) {
    return {
      ok: true,
      record,
      reused: true,
      supabaseAnglerId: angler.id,
    };
  }

  const ins = await insertSupabaseCatch(cloudPayload);
  if (!ins.ok) {
    return { ok: false, reason: ins.error };
  }

  const withRemote = { ...record, supabase_id: ins.id };
  await putCatch(withRemote);

  return {
    ok: true,
    record: withRemote,
    reused: Boolean(existing),
    supabaseAnglerId: angler.id,
  };
}
