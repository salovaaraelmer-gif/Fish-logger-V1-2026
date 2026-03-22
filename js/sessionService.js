/**
 * Single active session, angler membership rules.
 * @module sessionService
 */

import {
  getActiveSession,
  getAllAnglers,
  getSessionAnglersForSession,
  findSessionAngler,
  putSession,
  putSessionAngler,
  isAnglerInAnyActiveSession,
} from "./db.js";

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * @param {string[]} anglerIds
 * @returns {Promise<{ ok: true, sessionId: string } | { ok: false, reason: string }>}
 */
export async function startSession(anglerIds) {
  const unique = [...new Set(anglerIds)].filter(Boolean);
  if (unique.length === 0) {
    return { ok: false, reason: "Valitse vähintään yksi kalastaja." };
  }

  const existing = await getActiveSession();
  if (existing) {
    return { ok: false, reason: "Aktiivinen sessio on jo käynnissä." };
  }

  for (const aid of unique) {
    const busy = await isAnglerInAnyActiveSession(aid);
    if (busy) {
      return { ok: false, reason: "Kalastaja on jo toisessa aktiivisessa sessiossa." };
    }
  }

  const all = await getAllAnglers();
  const idSet = new Set(all.map((a) => a.id));
  for (const aid of unique) {
    if (!idSet.has(aid)) {
      return { ok: false, reason: "Tuntematon kalastaja." };
    }
  }

  const sessionId = newId();
  const now = Date.now();
  await putSession({
    id: sessionId,
    startTime: now,
    endTime: null,
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

  return { ok: true, sessionId };
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function endActiveSession() {
  const s = await getActiveSession();
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
 * @param {string} sessionId
 * @param {string} anglerId
 */
export async function addAnglerToSession(sessionId, anglerId) {
  const active = await getActiveSession();
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

export { newId };
