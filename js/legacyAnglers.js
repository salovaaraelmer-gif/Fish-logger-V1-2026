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
 * Resolve the session-scoped `public.anglers` row for a handheld catch.
 * Prefer `anglers.id`; fall back to (`session_id`, `user_id`) if the payload
 * sent a profile id. Cloud inserts must use `anglers.id`, never the profile id.
 *
 * @param {unknown} cloudSessionId
 * @param {unknown} anglerIdOrUserId
 * @returns {Promise<{ id: string, user_id: string, session_id: string } | null>}
 */
export async function fetchAnglerForHandheldCatch(cloudSessionId, anglerIdOrUserId) {
  if (typeof cloudSessionId !== "string" || !cloudSessionId) return null;
  if (typeof anglerIdOrUserId !== "string" || !anglerIdOrUserId) return null;

  const byPk = await supabase
    .from("anglers")
    .select("id, user_id, session_id")
    .eq("id", anglerIdOrUserId)
    .maybeSingle();
  if (!byPk.error && byPk.data && typeof byPk.data.id === "string") {
    if (byPk.data.session_id === cloudSessionId && typeof byPk.data.user_id === "string") {
      return {
        id: byPk.data.id,
        user_id: byPk.data.user_id,
        session_id: byPk.data.session_id,
      };
    }
  }

  const bySessionUser = await supabase
    .from("anglers")
    .select("id, user_id, session_id")
    .eq("session_id", cloudSessionId)
    .eq("user_id", anglerIdOrUserId)
    .maybeSingle();
  if (
    !bySessionUser.error &&
    bySessionUser.data &&
    typeof bySessionUser.data.id === "string" &&
    typeof bySessionUser.data.user_id === "string" &&
    typeof bySessionUser.data.session_id === "string"
  ) {
    return {
      id: bySessionUser.data.id,
      user_id: bySessionUser.data.user_id,
      session_id: bySessionUser.data.session_id,
    };
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
    name: (e.name || "").trim() || "Angler",
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
    return { ok: false, error: "Supabase returned fewer angler rows than expected." };
  }
  return { ok: true, idByUserId };
}
