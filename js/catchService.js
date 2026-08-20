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
import { hideAppSpinner, showAppSpinner } from "./appSpinner.js";

/** @type {readonly string[]} */
export const SPECIES_OPTIONS = ["pike", "perch", "zander", "trout", "salmon", "other"];

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
    return { ok: false, reason: "Length: use digits only (whole number cm)." };
  }
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) {
    return { ok: false, reason: "Length: enter a positive number (cm)." };
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
    return { ok: false, reason: "Depth: use numbers only (m) or leave empty." };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, reason: "Depth: enter a number ≥ 0 (m) or leave empty." };
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
    return { ok: false, reason: "Water temperature: use numbers only (°C) or leave empty." };
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    return { ok: false, reason: "Water temperature: enter a valid number (°C) or leave empty." };
  }
  if (n < -2 || n > 30) {
    return { ok: false, reason: "Water temperature: allowed range is -2 … 30 °C or leave empty." };
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
    return { ok: false, reason: "Weight: use numbers only (kg) or leave empty." };
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, reason: "Weight: enter a positive number (kg) or leave empty." };
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
  let session;
  try {
    session = await getActiveSessionForParticipantUi();
    console.log("[catch] active session query", session ? { id: session.id, endTime: session.endTime } : null);
  } catch (err) {
    console.error("[catch] active session query failed:", err);
    return { ok: false, reason: "Failed to load session data." };
  }
  if (!session) {
    return { ok: false, reason: "No active session — catch logging is not available." };
  }
  const species = (input.species || "").trim();
  if (!species) {
    return { ok: false, reason: "Species is required." };
  }
  if (!SPECIES_OPTIONS.includes(species)) {
    return { ok: false, reason: "Invalid species." };
  }
  if (!input.anglerId) {
    return { ok: false, reason: "Angler is required." };
  }
  const belongs = await anglerBelongsToActiveSession(session.id, input.anglerId);
  if (!belongs) {
    return { ok: false, reason: "This angler is not in the active session." };
  }

  const length = input.length;
  const weightKg = input.weight_kg;
  if (length !== null && (typeof length !== "number" || length < 1)) {
    return { ok: false, reason: "Length: empty or a positive whole number (not 0)." };
  }
  if (weightKg !== null && (typeof weightKg !== "number" || weightKg <= 0)) {
    return { ok: false, reason: "Weight: empty or a positive number (kg)." };
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
  console.log("[catch] insert payload (local)", {
    sessionId: record.sessionId,
    anglerId: record.anglerId,
    species: record.species,
    location: {
      lat: record.location_lat,
      lng: record.location_lng,
      accuracyM: record.location_accuracy_m,
      source: record.location_source,
    },
  });

  let weather = null;
  if (
    record.location_lat != null &&
    record.location_lng != null &&
    typeof record.location_lat === "number" &&
    typeof record.location_lng === "number"
  ) {
    try {
      weather = await fetchOpenMeteoCurrent(record.location_lat, record.location_lng);
    } catch (err) {
      console.warn("[catch] weather fetch failed (non-blocking):", err);
      weather = null;
    }
  }
  if (weather) {
    record.weather_summary = weather.weather_summary;
    record.air_temp_c = weather.air_temp_c;
    record.wind_speed_ms = weather.wind_speed_ms;
    record.wind_direction_deg = weather.wind_direction_deg;
  }

  try {
    await putCatch(record);
    console.log("[catch] insert ok (local)", { id: record.id });
    return { ok: true, record };
  } catch (err) {
    console.error("[catch] insert failed (local):", err);
    return { ok: false, reason: "Local save failed." };
  }
}

/**
 * Updates an existing catch (active or ended session). Ended: editor must be on the session roster.
 */
export async function updateCatch(input, deviceLoc, existing) {
  if (!existing.sessionId) {
    return { ok: false, reason: "This catch cannot be edited." };
  }
  const session = await getSessionById(existing.sessionId);
  if (!session) {
    return { ok: false, reason: "Session not found." };
  }

  const authId = await getAuthUserId();
  if (!authId) {
    return { ok: false, reason: "Not signed in." };
  }

  if (session.endTime != null) {
    const editorOk = await anglerBelongsToSessionRoster(session.id, authId);
    if (!editorOk) {
      return { ok: false, reason: "You can only edit sessions you are part of." };
    }
  } else {
    const active = await getActiveSessionForParticipantUi();
    if (!active) {
      return { ok: false, reason: "No active session — catch logging is not available." };
    }
    if (active.id !== session.id) {
      return { ok: false, reason: "This catch cannot be edited in this session." };
    }
  }

  const species = (input.species || "").trim();
  if (!species) {
    return { ok: false, reason: "Species is required." };
  }
  if (!SPECIES_OPTIONS.includes(species)) {
    return { ok: false, reason: "Invalid species." };
  }
  if (!input.anglerId) {
    return { ok: false, reason: "Angler is required." };
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
          ? "This angler is not in this session."
          : "This angler is not in the active session.",
    };
  }

  const length = input.length;
  const weightKg = input.weight_kg;
  if (length !== null && (typeof length !== "number" || length < 1)) {
    return { ok: false, reason: "Length: empty or a positive whole number (not 0)." };
  }
  if (weightKg !== null && (typeof weightKg !== "number" || weightKg <= 0)) {
    return { ok: false, reason: "Weight: empty or a positive number (kg)." };
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

/** How long a fix from the fish-logging watch remains usable as a seed on save. */
const FISH_LOGGING_BEST_MAX_AGE_MS = 90_000;

/** Max time to hunt for a fix (fish overlay + save / session start). */
const CONVERGENCE_MAX_MS = 30_000;

/** Target accuracy (m); ~10 m is often optimistic on boats — we stop early when reached. */
const CONVERGENCE_GOOD_ENOUGH_M = 10;

/** @type {number | null} */
let fishLoggingWatchId = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let fishLoggingWatchTimeoutId = null;
/** @type {DeviceLocation | null} */
let fishLoggingBest = null;

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
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const acc = pos.coords.accuracy;
  const accuracyM = typeof acc === "number" && Number.isFinite(acc) ? acc : null;
  return {
    lat,
    lng,
    accuracyM,
    timestamp: pos.timestamp != null ? pos.timestamp : Date.now(),
    source: "device",
  };
}

