/**
 * Catch origin fields and payload mapping shared by phone save, handheld save, and sync.
 * @module catchRecordMap
 */

import { isAllowedSpecies, mapSpeciesFromDb } from "./catchSpecies.js";

export const CATCH_SOURCE_PHONE = "phone";
export const CATCH_SOURCE_HANDHELD = "handheld";

/** @type {readonly string[]} */
export const CATCH_SOURCES = Object.freeze([CATCH_SOURCE_PHONE, CATCH_SOURCE_HANDHELD]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * @returns {string}
 */
export function newClientEventId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const n = (Math.random() * 16) | 0;
    const v = ch === "x" ? n : (n & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Reuse an existing client_event_id. Generate only when the catch has never had one.
 *
 * @param {string | null | undefined} existing
 * @returns {string}
 */
export function ensureClientEventId(existing) {
  if (isUuid(existing)) return existing;
  return newClientEventId();
}

/**
 * @param {unknown} value
 * @returns {"phone" | "handheld"}
 */
export function normalizeCatchSource(value) {
  return value === CATCH_SOURCE_HANDHELD ? CATCH_SOURCE_HANDHELD : CATCH_SOURCE_PHONE;
}

/**
 * Phone catches never store a device id. Handheld catches keep the provided id.
 *
 * @param {"phone" | "handheld"} source
 * @param {unknown} deviceId
 * @returns {string | null}
 */
export function normalizeDeviceId(source, deviceId) {
  if (source !== CATCH_SOURCE_HANDHELD) return null;
  if (typeof deviceId !== "string") return null;
  const trimmed = deviceId.trim();
  return trimmed ? trimmed : null;
}

/**
 * Parse catch time from handheld/cloud payloads. Does not fall back to Date.now().
 *
 * @param {unknown} caughtAt
 * @returns {{ ok: true, ms: number } | { ok: false, reason: string }}
 */
export function parseCaughtAtMs(caughtAt) {
  if (typeof caughtAt === "number" && Number.isFinite(caughtAt) && caughtAt > 0) {
    return { ok: true, ms: caughtAt };
  }
  if (caughtAt instanceof Date) {
    const ms = caughtAt.getTime();
    if (Number.isFinite(ms) && ms > 0) return { ok: true, ms };
    return { ok: false, reason: "caught_at is not a valid date." };
  }
  if (typeof caughtAt === "string" && caughtAt.trim()) {
    const ms = new Date(caughtAt).getTime();
    if (Number.isFinite(ms) && ms > 0) return { ok: true, ms };
  }
  return { ok: false, reason: "caught_at is required." };
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumberOrNull(value) {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Positive measurements only (length/weight). Null if missing or invalid.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function positiveNumberOrNull(value) {
  const n = finiteNumberOrNull(value);
  if (n == null || n <= 0) return null;
  return n;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function textOrNull(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

/**
 * @param {import('./db.js').CatchRecord} record
 * @param {string} supabaseSessionId
 * @param {string} supabaseAnglerId
 * @param {string} speciesForDb
 * @param {string} authUserId
 */
export function catchRecordToSupabasePayload(
  record,
  supabaseSessionId,
  supabaseAnglerId,
  speciesForDb,
  authUserId
) {
  const source = normalizeCatchSource(record.source);
  const len = positiveNumberOrNull(record.length);
  const w = positiveNumberOrNull(record.weight_kg);
  const depth =
    record.depth_m != null && typeof record.depth_m === "number" && Number.isFinite(record.depth_m)
      ? record.depth_m
      : null;
  const wtemp =
    record.water_temp_c != null &&
    typeof record.water_temp_c === "number" &&
    Number.isFinite(record.water_temp_c)
      ? record.water_temp_c
      : null;

  return {
    user_id: authUserId,
    session_id: supabaseSessionId,
    angler_id: supabaseAnglerId,
    species: speciesForDb,
    length_cm: len,
    weight_kg: w,
    depth_m: depth,
    water_temp_c: wtemp,
    notes: (record.notes || "").trim() || null,
    caught_at: new Date(record.timestamp).toISOString(),
    location_lat: record.location_lat,
    location_lng: record.location_lng,
    location_accuracy_m: record.location_accuracy_m,
    location_timestamp: record.location_timestamp,
    depth_source: record.depth_source,
    water_temp_source: record.water_temp_source,
    location_source: record.location_source,
    weather_summary: record.weather_summary,
    air_temp_c: record.air_temp_c,
    wind_speed_ms: record.wind_speed_ms,
    wind_direction_deg: record.wind_direction_deg,
    source,
    device_id: normalizeDeviceId(source, record.device_id),
    client_event_id: record.client_event_id,
  };
}

/**
 * Postgres unique_violation. A retry with the same client_event_id is not a new catch.
 *
 * @param {{ code?: string | null, message?: string | null } | null | undefined} error
 * @returns {boolean}
 */
export function isClientEventIdConflict(error) {
  if (!error) return false;
  if (error.code === "23505") return true;
  const msg = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return msg.includes("client_event_id") && (msg.includes("duplicate") || msg.includes("unique"));
}

/**
 * Handheld payload → local CatchRecord. Preserves timestamp and source metadata.
 * Does not use Date.now(), phone GPS, or "manual" source defaults.
 *
 * @param {Record<string, unknown>} payload
 * @param {{
 *   localSessionId: string,
 *   localAnglerId: string,
 *   localCatchId: string,
 *   supabaseId?: string | null,
 * }} ids
 * @returns {{ ok: true, record: import('./db.js').CatchRecord } | { ok: false, reason: string }}
 */
export function handheldPayloadToCatchRecord(payload, ids) {
  const source = payload.source;
  if (source !== CATCH_SOURCE_HANDHELD) {
    return { ok: false, reason: "Handheld catch source must be 'handheld'." };
  }
  if (!isUuid(payload.client_event_id)) {
    return { ok: false, reason: "client_event_id is required and must not be regenerated." };
  }
  const deviceId = normalizeDeviceId(CATCH_SOURCE_HANDHELD, payload.device_id);
  if (!deviceId) {
    return { ok: false, reason: "device_id is required for handheld catches." };
  }
  if (!isUuid(payload.session_id)) {
    return { ok: false, reason: "session_id is required." };
  }
  if (!isUuid(payload.angler_id)) {
    return { ok: false, reason: "angler_id is required." };
  }
  const species = mapSpeciesFromDb(payload.species);
  if (!isAllowedSpecies(species)) {
    return { ok: false, reason: "Invalid species." };
  }
  const caught = parseCaughtAtMs(payload.caught_at);
  if (!caught.ok) {
    return { ok: false, reason: caught.reason };
  }

  /** @type {import('./db.js').CatchRecord} */
  const record = {
    id: ids.localCatchId,
    sessionId: ids.localSessionId,
    anglerId: ids.localAnglerId,
    timestamp: caught.ms,
    species,
    length: positiveNumberOrNull(payload.length_cm),
    weight_kg: positiveNumberOrNull(payload.weight_kg),
    notes: typeof payload.notes === "string" ? payload.notes.trim() : "",
    depth_m: finiteNumberOrNull(payload.depth_m),
    water_temp_c: finiteNumberOrNull(payload.water_temp_c),
    location_lat: finiteNumberOrNull(payload.location_lat),
    location_lng: finiteNumberOrNull(payload.location_lng),
    location_accuracy_m: finiteNumberOrNull(payload.location_accuracy_m),
    location_timestamp:
      payload.location_timestamp != null && Number.isFinite(Number(payload.location_timestamp))
        ? Number(payload.location_timestamp)
        : null,
    depth_source: textOrNull(payload.depth_source),
    water_temp_source: textOrNull(payload.water_temp_source),
    location_source: textOrNull(payload.location_source),
    weather_summary: textOrNull(payload.weather_summary),
    air_temp_c: finiteNumberOrNull(payload.air_temp_c),
    wind_speed_ms: finiteNumberOrNull(payload.wind_speed_ms),
    wind_direction_deg: finiteNumberOrNull(payload.wind_direction_deg),
    supabase_id: ids.supabaseId ?? null,
    source: CATCH_SOURCE_HANDHELD,
    device_id: deviceId,
    client_event_id: payload.client_event_id,
  };

  return { ok: true, record };
}

/**
 * Cloud catch row → local CatchRecord. Keeps salmon and origin fields as stored.
 *
 * @param {Record<string, unknown>} row
 * @param {string} localSessionId
 * @param {string} anglerProfileId
 * @param {string} localCatchId
 * @returns {import('./db.js').CatchRecord}
 */
export function cloudCatchRowToLocal(row, localSessionId, anglerProfileId, localCatchId) {
  const caught = parseCaughtAtMs(row.caught_at);
  const len = positiveNumberOrNull(row.length_cm);
  const source = normalizeCatchSource(row.source);
  const eventId = isUuid(row.client_event_id) ? row.client_event_id : ensureClientEventId(null);
  return {
    id: localCatchId,
    sessionId: localSessionId,
    anglerId: anglerProfileId,
    timestamp: caught.ok ? caught.ms : 0,
    species: mapSpeciesFromDb(row.species),
    length: len,
    weight_kg: positiveNumberOrNull(row.weight_kg),
    notes: typeof row.notes === "string" ? row.notes : "",
    depth_m: finiteNumberOrNull(row.depth_m),
    water_temp_c: finiteNumberOrNull(row.water_temp_c),
    location_lat: finiteNumberOrNull(row.location_lat),
    location_lng: finiteNumberOrNull(row.location_lng),
    location_accuracy_m: finiteNumberOrNull(row.location_accuracy_m),
    location_timestamp:
      row.location_timestamp != null && Number.isFinite(Number(row.location_timestamp))
        ? Number(row.location_timestamp)
        : null,
    depth_source: textOrNull(row.depth_source),
    water_temp_source: textOrNull(row.water_temp_source),
    location_source: textOrNull(row.location_source),
    weather_summary: textOrNull(row.weather_summary),
    air_temp_c: finiteNumberOrNull(row.air_temp_c),
    wind_speed_ms: finiteNumberOrNull(row.wind_speed_ms),
    wind_direction_deg: finiteNumberOrNull(row.wind_direction_deg),
    supabase_id: typeof row.id === "string" ? row.id : null,
    source,
    device_id: normalizeDeviceId(source, row.device_id),
    client_event_id: eventId,
  };
}

export const CATCH_CLOUD_SELECT_COLUMNS = [
  "id",
  "angler_id",
  "species",
  "length_cm",
  "weight_kg",
  "depth_m",
  "water_temp_c",
  "notes",
  "caught_at",
  "location_lat",
  "location_lng",
  "location_accuracy_m",
  "location_timestamp",
  "depth_source",
  "water_temp_source",
  "location_source",
  "weather_summary",
  "air_temp_c",
  "wind_speed_ms",
  "wind_direction_deg",
  "source",
  "device_id",
  "client_event_id",
].join(", ");
