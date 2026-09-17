/**
 * Pure helpers for cloud session create and participant-mapping errors.
 * Kept free of the Supabase client so Node tests can import them.
 * @module sessionCloudParse
 */

/**
 * Owner first, then other unique ids.
 * @param {string | null | undefined} ownerId
 * @param {string[]} ids
 * @returns {string[]}
 */
export function normalizeParticipantIds(ownerId, ids) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  if (typeof ownerId === "string" && ownerId) {
    out.push(ownerId);
    seen.add(ownerId);
  }
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * @param {unknown} data
 * @returns {Record<string, unknown> | null}
 */
function asObject(data) {
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === "object" ? /** @type {Record<string, unknown>} */ (parsed) : null;
    } catch {
      return null;
    }
  }
  if (data && typeof data === "object") {
    return /** @type {Record<string, unknown>} */ (data);
  }
  return null;
}

/**
 * @param {unknown} data
 * @returns {{ ok: true, sessionId: string, idByUserId: Map<string, string> } | { ok: false, error: string }}
 */
export function parseCreateFishingSessionResult(data) {
  const obj = asObject(data);
  if (!obj) {
    return { ok: false, error: "Could not start the session in the cloud. No session was created." };
  }
  const sessionId = typeof obj.session_id === "string" ? obj.session_id : "";
  const raw = obj.participants;
  const list = Array.isArray(raw) ? raw : [];
  /** @type {Map<string, string>} */
  const idByUserId = new Map();
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = /** @type {Record<string, unknown>} */ (row);
    if (typeof r.user_id === "string" && typeof r.angler_id === "string") {
      idByUserId.set(r.user_id, r.angler_id);
    }
  }
  if (!sessionId || idByUserId.size === 0) {
    return { ok: false, error: "Could not start the session in the cloud. No session was created." };
  }
  return { ok: true, sessionId, idByUserId };
}

/**
 * User-facing cloud create error. Raw Postgres text stays in logs.
 * @param {string | null | undefined} rpcMessage
 */
export function cloudSessionCreateUiError(rpcMessage) {
  const msg = (rpcMessage || "").trim();
  if (/not authenticated/i.test(msg)) {
    return "Not signed in. Please log in again.";
  }
  if (/profile/i.test(msg)) {
    return "The session was not started because a participant does not have a profile.";
  }
  if (/too many/i.test(msg)) {
    return "Too many participants for one session.";
  }
  if (/at least one participant/i.test(msg)) {
    return "Select at least one angler.";
  }
  return "Could not start the session in the cloud. No session was created.";
}

/**
 * User-facing catch-sync error when the mapping row is missing.
 * Identifiers stay in the console, not this string.
 */
export function missingAnglersRowUiMessage() {
  return "This catch could not be saved to the cloud because the participant is not set up for this session.";
}
