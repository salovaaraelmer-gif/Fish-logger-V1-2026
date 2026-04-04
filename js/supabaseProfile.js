/**
 * Supabase `public.profiles` — one row per auth user (`id` = `auth.users.id`).
 * @module supabaseProfile
 */

import { getDisplayNameFromUser } from "./auth.js";
import { supabase } from "./supabase.js";

/**
 * Reads the signed-in user's row from `public.profiles` (RLS: own row only).
 * @param {string} userId — `auth.users.id`
 * @returns {Promise<{ profile: { display_name: string | null, username: string | null } | null, error: string | null }>}
 */
export async function fetchProfileForUser(userId) {
  if (!userId) return { profile: null, error: null };
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    return { profile: null, error: error.message };
  }
  return { profile: data, error: null };
}

/**
 * @typedef {{ id: string, username: string | null, display_name: string | null }} ProfileRow
 */

/**
 * @param {string | null | undefined} raw
 * @returns {string} safe fragment for `ilike` patterns (drops `%` / `_`)
 */
export function sanitizeProfileSearchInput(raw) {
  return (raw || "").trim().replace(/[%_]/g, "");
}

/**
 * Search `public.profiles` by username or display_name (case-insensitive).
 * Requires RLS allowing authenticated users to read profiles for search (see docs).
 * @param {string} rawQuery
 * @param {number} [limit]
 * @returns {Promise<{ profiles: ProfileRow[], error: string | null }>}
 */
export async function searchProfiles(rawQuery, limit = 15) {
  const t = sanitizeProfileSearchInput(rawQuery);
  if (t.length < 1) {
    return { profiles: [], error: null };
  }
  const q = `%${t}%`;
  const cap = Math.max(1, Math.min(limit, 30));
  try {
    const [byUser, byName] = await Promise.all([
      supabase.from("profiles").select("id, username, display_name").ilike("username", q).limit(cap),
      supabase.from("profiles").select("id, username, display_name").ilike("display_name", q).limit(cap),
    ]);
    const err = byUser.error || byName.error;
    if (err) {
      console.warn("[searchProfiles] Supabase error:", err.message, err);
      return { profiles: [], error: err.message };
    }
    const merged = new Map();
    for (const row of [...(byUser.data || []), ...(byName.data || [])]) {
      if (!row || row.id == null) continue;
      const id = String(row.id);
      merged.set(id, { ...row, id });
    }
    const profiles = /** @type {ProfileRow[]} */ ([...merged.values()].slice(0, cap));
    return { profiles, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[searchProfiles] exception:", e);
    return { profiles: [], error: msg };
  }
}

/**
 * @param {string[]} ids
 * @returns {Promise<Map<string, ProfileRow>>}
 */
export async function fetchProfilesByIds(ids) {
  const uniq = [...new Set(ids)].filter((id) => typeof id === "string" && id.length > 0);
  const map = new Map();
  if (uniq.length === 0) return map;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .in("id", uniq);
  if (error || !data) {
    return map;
  }
  for (const row of data) {
    if (row && typeof row.id === "string") {
      map.set(row.id, /** @type {ProfileRow} */ (row));
    }
  }
  return map;
}

/**
 * @param {ProfileRow | undefined} row
 * @param {string} id
 * @returns {string}
 */
export function profileDisplayLabel(row, id) {
  const d = row && typeof row.display_name === "string" ? row.display_name.trim() : "";
  const u = row && typeof row.username === "string" ? row.username.trim() : "";
  if (d) return d;
  if (u) return u;
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/**
 * @param {string[]} ids
 * @returns {Promise<Record<string, string>>}
 */
export async function fetchProfileDisplayNames(ids) {
  const map = await fetchProfilesByIds(ids);
  const out = /** @type {Record<string, string>} */ ({});
  for (const id of [...new Set(ids)]) {
    if (!id) continue;
    out[id] = profileDisplayLabel(map.get(id), id);
  }
  return out;
}

/**
 * @param {string | null | undefined} email
 * @returns {string}
 */
function baseUsernameFromEmail(email) {
  if (!email || typeof email !== "string") return "user";
  const local = email.split("@")[0] || "user";
  const safe = local.replace(/[^a-zA-Z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  const core = safe.length >= 2 ? safe.slice(0, 30) : `user_${safe || "x"}`;
  return core;
}

/**
 * @param {string} base
 * @param {string} userId
 * @returns {Promise<string>}
 */
async function uniqueUsernameForUser(base, userId) {
  let candidate = (base || "user").slice(0, 30);
  for (let i = 0; i < 15; i++) {
    const { data } = await supabase.from("profiles").select("id").eq("username", candidate).maybeSingle();
    if (!data?.id || data.id === userId) return candidate;
    candidate = `${String(base || "user").slice(0, 20)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return `u_${userId.replace(/-/g, "").slice(0, 12)}_${Date.now().toString(36)}`;
}

/**
 * @param {{ id: string, email?: string | null, user_metadata?: Record<string, unknown> } | null | undefined} user
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function upsertProfileForUser(user) {
  if (!user?.id) {
    return { ok: false, error: "No user." };
  }
  const { data: existing } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  const m = user.user_metadata || {};
  let desired =
    typeof m.username === "string" && m.username.trim()
      ? m.username
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "")
          .replace(/_+/g, "_")
          .replace(/^_|_$/g, "")
      : "";
  if (desired.length < 2) desired = "";

  let username =
    typeof existing?.username === "string" && existing.username.trim()
      ? existing.username.trim()
      : "";
  if (!username) {
    username = desired
      ? await uniqueUsernameForUser(desired, user.id)
      : await uniqueUsernameForUser(baseUsernameFromEmail(user.email ?? ""), user.id);
  }

  const displayName = getDisplayNameFromUser(user).trim() || "User";
  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      username,
      display_name: displayName,
    },
    { onConflict: "id" }
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