/**
 * While the add-fish overlay is open, track the best GNSS fix (high accuracy, up to CONVERGENCE_MAX_MS).
 * Idempotent: safe to call when opening the fish flow.
 */
export function startFishLoggingLocationWatch() {
  if (fishLoggingWatchId != null) return;
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    console.log("[GPS] geolocation unavailable — fish watch skipped");
    return;
  }
  fishLoggingBest = null;
  console.log("[GPS] starting fish-logging location watch");
  fishLoggingWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const loc = positionToDeviceLocation(pos);
      if (!loc) return;
      console.log("[GPS] watch fix", {
        lat: loc.lat,
        lng: loc.lng,
        accuracyM: loc.accuracyM,
      });
      if (
        !fishLoggingBest ||
        (loc.accuracyM != null &&
          (fishLoggingBest.accuracyM == null || loc.accuracyM < fishLoggingBest.accuracyM))
      ) {
        fishLoggingBest = loc;
      }
      if (loc.accuracyM != null && loc.accuracyM <= CONVERGENCE_GOOD_ENOUGH_M) {
        stopFishLoggingLocationWatch();
      }
    },
    (err) => {
      console.warn("[GPS] fish watch error:", err?.code, err?.message || err);
    },
    { enableHighAccuracy: true, maximumAge: 0 }
  );
  if (fishLoggingWatchTimeoutId != null) {
    clearTimeout(fishLoggingWatchTimeoutId);
  }
  fishLoggingWatchTimeoutId = setTimeout(() => {
    fishLoggingWatchTimeoutId = null;
    stopFishLoggingLocationWatch();
  }, CONVERGENCE_MAX_MS);
}

/**
 * Stops the fish-logging watch (overlay closed, save, logout). Keeps the best fix for a short save window.
 */
export function stopFishLoggingLocationWatch() {
  if (fishLoggingWatchTimeoutId != null) {
    clearTimeout(fishLoggingWatchTimeoutId);
    fishLoggingWatchTimeoutId = null;
  }
  if (fishLoggingWatchId != null) {
    try {
      navigator.geolocation.clearWatch(fishLoggingWatchId);
    } catch {
      /* ignore */
    }
    fishLoggingWatchId = null;
  }
}

/**
 * Clears any cached fix from the fish-logging watch (e.g. logout).
 */
export function clearFishLoggingLocationCache() {
  stopFishLoggingLocationWatch();
  fishLoggingBest = null;
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
      Date.now() - best.timestamp > FISH_LOGGING_BEST_MAX_AGE_MS
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
        console.log("[GPS] convergence fix", {
          lat: loc.lat,
          lng: loc.lng,
          accuracyM: loc.accuracyM,
        });
        if (
          !best ||
          (loc.accuracyM != null &&
            (best.accuracyM == null || loc.accuracyM < best.accuracyM))
        ) {
          best = loc;
        }
        if (loc.accuracyM != null && loc.accuracyM <= CONVERGENCE_GOOD_ENOUGH_M) {
          done();
        }
      },
      (err) => {
        const code = err && /** @type {GeolocationPositionError} */ (err).code;
        console.warn("[GPS] convergence watch error:", code, err?.message || err);
        if (code === 1) {
          done();
        }
      },
      { enableHighAccuracy: true, maximumAge: 0 }
    );

    setTimeout(done, CONVERGENCE_MAX_MS);
  });
}

/**
 * Best-effort device location: watches fixes for up to CONVERGENCE_MAX_MS and keeps the most
 * accurate point (unlike a single `getCurrentPosition`, which often returns a coarse fix).
 * Seeds from the fish-logging overlay watch when available.
 *
 * @returns {Promise<DeviceLocation>}
 */
export async function fetchDeviceLocationBestEffort() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    console.log("[GPS] geolocation unavailable — saving without location");
    return emptyDeviceLocation();
  }

  if (navigator.permissions?.query) {
    try {
      const perm = await navigator.permissions.query({ name: "geolocation" });
      console.log("[GPS] permission status:", perm.state);
    } catch (err) {
      console.warn("[GPS] permission query failed:", err);
    }
  }

  const seed =
    fishLoggingBest &&
    fishLoggingBest.timestamp != null &&
    Date.now() - fishLoggingBest.timestamp <= FISH_LOGGING_BEST_MAX_AGE_MS
      ? { ...fishLoggingBest }
      : null;

  stopFishLoggingLocationWatch();

  if (
    seed &&
    seed.accuracyM != null &&
    seed.accuracyM <= CONVERGENCE_GOOD_ENOUGH_M
  ) {
    console.log("[GPS] using cached seed fix", seed);
    return seed;
  }

  showAppSpinner();
  try {
    const result = await runConvergenceWatch(seed);
    console.log("[GPS] fetch result", result);
    return result;
  } catch (err) {
    console.error("[GPS] fetch failed (non-blocking):", err);
    return emptyDeviceLocation();
  } finally {
    hideAppSpinner();
  }
}
