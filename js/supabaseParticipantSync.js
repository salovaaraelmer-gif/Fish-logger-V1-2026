/**
 * Pulls roster + catches from Supabase for devices that join as participants (no local startSession).
 * Requires RLS SELECT policies for participants on `session_anglers`, `catches`, and `anglers`.
 * @module supabaseParticipantSync
 */

import { supabase } from "./supabase.js";
import {
  putSessionAngler,
  putCatch,
  findSessionAngler,
  getCatchesForSession,
  getAllCatches,
} from "./db.js";
import { getAuthUserId } from "./auth.js";
import { fetchSessionAnglerIdBySessionAndUser } from "./legacyAnglers.js";
import {
  CATCH_CLOUD_SELECT_COLUMNS,
  cloudCatchRowToLocal,
  isUuid,
} from "./catchRecordMap.js";

function newLocalId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * @param {string} localSessionId
 * @param {string} cloudSessionId
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function pullSessionRosterAndCatchesFromCloud(localSessionId, cloudSessionId) {
  const rosterRes = await supabase
    .from("session_anglers")
    .select("user_id, created_at")
    .eq("session_id", cloudSessionId);

  if (rosterRes.error) {
    return { ok: false, error: rosterRes.error.message || "session_anglers pull failed" };
  }

  const roster = Array.isArray(rosterRes.data) ? rosterRes.data : [];
  for (const r of roster) {
    if (!r || typeof r !== "object") continue;
    const userId = /** @type {{ user_id?: string }} */ (r).user_id;
    if (typeof userId !== "string" || !userId) continue;
    const createdAt = /** @type {{ created_at?: string }} */ (r).created_at;
    const joinedAt =
      typeof createdAt === "string" && createdAt
        ? new Date(createdAt).getTime()
        : Date.now();
    const existing = await findSessionAngler(localSessionId, userId);
    await putSessionAngler({
      id: existing?.id ?? newLocalId(),
      sessionId: localSessionId,
      anglerId: userId,
      isActive: true,
      joinedAt: existing?.joinedAt ?? joinedAt,
      leftAt: null,
      supabaseAnglerId: existing?.supabaseAnglerId ?? undefined,
    });
    const scoped = await fetchSessionAnglerIdBySessionAndUser(cloudSessionId, userId);
    if (scoped) {
      const sa = await findSessionAngler(localSessionId, userId);
      if (sa) {
        await putSessionAngler({ ...sa, supabaseAnglerId: scoped });
      }
    }
  }

  const catchesRes = await supabase
    .from("catches")
    .select(CATCH_CLOUD_SELECT_COLUMNS)
    .eq("session_id", cloudSessionId);

  if (catchesRes.error) {
    return { ok: false, error: catchesRes.error.message || "catches pull failed" };
  }

  const catchRows = Array.isArray(catchesRes.data) ? catchesRes.data : [];
  const anglerFkIds = [
    ...new Set(
      catchRows
        .map((c) => (c && typeof c === "object" ? /** @type {{ angler_id?: string }} */ (c).angler_id : null))
        .filter((x) => typeof x === "string" && x)
    ),
  ];

  /** @type {Map<string, string>} */
  const profileIdByAnglersPk = new Map();
  if (anglerFkIds.length > 0) {
    const angRes = await supabase.from("anglers").select("id, user_id").in("id", anglerFkIds);
    if (angRes.error) {
      return { ok: false, error: angRes.error.message || "anglers pull failed" };
    }
    for (const a of angRes.data || []) {
      if (a && typeof a === "object" && typeof a.id === "string" && typeof a.user_id === "string") {
        profileIdByAnglersPk.set(a.id, a.user_id);
      }
    }
  }

  const existingCatches = await getCatchesForSession(localSessionId);
  /** @type {Map<string, import('./db.js').CatchRecord>} */
  const bySupabaseId = new Map();
  /** @type {Map<string, import('./db.js').CatchRecord>} */
  const byClientEventId = new Map();
  for (const c of existingCatches) {
    if (typeof c.supabase_id === "string" && c.supabase_id) {
      bySupabaseId.set(c.supabase_id, c);
    }
    if (isUuid(c.client_event_id)) {
      byClientEventId.set(c.client_event_id, c);
    }
  }

  for (const raw of catchRows) {
    if (!raw || typeof raw !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (raw);
    const sbId = typeof row.id === "string" ? row.id : null;
    if (!sbId) continue;
    const anglerFk = typeof row.angler_id === "string" ? row.angler_id : null;
    if (!anglerFk) continue;
    const profileId = profileIdByAnglersPk.get(anglerFk);
    if (!profileId) continue;

    const eventId = isUuid(row.client_event_id) ? row.client_event_id : null;
    const prev = bySupabaseId.get(sbId) || (eventId ? byClientEventId.get(eventId) : undefined);
    const localId = prev?.id ?? newLocalId();
    const rec = cloudCatchRowToLocal(row, localSessionId, profileId, localId);
    if (prev && isUuid(prev.client_event_id) && !isUuid(row.client_event_id)) {
      rec.client_event_id = prev.client_event_id;
    }
    await putCatch(rec);
    bySupabaseId.set(sbId, rec);
    if (isUuid(rec.client_event_id)) {
      byClientEventId.set(rec.client_event_id, rec);
    }
  }

  return { ok: true };
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} worker
 */
async function runPool(items, limit, worker) {
  if (items.length === 0) return;
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const i = next;
      next += 1;
      await worker(items[i]);
    }
  }
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, () => runOne()));
}

