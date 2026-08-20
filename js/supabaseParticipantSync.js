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
} from "./db.js";
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