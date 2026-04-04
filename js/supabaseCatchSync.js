/**
 * Supabase catch row sync (create / update / delete).
 * Uses `CatchRecord.supabase_id` as the only link to remote rows.
 *
 * Required `public.catches` columns (add via Supabase SQL if missing):
 * - user_id (uuid, FK to auth.users) — owner; required for RLS
 * - id (uuid, default gen_random_uuid())
 * - session_id (uuid, FK)
 * - angler_id (uuid, FK) — `public.profiles.id` (same as `auth.users.id` for that angler)
 * - species (text)
 * - length_cm (numeric, nullable)
 * - weight_kg (numeric, nullable)
 * - depth_m (numeric, nullable)
 * - water_temp_c (numeric, nullable)
 * - notes (text, nullable)
 * - caught_at (timestamptz)
 * - location_lat, location_lng, location_accuracy_m (numeric, nullable)
 * - location_timestamp (bigint, nullable) — device ms
 * - depth_source, water_temp_source, location_source (text, nullable)
 * - weather_summary (text, nullable)
 * - air_temp_c, wind_speed_ms, wind_direction_deg (numeric, nullable)
 *
 * @module supabaseCatchSync
 */

import { supabase } from "./supabase.js";

/**
 * @param {import('./db.js').CatchRecord} record
 * @param {string} supabaseSessionId
 * @param {string} supabaseAnglerId
 * @param {string} speciesForDb
 * @param {string} authUserId — `auth.uid()` for the row owner
 */
export function catchRecordToSupabasePayload(
  record,
  supabaseSessionId,
  supabaseAnglerId,
  speciesForDb,
  authUserId
) {
  const len =
    record.length != null && typeof record.length === "number" && record.length >= 1
      ? record.length
      : null;
  const w =
    record.weight_kg != null &&
    typeof record.weight_kg === "number" &&
    Number.isFinite(record.weight_kg) &&
    record.weight_kg > 0
      ? record.weight_kg
      : null;
  const depth =
    record.depth_m != null && typeof record.depth_m === "number" && Number.isFinite(record.depth_m)
      ? record.depth_m
      : null;
  const wtemp =
    record.water_temp_c != null &&
    typeof record.water_temp_c === "number" &&
    Number.isFinite(record.water_temp_c)
      ? record.water_temp_c
      : null;

  return {
    user_id: authUserId,
    session_id: supabaseSessionId,
    angler_id: supabaseAnglerId,
    species: speciesForDb,
    length_cm: len,
    weight_kg: w,
    depth_m: depth,
    water_temp_c: wtemp,
    notes: (record.notes || "").trim() || null,
    caught_at: new Date(record.timestamp).toISOString(),
    location_lat: record.location_lat,
    location_lng: record.location_lng,
    location_accuracy_m: record.location_accuracy_m,
    location_timestamp: record.location_timestamp,
    depth_source: record.depth_source,
    water_temp_source: record.water_temp_source,
    location_source: record.location_source,
    weather_summary: record.weather_summary,
    air_temp_c: record.air_temp_c,
    wind_speed_ms: record.wind_speed_ms,
    wind_direction_deg: record.wind_direction_deg,
  };
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {Promise<{ ok: true, id: string } | { ok: false, error: string }>}
 */
export async function insertSupabaseCatch(payload) {
  const { data, error } = await supabase.from("catches").insert([payload]).select("id").single();
  if (error) {
    return { ok: false, error: error.message };
  }
  const id = data && typeof data.id === "string" ? data.id : null;
  if (!id) {
    return { ok: false, error: "Supabase ei palauttanut saaliin id:tä." };
  }
  return { ok: true, id };
}

/**
 * @param {string} supabaseRowId
 * @param {Record<string, unknown>} payload
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function updateSupabaseCatch(supabaseRowId, payload) {
  const { error } = await supabase.from("catches").update(payload).eq("id", supabaseRowId);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * @param {string} supabaseRowId
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function deleteSupabaseCatch(supabaseRowId) {
  const { error } = await supabase.from("catches").delete().eq("id", supabaseRowId);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