/**
 * Pull roster + catches for local sessions that have a cloud id.
 * @param {{ id: string, supabaseSessionId?: string | null }[]} sessions
 * @param {{ skipCloudIds?: Set<string>, concurrency?: number }} [opts]
 * @returns {Promise<{ pulledCloudIds: string[] }>}
 */
export async function pullRosterAndCatchesForSessions(sessions, opts = {}) {
  const skip = opts.skipCloudIds ?? new Set();
  const concurrency = opts.concurrency ?? 3;
  const jobs = sessions.filter((s) => {
    const cloudId = typeof s.supabaseSessionId === "string" ? s.supabaseSessionId : "";
    return Boolean(cloudId) && !skip.has(cloudId);
  });
  /** @type {string[]} */
  const pulledCloudIds = [];
  await runPool(jobs, concurrency, async (session) => {
    const cloudSid = /** @type {string} */ (session.supabaseSessionId);
    const pr = await pullSessionRosterAndCatchesFromCloud(session.id, cloudSid);
    if (pr.ok) pulledCloudIds.push(cloudSid);
    else console.warn("[participantSync] session pull:", pr.error);
  });
  return { pulledCloudIds };
}

/**
 * Own catches with no session, for Stats and Map on other devices.
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function pullStandaloneCatchesFromCloud() {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const catchesRes = await supabase
    .from("catches")
    .select(CATCH_CLOUD_SELECT_COLUMNS)
    .is("session_id", null)
    .eq("user_id", uid);
  if (catchesRes.error) {
    return { ok: false, error: catchesRes.error.message || "standalone catch pull failed" };
  }
  const catchRows = Array.isArray(catchesRes.data) ? catchesRes.data : [];
  const existing = await getAllCatches();
  /** @type {Map<string, import('./db.js').CatchRecord>} */
  const bySupabaseId = new Map();
  /** @type {Map<string, import('./db.js').CatchRecord>} */
  const byClientEventId = new Map();
  for (const c of existing) {
    if (c.sessionId) continue;
    if (typeof c.supabase_id === "string" && c.supabase_id) {
      bySupabaseId.set(c.supabase_id, c);
    }
    if (isUuid(c.client_event_id)) {
      byClientEventId.set(c.client_event_id, c);
    }
  }
  for (const raw of catchRows) {
    if (!raw || typeof raw !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (raw);
    const sbId = typeof row.id === "string" ? row.id : null;
    if (!sbId) continue;
    const eventId = isUuid(row.client_event_id) ? row.client_event_id : null;
    const prev = bySupabaseId.get(sbId) || (eventId ? byClientEventId.get(eventId) : undefined);
    const localId = prev?.id ?? newLocalId();
    const rec = cloudCatchRowToLocal(row, null, uid, localId);
    if (prev && isUuid(prev.client_event_id) && !isUuid(row.client_event_id)) {
      rec.client_event_id = prev.client_event_id;
    }
    await putCatch(rec);
  }
  return { ok: true };
}
