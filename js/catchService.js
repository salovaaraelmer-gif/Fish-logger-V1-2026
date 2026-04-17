/**
 * Catch validation and persistence.
 * @module catchService
 */

import { getSessionById, putCatch } from "./db.js";
import { getAuthUserId } from "./auth.js";
import { getActiveSessionForParticipantUi } from "./participantSessionCache.js";
import {
  anglerBelongsToActiveSession,
  anglerBelongsToSessionRoster,
} from "./sessionService.js";
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
  const session = await getActiveSessionForParticipantUi();
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
    supabase_id: null,
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
 * Updates an existing catch (active or ended session). Ended: editor must be on the session roster.
 */
export async function updateCatch(input, deviceLoc, existing) {
  if (!existing.sessionId) {
    return { ok: false, reason: "Saalista ei voi muokata." };
  }
  const session = await getSessionById(existing.sessionId);
  if (!session) {
    return { ok: false, reason: "Sessiota ei löytynyt." };
  }

  const authId = await getAuthUserId();
  if (!authId) {
    return { ok: false, reason: "Kirjautuminen puuttuu." };
  }

  if (session.endTime != null) {
    const editorOk = await anglerBelongsToSessionRoster(session.id, authId);
    if (!editorOk) {
      return { ok: false, reason: "Voit muokata vain sessioita, joissa olet mukana." };
    }
  } else {
    const active = await getActiveSessionForParticipantUi();
    if (!active) {
      return { ok: false, reason: "Ei aktiivista sessiota — saalisvahti ei käytössä." };
    }
    if (active.id !== session.id) {
      return { ok: false, reason: "Saalista ei voi muokata tässä sessiossa." };
    }
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
  const anglerOk =
    session.endTime != null
      ? await anglerBelongsToSessionRoster(session.id, input.anglerId)
      : await anglerBelongsToActiveSession(session.id, input.anglerId);
  if (!anglerOk) {
    return {
      ok: false,
      reason:
        session.endTime != null
          ? "Kalastaja ei kuulu tähän sessioon."
          : "Kalastaja ei kuulu tähän aktiiviseen sessioon.",
    };
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

/** Keep the best (smallest radius) fix while the session is active — tab open, foreground. */
const SESSION_WARM_MAX_AGE_MS = 90_000;

/** Convergence window when resolving a point for save / session start. */
const CONVERGENCE_MAX_MS = 14_000;

/** If we see this horizontal accuracy (m) or better, stop waiting. */
const CONVERGENCE_GOOD_ENOUGH_M = 12;

/** @type {number | null} */
let sessionWatchId = null;
/** @type {DeviceLocation | null} */
let sessionWarmBest = null;

/**
 * @returns {DeviceLocation}
 */
function emptyDeviceLocation() {
  return { lat: null, lng: null, accuracyM: null, timestamp: null, source: null };
}

/**
 * @param {GeolocationPosition} pos
 * @returns {DeviceLocation | null}
 */
function positionToDeviceLocation(pos) {
  const acc = pos.coords.accuracy;
  if (typeof acc !== "number" || !Number.isFinite(acc)) return null;
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return {
    lat,
    lng,
    accuracyM: acc,
    timestamp: pos.timestamp != null ? pos.timestamp : Date.now(),
    source: "device",
  };
}

/**
 * While an active fishing session is shown, keep GNSS warm and track the best recent fix.
 * Idempotent: safe to call on every home render.
 */
export function startSessionLocationWatch() {
  if (sessionWatchId != null) return;
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  sessionWarmBest = null;
  sessionWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const loc = positionToDeviceLocation(pos);
      if (!loc) return;
      if (!sessionWarmBest || loc.accuracyM < sessionWarmBest.accuracyM) {
        sessionWarmBest = loc;
      }
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 0 }
  );
}

/**
 * Stops the session background watch (logout, no active session, etc.).
 */
export function stopSessionLocationWatch() {
  if (sessionWatchId != null) {
    try {
      navigator.geolocation.clearWatch(sessionWatchId);
    } catch {
      /* ignore */
    }
    sessionWatchId = null;
  }
  sessionWarmBest = null;
}

/**
 * @param {DeviceLocation | null} seedBest
 * @returns {Promise<DeviceLocation>}
 */
function runConvergenceWatch(seedBest) {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(seedBest || emptyDeviceLocation());
      return;
    }

    let best = seedBest;
    if (
      best &&
      best.timestamp != null &&
      Date.now() - best.timestamp > SESSION_WARM_MAX_AGE_MS
    ) {
      best = null;
    }

    let finished = false;
    /** @type {number | null} */
    let watchId = null;

    const done = () => {
      if (finished) return;
      finished = true;
      if (watchId != null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          /* ignore */
        }
        watchId = null;
      }
      if (best) {
        resolve({
          lat: best.lat,
          lng: best.lng,
          accuracyM: best.accuracyM,
          timestamp: best.timestamp,
          source: best.source ?? "device",
        });
      } else {
        resolve(emptyDeviceLocation());
      }
    };

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = positionToDeviceLocation(pos);
        if (!loc) return;
        if (!best || loc.accuracyM < best.accuracyM) {
          best = loc;
        }
        if (loc.accuracyM <= CONVERGENCE_GOOD_ENOUGH_M) {
          done();
        }
      },
      (err) => {
        if (err && /** @type {GeolocationPositionError} */ (err).code === 1) {
          done();
        }
      },
      { enableHighAccuracy: true, maximumAge: 0 }
    );

    setTimeout(done, CONVERGENCE_MAX_MS);
  });
}

/**
 * Best-effort device location: watches fixes for a short window and keeps the most accurate
 * point (unlike a single `getCurrentPosition`, which often returns the first coarse network fix).
 * Seeds from session warm data when available. Restarts session watch after resolving.
 *
 * @returns {Promise<DeviceLocation>}
 */
export async function fetchDeviceLocationBestEffort() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return emptyDeviceLocation();
  }

  const hadSessionWatch = sessionWatchId != null;
  const warmSeed =
    sessionWarmBest &&
    sessionWarmBest.timestamp != null &&
    Date.now() - sessionWarmBest.timestamp <= SESSION_WARM_MAX_AGE_MS
      ? { ...sessionWarmBest }
      : null;

  if (hadSessionWatch) {
    stopSessionLocationWatch();
  }

  const loc = await runConvergenceWatch(warmSeed);

  if (hadSessionWatch) {
    const active = await getActiveSessionForParticipantUi();
    if (active && active.endTime == null) {
      startSessionLocationWatch();
    }
  }

  return loc;
}
