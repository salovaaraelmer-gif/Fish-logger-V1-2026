/**
 * Participant-based session listing via `public.session_anglers` (not `sessions.user_id` only).
 * @module supabaseParticipantSessions
 */

import { supabase } from "./supabase.js";

/**
 * @typedef {{
 *   id: string,
 *   title: string | null,
 *   ended_at: string | null,
 *   created_at: string | null,
 *   user_id?: string | null,
 *   notes?: string | null,
 * }} CloudSessionRow
 */

/**
 * @param {unknown} row
 * @returns {CloudSessionRow | null}
 */
function normalizeSessionEmbed(row) {
  if (!row || typeof row !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (row);
  const id = typeof o.id === "string" ? o.id : null;
  if (!id) return null;
  return {
    id,
    title: typeof o.title === "string" ? o.title : null,
    ended_at: o.ended_at == null ? null : String(o.ended_at),
    created_at: o.created_at == null ? null : String(o.created_at),
    user_id: typeof o.user_id === "string" ? o.user_id : null,
    notes: typeof o.notes === "string" ? o.notes : null,
  };
}

/**
 * Fetches sessions where the user is a participant (`session_anglers.user_id = uid`).
 * Splits into active (`ended_at` is null) and ended.
 * @param {string} uid — `auth.users.id`
 * @returns {Promise<{ ok: true, active: CloudSessionRow[], ended: CloudSessionRow[] } | { ok: false, error: string }>}
 */
export async function fetchParticipantSessionsForUser(uid) {
  if (!uid) {
    return { ok: false, error: "No user id." };
  }
  const { data, error } = await supabase
    .from("session_anglers")
    .select(
      `
      session_id,
      sessions (
        id,
        title,
        ended_at,
        created_at,
        user_id,
        notes
      )
    `
    )
    .eq("user_id", uid);

  if (error) {
    return { ok: false, error: error.message };
  }

  /** @type {Map<string, CloudSessionRow>} */
  const bySessionId = new Map();
  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    const raw = r.sessions;
    const sess = Array.isArray(raw) ? raw[0] : raw;
    const norm = normalizeSessionEmbed(sess);
    if (norm) {
      bySessionId.set(norm.id, norm);
    }
  }

  /** @type {CloudSessionRow[]} */
  const active = [];
  /** @type {CloudSessionRow[]} */
  const ended = [];
  for (const s of bySessionId.values()) {
    const isEnded = s.ended_at != null && String(s.ended_at).length > 0;
    if (isEnded) {
      ended.push(s);
    } else {
      active.push(s);
    }
  }

  const ts = (s) => {
    const c = s.created_at ? new Date(s.created_at).getTime() : 0;
    return Number.isFinite(c) ? c : 0;
  };
  const tsEnd = (s) => {
    const e = s.ended_at ? new Date(s.ended_at).getTime() : 0;
    return Number.isFinite(e) ? e : 0;
  };

  active.sort((a, b) => ts(b) - ts(a));
  ended.sort((a, b) => tsEnd(b) - tsEnd(a));

  return { ok: true, active, ended };
}
