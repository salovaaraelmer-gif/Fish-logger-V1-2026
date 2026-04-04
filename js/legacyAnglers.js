/**
 * Session-scoped `public.anglers` rows for `catches.angler_id` FK.
 * Each cloud session gets one `anglers` row per participant (`session_id`, `user_id`, `name`).
 * Lookups use `session_id` + `user_id` only (not global `user_id`).
 * @module legacyAnglers
 */

import { supabase } from "./supabase.js";

/**
 * @param {string} cloudSessionId — `public.sessions.id`
 * @param {string} userId — participant `auth.users.id` / `profiles.id`
 * @returns {Promise<string | null>} `public.anglers.id`
 */
export async function fetchSessionAnglerIdBySessionAndUser(cloudSessionId, userId) {
  if (!cloudSessionId || !userId) return null;
  const { data, error } = await supabase
    .from("anglers")
    .select("id")
    .eq("session_id", cloudSessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[anglers] lookup session+user failed:", error.message);
    return null;
  }
  if (data && typeof data.id === "string" && data.id.length > 0) {
    return data.id;
  }
  return null;
}

/**
 * Creates one `public.anglers` row per participant after the cloud session exists.
 * @param {string} cloudSessionId
 * @param {{ user_id: string, name: string }[]} entries
 * @returns {Promise<{ ok: true, idByUserId: Map<string, string> } | { ok: false, error: string }>}
 */
export async function insertSessionScopedAnglers(cloudSessionId, entries) {
  if (!cloudSessionId || !Array.isArray(entries) || entries.length === 0) {
    return { ok: true, idByUserId: new Map() };
  }
  const rows = entries.map((e) => ({
    session_id: cloudSessionId,
    user_id: e.user_id,
    name: (e.name || "").trim() || "Kalastaja",
  }));
  const { data, error } = await supabase.from("anglers").insert(rows).select("id, user_id");
  if (error) {
    console.error("[anglers] session-scoped insert failed:", error.message);
    return { ok: false, error: error.message };
  }
  /** @type {Map<string, string>} */
  const idByUserId = new Map();
  for (const row of data || []) {
    if (row && typeof row.user_id === "string" && typeof row.id === "string") {
      idByUserId.set(row.user_id, row.id);
    }
  }
  if (idByUserId.size !== entries.length) {
    return { ok: false, error: "Supabase palautti odotettua vähemmän anglers-rivejä." };
  }
  return { ok: true, idByUserId };
}
