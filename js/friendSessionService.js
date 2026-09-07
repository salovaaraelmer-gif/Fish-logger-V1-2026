/**
 * Friend-visible sessions and catches via RLS-backed RPCs (GPS already masked).
 * @module friendSessionService
 */

import { getAuthUserId } from "./auth.js";
import { mapSpeciesFromDb } from "./catchSpecies.js";
import { normalizePhotoUrls } from "./catchRecordMap.js";
import { defaultFeedVisibility, mergeFeedSessionsById, visibleFeedSessions } from "./feedSessionModel.js";
import { supabase } from "./supabase.js";
import { yearsFromTimestamps } from "./userStatsCalc.js";

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} iso
 * @returns {number}
 */
function isoToMs(iso) {
  if (!iso) return Date.now();
  const ms = new Date(String(iso)).getTime();
  return Number.isFinite(ms) ? ms : Date.now();
}

/**
 * @param {Record<string, unknown>} row
 * @returns {import('./db.js').CatchRecord}
 */
export function viewerCatchToRecord(row) {
  const id = typeof row.id === "string" ? row.id : "";
  const sessionId = typeof row.session_id === "string" ? row.session_id : "";
  const userId = typeof row.user_id === "string" ? row.user_id : "";
  const species = mapSpeciesFromDb(row.species) || "other";
  return {
    id,
    sessionId,
    anglerId: userId,
    timestamp: isoToMs(row.caught_at || row.created_at),
    species,
    length: finiteOrNull(row.length_cm),
    weight_kg: finiteOrNull(row.weight_kg),
    notes: typeof row.notes === "string" ? row.notes : "",
    depth_m: finiteOrNull(row.depth_m),
    water_temp_c: finiteOrNull(row.water_temp_c),
    location_lat: finiteOrNull(row.location_lat),
    location_lng: finiteOrNull(row.location_lng),
    location_accuracy_m: finiteOrNull(row.location_accuracy_m),
    location_timestamp: null,
    depth_source: null,
    water_temp_source: null,
    location_source: null,
    weather_summary: null,
    air_temp_c: null,
    wind_speed_ms: null,
    wind_direction_deg: null,
    supabase_id: id,
    source: "phone",
    device_id: null,
    client_event_id: id,
    photo_urls: normalizePhotoUrls(row.photo_urls),
  };
}

/**
 * @param {Record<string, unknown>} row
 * @returns {import('./db.js').Session}
 */
export function viewerSessionToLocal(row) {
  const id = typeof row.id === "string" ? row.id : "";
  const start = isoToMs(row.started_at || row.created_at);
  const endedRaw = row.ended_at == null ? null : String(row.ended_at);
  const end = endedRaw ? isoToMs(endedRaw) : null;
  return {
    id,
    startTime: start,
    endTime: end,
    initialLocationLat: null,
    initialLocationLng: null,
    initialLocationAccuracyM: null,
    initialLocationTimestamp: null,
    csv_exported: false,
    csv_exported_at: null,
    title: typeof row.title === "string" ? row.title : "",
    supabaseSessionId: id,
    ownerUserId: typeof row.user_id === "string" ? row.user_id : null,
  };
}

/**
 * @param {{ includeOwnSessions?: boolean }} [visibility]
 * @returns {Promise<{ ok: true, sessions: import('./feedSessionModel.js').FriendSessionRow[] } | { ok: false, error: string }>}
 */
export async function fetchFriendFeedSessions(visibility = defaultFeedVisibility()) {
  const uid = await getAuthUserId();
  const includeOwn = Boolean(visibility?.includeOwnSessions);
  const { data, error } = await supabase.rpc("list_friend_feed_sessions", {
    p_include_own: includeOwn,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    sessions: visibleFeedSessions(Array.isArray(data) ? data : [], uid, { includeOwnSessions: includeOwn }),
  };
}

/**
 * @param {string} userId
 */
export async function fetchOwnedSessionsForViewer(userId) {
  if (!userId) return { ok: false, error: "Missing user." };
  const { data, error } = await supabase.rpc("list_owned_sessions_for_viewer", { p_user_id: userId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, sessions: mergeFeedSessionsById(Array.isArray(data) ? data : []) };
}

/**
 * @param {string} sessionId
 */
export async function fetchSessionDetailForViewer(sessionId) {
  if (!sessionId) return { ok: false, error: "Missing session." };
  const { data, error } = await supabase.rpc("list_session_detail_for_viewer", {
    p_session_id: sessionId,
  });
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.id !== "string") return { ok: false, error: "Session not found." };
  return { ok: true, session: row };
}

/**
 * @param {string} sessionId
 */
export async function fetchSessionCatchesForViewer(sessionId) {
  if (!sessionId) return { ok: false, error: "Missing session." };
  const { data, error } = await supabase.rpc("list_session_catches_for_viewer", {
    p_session_id: sessionId,
  });
  if (error) return { ok: false, error: error.message };
  const records = (Array.isArray(data) ? data : []).map((row) =>
    viewerCatchToRecord(/** @type {Record<string, unknown>} */ (row))
  );
  return { ok: true, catches: records };
}

/**
 * @param {string} userId
 */
export async function fetchUserCatchesForViewer(userId) {
  if (!userId) return { ok: false, error: "Missing user." };
  const { data, error } = await supabase.rpc("list_user_catches_for_viewer", { p_user_id: userId });
  if (error) return { ok: false, error: error.message };
  const records = (Array.isArray(data) ? data : []).map((row) =>
    viewerCatchToRecord(/** @type {Record<string, unknown>} */ (row))
  );
  return { ok: true, catches: records };
}

/**
 * Stats bundle for a friend's owned sessions and their own catches.
 * @param {string} userId
 * @returns {Promise<import('./userStatsService.js').UserStatsBundle | null>}
 */
export async function loadFriendStatsBundle(userId) {
  const [sessionsRes, catchesRes] = await Promise.all([
    fetchOwnedSessionsForViewer(userId),
    fetchUserCatchesForViewer(userId),
  ]);
  if (!sessionsRes.ok || !catchesRes.ok) return null;
  const sessions = sessionsRes.sessions.map((row) =>
    viewerSessionToLocal(/** @type {Record<string, unknown>} */ (row))
  );
  const catches = catchesRes.catches;
  const timestamps = [...sessions.map((s) => s.startTime), ...catches.map((c) => c.timestamp)];
  return {
    userId,
    sessions,
    catches,
    years: yearsFromTimestamps(timestamps, new Date().getFullYear()),
  };
}
