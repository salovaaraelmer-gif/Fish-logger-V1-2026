/**
 * Single active session, angler membership rules.
 * @module sessionService
 */

import {
  getSessionById,
  getSessionAnglersForSession,
  findSessionAngler,
  putSession,
  putSessionAngler,
  isAnglerInAnyActiveSession,
} from "./db.js";
import { getAuthUserId } from "./auth.js";
import { getActiveSessionForParticipantUi } from "./participantSessionCache.js";
import { defaultSessionTitleFromDate } from "./sessionTitle.js";

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * @param {string} s
 * @returns {boolean}
 */
function isUuid(s) {
  return (
    typeof s === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
  );
}

/**
 * @typedef {{ lat: number | null, lng: number | null, accuracyM: number | null, timestamp: number | null }} InitialLocation
 */

/**
 * Opens a new session and **stores the selected anglers** as `sessionAnglers` rows (session + angler ids).
 * Catches saved while this session is active get the same `sessionId` (see `saveCatch` in catchService).
 *
 * @param {string[]} anglerIds
 * @param {InitialLocation | null} [initialLocation]
 * @returns {Promise<{ ok: true, sessionId: string, title: string } | { ok: false, reason: string }>}
 */
export async function startSession(anglerIds, initialLocation) {
  const authId = await getAuthUserId();
  let raw = [...new Set(anglerIds)].filter(Boolean);
  if (authId && !raw.includes(authId)) {
    raw = [authId, ...raw];
  }
  const unique = raw;
  if (unique.length === 0) {
    return { ok: false, reason: "Valitse vähintään yksi kalastaja." };
  }

  const existing = await getActiveSessionForParticipantUi();
  if (existing) {
    return { ok: false, reason: "Aktiivinen sessio on jo käynnissä." };
  }

  for (const aid of unique) {
    const busy = await isAnglerInAnyActiveSession(aid);
    if (busy) {
      return { ok: false, reason: "Kalastaja on jo toisessa aktiivisessa sessiossa." };
    }
  }

  for (const aid of unique) {
    if (!isUuid(aid)) {
      return { ok: false, reason: "Virheellinen osallistuja." };
    }
  }

  const sessionId = newId();
  const now = Date.now();
  const title = defaultSessionTitleFromDate(now);
  const hasLoc =
    initialLocation &&
    typeof initialLocation.lat === "number" &&
    typeof initialLocation.lng === "number";
  await putSession({
    id: sessionId,
    startTime: now,
    endTime: null,
    initialLocationLat: hasLoc ? initialLocation.lat : null,
    initialLocationLng: hasLoc ? initialLocation.lng : null,
    initialLocationAccuracyM:
      hasLoc && initialLocation.accuracyM != null ? initialLocation.accuracyM : null,
    initialLocationTimestamp:
      hasLoc && initialLocation.timestamp != null ? initialLocation.timestamp : null,
    csv_exported: false,
    csv_exported_at: null,
    title,
  });

  for (const aid of unique) {
    await putSessionAngler({
      id: newId(),
      sessionId,
      anglerId: aid,
      isActive: true,
      joinedAt: now,
      leftAt: null,
    });
  }

  return { ok: true, sessionId, title };
}

/**
 * Persists title on the active session (non-empty; empty resets to default for today).
 * @param {string} rawTitle
 * @returns {Promise<{ ok: true, title: string } | { ok: false, reason: string }>}
 */
export async function saveActiveSessionTitle(rawTitle) {
  const s = await getActiveSessionForParticipantUi();
  if (!s) {
    return { ok: false, reason: "Ei aktiivista sessiota." };
  }
  const trimmed = (rawTitle || "").trim();
  const title = trimmed || defaultSessionTitleFromDate(Date.now());
  await putSession({ ...s, title });
  return { ok: true, title };
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function endActiveSession() {
  const s = await getActiveSessionForParticipantUi();
  if (!s) {
    return { ok: false, reason: "Ei aktiivista sessiota." };
  }
  await putSession({
    ...s,
    endTime: Date.now(),
  });
  return { ok: true };
}

/**
 * Marks the active session as having exported CSV (browser download triggered).
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function markActiveSessionCsvExported() {
  const s = await getActiveSessionForParticipantUi();
  if (!s) {
    return { ok: false, reason: "Ei aktiivista sessiota." };
  }
  await putSession({
    ...s,
    csv_exported: true,
    csv_exported_at: new Date().toISOString(),
  });
  return { ok: true };
}

/**
 * Marks CSV as exported for a session by local id (e.g. ended session from detail menu).
 * @param {string} sessionId
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function markSessionCsvExportedById(sessionId) {
  const s = await getSessionById(sessionId);
  if (!s) {
    return { ok: false, reason: "Sessiota ei löytynyt." };
  }
  await putSession({
    ...s,
    csv_exported: true,
    csv_exported_at: new Date().toISOString(),
  });
  return { ok: true };
}

/**
 * @param {string} sessionId
 * @param {string} anglerId
 */
export async function addAnglerToSession(sessionId, anglerId) {
  const active = await getActiveSessionForParticipantUi();
  if (!active || active.id !== sessionId) {
    return { ok: false, reason: "Virheellinen sessio." };
  }
  const existing = await findSessionAngler(sessionId, anglerId);
  if (existing) {
    if (!existing.isActive) {
      await putSessionAngler({
        ...existing,
        isActive: true,
        leftAt: null,
      });
    }
    return { ok: true };
  }
  const busy = await isAnglerInAnyActiveSession(anglerId);
  if (busy) {
    return { ok: false, reason: "Kalastaja on jo aktiivisessa sessiossa." };
  }
  const now = Date.now();
  await putSessionAngler({
    id: newId(),
    sessionId,
    anglerId,
    isActive: true,
    joinedAt: now,
    leftAt: null,
  });
  return { ok: true };
}

/**
 * @param {string} sessionId
 * @param {string} anglerId
 */
export async function markAnglerInactive(sessionId, anglerId) {
  const sa = await findSessionAngler(sessionId, anglerId);
  if (!sa) {
    return { ok: false, reason: "Kalastajaa ei löytynyt sessiosta." };
  }
  await putSessionAngler({
    ...sa,
    isActive: false,
    leftAt: Date.now(),
  });
  return { ok: true };
}

/**
 * @param {string} sessionId
 * @param {string} anglerId
 * @returns {Promise<boolean>}
 */
export async function anglerBelongsToActiveSession(sessionId, anglerId) {
  const sa = await findSessionAngler(sessionId, anglerId);
  return !!(sa && sa.isActive);
}

/**
 * True if this angler appears on the session roster (including left / inactive rows).
 * Used for editing catches in ended sessions.
 *
 * @param {string} sessionId
 * @param {string} anglerId
 * @returns {Promise<boolean>}
 */
export async function anglerBelongsToSessionRoster(sessionId, anglerId) {
  const sa = await findSessionAngler(sessionId, anglerId);
  return !!sa;
}

export { newId };
