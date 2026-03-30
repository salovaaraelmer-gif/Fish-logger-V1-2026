/**
 * Catch validation and persistence.
 * @module catchService
 */

import { putCatch, getActiveSession } from "./db.js";
import { anglerBelongsToActiveSession } from "./sessionService.js";
import { newId } from "./sessionService.js";
import { fetchOpenMeteoCurrent } from "./weatherService.js";

/** @type {readonly string[]} */
export const SPECIES_OPTIONS = ["pike", "perch", "zander", "trout", "other"];

/**
 * Length (cm): optional; if set, whole number greater than 0.
 * @param {string | number | null | undefined} raw
 * @returns {{ ok: true, value: number | null } | { ok: false, reason: string }}
 */
export function parseOptionalLengthCm(raw) {
  const s = String(raw ?? "").trim();
  if (s === "") {
    return { ok: true, value: null };
  }
  if (!/^\d+$/.test(s)) {
    return { ok: false, reason: "Pituus: käytä vain numeroita (kokonaisluku cm)." };
  }
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) {
    return { ok: false, reason: "Pituus: anna positiivinen luku (cm)." };
  }
  return { ok: true, value: n };
}

/**
 * Depth (m): optional; if set, numeric and 0 or greater.
 * @param {string} raw
 * @returns {{ ok: true, value: number | null } | { ok: false, reason: string }}
 */
export function parseOptionalDepthM(raw) {
  const s = (raw || "").trim().replace(",", ".");
  if (s === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) {
    return { ok: false, reason: "Syvyys: käytä vain numeroita (m) tai jätä tyhjäksi." };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, reason: "Syvyys: anna luku ≥ 0 (m) tai jätä tyhjäksi." };
  }
  return { ok: true, value: n };
}

/**
 * Water temperature (°C): optional; if set, numeric and between -2 and 30.
 * @param {string} raw
 * @returns {{ ok: true, value: number | null } | { ok: false, reason: string }}
 */
export function parseOptionalWaterTempC(raw) {
  const s = (raw || "").trim().replace(",", ".");
  if (s === "") return { ok: true, value: null };
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    return { ok: false, reason: "Veden lämpötila: käytä vain numeroita (°C) tai jätä tyhjäksi." };
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: "Veden lämpötila: anna kelvollinen luku (°C) tai jätä tyhjäksi." };
  }
  if (n < -2 || n > 30) {
    return { ok: false, reason: "Veden lämpötila: sallittu väli on -2 … 30 °C tai jätä tyhjäksi." };
  }
  return { ok: true, value: n };
}

/**
 * Weight (kg): positive number if entered; comma or dot as decimal separator.
 * @param {string} raw
 * @returns {{ ok: true, value: number | null } | { ok: false, reason: string }}
 */
export function parseOptionalWeightKg(raw) {
  const s = (raw || "").trim().replace(",", ".");
  if (s === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) {
    return { ok: false, reason: "Paino: käytä vain numeroita (kg) tai jätä tyhjäksi." };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, reason: "Paino: anna positiivinen luku (kg) tai jätä tyhjäksi." };
  }
  return { ok: true, value: n };
}

/**
 * @typedef {{
 *   lat: number | null,
 *   lng: number | null,
 *   accuracyM: number | null,
 *   timestamp: number | null,
 *   source: string | null,
 * }} DeviceLocation
 */

/**
 * @param {import('./db.js').CatchRecord} partial
 * @param {DeviceLocation} loc
 */
function applyLocationFields(partial, loc) {
  partial.location_lat = loc.lat;
  partial.location_lng = loc.lng;
  partial.location_accuracy_m = loc.accuracyM;
  partial.location_timestamp = loc.timestamp;
  partial.location_source = loc.source;
}

/**
 * Persists a catch for the **current active session** (`session_id` → `CatchRecord.sessionId`)
 * and the chosen **angler** (`angler_id` → `CatchRecord.anglerId`). Both are set on the record;
 * callers do not pass session id — it always comes from the active session in IndexedDB.
 *
 * @param {{
 *   anglerId: string,
 *   species: string,
 *   length: number | null,
 *   weight_kg: number | null,
 *   notes: string,
 *   depth_m: number | null,
 *   water_temp_c: number | null,
 * }} input
 * @param {DeviceLocation} deviceLoc
 * @returns {Promise<{ ok: true, record: import('./db.js').CatchRecord } | { ok: false, reason: string }>}
 */
