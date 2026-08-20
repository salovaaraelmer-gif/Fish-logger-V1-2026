/**
 * Supabase catch row sync (create / update / delete).
 * Uses `CatchRecord.supabase_id` as the only link to remote rows.
 * Inserts are idempotent on `client_event_id` (unique).
 *
 * @module supabaseCatchSync
 */

import { supabase } from "./supabase.js";
import {
  catchRecordToSupabasePayload,
  isClientEventIdConflict,
} from "./catchRecordMap.js";

export { catchRecordToSupabasePayload };

/**
 * @param {Record<string, unknown>} payload
 * @returns {Promise<{ ok: true, id: string } | { ok: false, error: string }>}
 */
export async function insertSupabaseCatch(payload) {
  console.log("[catch] insert payload (supabase)", payload);
  const { data, error } = await supabase.from("catches").insert([payload]).select("id").single();
  if (!error) {
    console.log("[catch] insert response (supabase)", data);
    const id = data && typeof data.id === "string" ? data.id : null;
    if (!id) {
      return { ok: false, error: "Supabase did not return a catch id." };
    }
    return { ok: true, id };
  }

  if (isClientEventIdConflict(error) && typeof payload.client_event_id === "string") {
    const existing = await fetchCatchIdByClientEventId(payload.client_event_id);
    if (existing) {
      console.log("[catch] insert reused existing client_event_id", existing);
      return { ok: true, id: existing };
    }
  }

  console.error("[catch] insert error (supabase):", error.message, error);
  return { ok: false, error: error.message };
}

/**
 * @param {string} clientEventId
 * @returns {Promise<string | null>}
 */
async function fetchCatchIdByClientEventId(clientEventId) {
  const { data, error } = await supabase
    .from("catches")
    .select("id")
    .eq("client_event_id", clientEventId)
    .maybeSingle();
  if (error || !data || typeof data.id !== "string") return null;
  return data.id;
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
