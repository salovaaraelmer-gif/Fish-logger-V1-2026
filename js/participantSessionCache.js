/**
 * Participant-based session list from Supabase (`session_anglers`) + merged local sessions.
 * Used so non-host devices resolve the same "active session" as the home UI.
 * @module participantSessionCache
 */

import { getActiveSession, getSessionBySupabaseCloudId } from "./db.js";

/** @typedef {{ id: string, title: string | null, ended_at: string | null, created_at: string | null }} CloudSessionRow */

/** @type {CloudSessionRow[]} */
let participantActiveCloudRows = [];
/** @type {CloudSessionRow[]} */
let participantEndedCloudRows = [];
let lastParticipantRehydrateOk = false;

/**
 * @param {boolean} ok
 * @param {CloudSessionRow[]} active
 * @param {CloudSessionRow[]} ended
 */
export function setParticipantSessionFetchResult(ok, active, ended) {
  lastParticipantRehydrateOk = ok;
  participantActiveCloudRows = active;
  participantEndedCloudRows = ended;
}

/** @returns {boolean} */
export function getLastParticipantRehydrateOk() {
  return lastParticipantRehydrateOk;
}

/** @returns {CloudSessionRow[]} */
export function getParticipantActiveCloudRows() {
  return participantActiveCloudRows;
}

/** @returns {CloudSessionRow[]} */
export function getParticipantEndedCloudRows() {
  return participantEndedCloudRows;
}

/**
 * Prefer active session from participant-based cloud list when online; else local `getActiveSession`.
 * @returns {Promise<import('./db.js').Session | null>}
 */
export async function getActiveSessionForParticipantUi() {
  if (typeof navigator !== "undefined" && navigator.onLine && lastParticipantRehydrateOk && participantActiveCloudRows.length > 0) {
    const primary = participantActiveCloudRows[0];
    const local = await getSessionBySupabaseCloudId(primary.id);
    if (local && local.endTime == null) {
      return local;
    }
  }
  return getActiveSession();
}