export async function saveCatch(input, deviceLoc) {
  const session = await getActiveSession();
  if (!session) {
    return { ok: false, reason: "Ei aktiivista sessiota — saalisvahti ei käytössä." };
  }
  const species = (input.species || "").trim();
  if (!species) {
    return { ok: false, reason: "Laji on pakollinen." };
  }
  if (!SPECIES_OPTIONS.includes(species)) {
    return { ok: false, reason: "Virheellinen laji." };
  }
  if (!input.anglerId) {
    return { ok: false, reason: "Kalastaja on pakollinen." };
  }
  const belongs = await anglerBelongsToActiveSession(session.id, input.anglerId);
  if (!belongs) {
    return { ok: false, reason: "Kalastaja ei kuulu tähän aktiiviseen sessioon." };
  }

  const length = input.length;
  const weightKg = input.weight_kg;
  if (length !== null && (typeof length !== "number" || length < 1)) {
    return { ok: false, reason: "Pituus: tyhjä tai positiivinen kokonaisluku (ei 0)." };
  }
  if (weightKg !== null && (typeof weightKg !== "number" || weightKg <= 0)) {
    return { ok: false, reason: "Paino: tyhjä tai positiivinen luku (kg) tai jätä tyhjäksi." };
  }

  const timestamp = Date.now();

  /** @type {import('./db.js').CatchRecord} */
  const record = {
    id: newId(),
    sessionId: session.id,
    anglerId: input.anglerId,
    timestamp,
    species,
    length,
    weight_kg: weightKg,
    notes: (input.notes || "").trim(),
    depth_m: input.depth_m,
    water_temp_c: input.water_temp_c,
    location_lat: null,
    location_lng: null,
    location_accuracy_m: null,
    location_timestamp: null,
    depth_source: input.depth_m != null ? "manual" : null,
    water_temp_source: input.water_temp_c != null ? "manual" : null,
    location_source: null,
    weather_summary: null,
    air_temp_c: null,
    wind_speed_ms: null,
    wind_direction_deg: null,
  };

  applyLocationFields(record, deviceLoc);

  let weather = null;
  if (
    record.location_lat != null &&
    record.location_lng != null &&
    typeof record.location_lat === "number" &&
    typeof record.location_lng === "number"
  ) {
    try {
      weather = await fetchOpenMeteoCurrent(record.location_lat, record.location_lng);
    } catch {
      weather = null;
    }
  }
  if (weather) {
    record.weather_summary = weather.weather_summary;
    record.air_temp_c = weather.air_temp_c;
    record.wind_speed_ms = weather.wind_speed_ms;
    record.wind_direction_deg = weather.wind_direction_deg;
  }

  await putCatch(record);

  return { ok: true, record };
}

/**
 * Updates an existing catch in the active session (same id, same session; timestamp unchanged).
 */
export async function updateCatch(input, deviceLoc, existing) {
  const session = await getActiveSession();
  if (!session) {
    return { ok: false, reason: "Ei aktiivista sessiota — saalisvahti ei käytössä." };
  }
  if (existing.sessionId !== session.id) {
    return { ok: false, reason: "Saalista ei voi muokata tässä sessiossa." };
  }
  const species = (input.species || "").trim();
  if (!species) {
    return { ok: false, reason: "Laji on pakollinen." };
  }
  if (!SPECIES_OPTIONS.includes(species)) {
    return { ok: false, reason: "Virheellinen laji." };
  }
  if (!input.anglerId) {
    return { ok: false, reason: "Kalastaja on pakollinen." };
  }
  const belongs = await anglerBelongsToActiveSession(session.id, input.anglerId);
  if (!belongs) {
    return { ok: false, reason: "Kalastaja ei kuulu tähän aktiiviseen sessioon." };
  }

  const length = input.length;
  const weightKg = input.weight_kg;
  if (length !== null && (typeof length !== "number" || length < 1)) {
    return { ok: false, reason: "Pituus: tyhjä tai positiivinen kokonaisluku (ei 0)." };
  }
  if (weightKg !== null && (typeof weightKg !== "number" || weightKg <= 0)) {
    return { ok: false, reason: "Paino: tyhjä tai positiivinen luku (kg) tai jätä tyhjäksi." };
  }

  /** @type {import('./db.js').CatchRecord} */
  const record = {
    ...existing,
    anglerId: input.anglerId,
    species,
    length,
    weight_kg: weightKg,
    notes: (input.notes || "").trim(),
    depth_m: input.depth_m,
    water_temp_c: input.water_temp_c,
    depth_source: input.depth_m != null ? "manual" : null,
    water_temp_source: input.water_temp_c != null ? "manual" : null,
  };

  applyLocationFields(record, deviceLoc);

  let weather = null;
  if (
    record.location_lat != null &&
    record.location_lng != null &&
    typeof record.location_lat === "number" &&
    typeof record.location_lng === "number"
  ) {
    try {
      weather = await fetchOpenMeteoCurrent(record.location_lat, record.location_lng);
    } catch {
      weather = null;
    }
  }
  if (weather) {
    record.weather_summary = weather.weather_summary;
    record.air_temp_c = weather.air_temp_c;
    record.wind_speed_ms = weather.wind_speed_ms;
    record.wind_direction_deg = weather.wind_direction_deg;
  }

  await putCatch(record);

  return { ok: true, record };
}

/**
 * Best-effort device location for a catch (no extra permission prompt if already decided).
 * @returns {Promise<DeviceLocation>}
 */
export function fetchDeviceLocationBestEffort() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({
        lat: null,
        lng: null,
        accuracyM: null,
        timestamp: null,
        source: null,
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : null,
          timestamp: pos.timestamp != null ? pos.timestamp : Date.now(),
          source: "device",
        });
      },
      () =>
        resolve({
          lat: null,
          lng: null,
          accuracyM: null,
          timestamp: null,
          source: null,
        }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}
