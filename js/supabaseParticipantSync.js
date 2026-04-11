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

function newLocalId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** @param {unknown} s */
function mapSpeciesFromDb(s) {
  const k = typeof s === "string" ? s : "";
  if (["pike", "perch", "zander", "trout", "other"].includes(k)) return k;
  return "other";
}

/** @param {unknown} v */
function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} localSessionId
 * @param {string} anglerProfileId
 * @param {string} localCatchId
 * @returns {import('./db.js').CatchRecord}
 */
function cloudCatchRowToLocal(row, localSessionId, anglerProfileId, localCatchId) {
  const caughtAt = row.caught_at;
  let ts = Date.now();
  if (typeof caughtAt === "string") {
    const t = new Date(caughtAt).getTime();
    if (Number.isFinite(t)) ts = t;
  }
  const lenRaw = numOrNull(row.length_cm);
  const len =
    lenRaw != null && lenRaw >= 1 ? Math.round(lenRaw) : null;
  const wRaw = numOrNull(row.weight_kg);
  const w = wRaw != null && wRaw > 0 ? wRaw : null;
  const sbId = typeof row.id === "string" ? row.id : null;
  return {
    id: localCatchId,
    sessionId: localSessionId,
    anglerId: anglerProfileId,
    timestamp: ts,
    species: mapSpeciesFromDb(row.species),
    length: len,
    weight_kg: w,
    notes: typeof row.notes === "string" ? row.notes : "",
    depth_m: numOrNull(row.depth_m),
    water_temp_c: numOrNull(row.water_temp_c),
    location_lat: numOrNull(row.location_lat),
    location_lng: numOrNull(row.location_lng),
    location_accuracy_m: numOrNull(row.location_accuracy_m),
    location_timestamp:
      row.location_timestamp != null && Number.isFinite(Number(row.location_timestamp))
        ? Number(row.location_timestamp)
        : null,
    depth_source: typeof row.depth_source === "string" ? row.depth_source : null,
    water_temp_source: typeof row.water_temp_source === "string" ? row.water_temp_source : null,
    location_source: typeof row.location_source === "string" ? row.location_source : null,
    weather_summary: typeof row.weather_summary === "string" ? row.weather_summary : null,
    air_temp_c: numOrNull(row.air_temp_c),
    wind_speed_ms: numOrNull(row.wind_speed_ms),
    wind_direction_deg: numOrNull(row.wind_direction_deg),
    supabase_id: sbId,
  };
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
    .select(
      "id, angler_id, species, length_cm, weight_kg, depth_m, water_temp_c, notes, caught_at, location_lat, location_lng, location_accuracy_m, location_timestamp, depth_source, water_temp_source, location_source, weather_summary, air_temp_c, wind_speed_ms, wind_direction_deg"
    )
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
  for (const c of existingCatches) {
    if (typeof c.supabase_id === "string" && c.supabase_id) {
      bySupabaseId.set(c.supabase_id, c);
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

    const prev = bySupabaseId.get(sbId);
    const localId = prev?.id ?? newLocalId();
    const rec = cloudCatchRowToLocal(row, localSessionId, profileId, localId);
    await putCatch(rec);
    bySupabaseId.set(sbId, rec);
  }

  return { ok: true };
}
