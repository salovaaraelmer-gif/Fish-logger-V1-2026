/**
 * Session-scoped `public.anglers` rows for `catches.angler_id` FK.
 * Each cloud session gets one `anglers` row per participant (`session_id`, `user_id`, `name`).
 * Lookups use `session_id` + `user_id` only (not global `user_id`).
 * Session membership itself lives in `session_anglers`.
 * @module legacyAnglers
 */

import { supabase } from "./supabase.js";
import { missingAnglersRowUiMessage } from "./sessionCloudParse.js";

export { missingAnglersRowUiMessage };

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
 * @param {string} cloudSessionId
 * @param {string} userId
 * @returns {Promise<{ exists: boolean, error: string | null }>}
 */
export async function fetchSessionMembership(cloudSessionId, userId) {
  if (!cloudSessionId || !userId) {
    return { exists: false, error: null };
  }
  const { data, error } = await supabase
    .from("session_anglers")
    .select("id")
    .eq("session_id", cloudSessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[session_anglers] membership lookup failed:", error.message);
    return { exists: false, error: error.message };
  }
  return {
    exists: Boolean(data && typeof data.id === "string" && data.id),
    error: null,
  };
}

/**
 * Resolve `public.anglers.id` for a participant. If they are already on the
 * `session_anglers` roster but the mapping row is missing, insert it once.
 * Does not create session membership.
 *
 * @param {string} cloudSessionId
 * @param {string} userId
 * @returns {Promise<{
 *   ok: true,
 *   id: string,
 *   repaired: boolean,
 *   membershipExists: true,
 * } | {
 *   ok: false,
 *   membershipExists: boolean,
 * }>}
 */
export async function resolveSessionScopedAnglerId(cloudSessionId, userId) {
  if (!cloudSessionId || !userId) {
    return { ok: false, membershipExists: false };
  }
  const existing = await fetchSessionAnglerIdBySessionAndUser(cloudSessionId, userId);
  if (existing) {
    return { ok: true, id: existing, repaired: false, membershipExists: true };
  }
  const membership = await fetchSessionMembership(cloudSessionId, userId);
  if (!membership.exists) {
    return { ok: false, membershipExists: false };
  }
  const inserted = await supabase
    .from("anglers")
    .insert({
      session_id: cloudSessionId,
      user_id: userId,
      name: "Angler",
    })
    .select("id")
    .maybeSingle();
  if (!inserted.error && inserted.data && typeof inserted.data.id === "string") {
    return { ok: true, id: inserted.data.id, repaired: true, membershipExists: true };
  }
  const code =
    inserted.error && typeof inserted.error === "object" && "code" in inserted.error
      ? String(inserted.error.code)
      : "";
  if (code === "23505") {
    const again = await fetchSessionAnglerIdBySessionAndUser(cloudSessionId, userId);
    if (again) {
      return { ok: true, id: again, repaired: false, membershipExists: true };
    }
  }
  if (inserted.error) {
    console.warn("[anglers] repair insert failed:", inserted.error.message);
  }
  return { ok: false, membershipExists: true };
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

