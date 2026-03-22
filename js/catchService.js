/**
 * Catch validation and persistence.
 * @module catchService
 */

import { putCatch, getActiveSession } from "./db.js";
import { anglerBelongsToActiveSession } from "./sessionService.js";
import { newId } from "./sessionService.js";

/** @type {readonly string[]} */
export const SPECIES_OPTIONS = ["pike", "perch", "zander", "trout", "other"];

/**
 * Length/weight: null or positive integer, never 0.
 * @param {string | number | null | undefined} raw
 * @returns {number | null}
 */
export function parseOptionalPositiveInt(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "string" ? parseInt(raw, 10) : Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/**
 * @param {{ anglerId: string, species: string, length: number | null, weight: number | null, notes: string }} input
 * @param {{ lat: number | null, lon: number | null }} gps
 * @param {{ depth: number | null, waterTemp: number | null }} telemetry
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function saveCatch(input, gps, telemetry) {
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
  const weight = input.weight;
  if (length !== null && (typeof length !== "number" || length < 1)) {
    return { ok: false, reason: "Pituus: tyhjä tai positiivinen kokonaisluku (ei 0)." };
  }
  if (weight !== null && (typeof weight !== "number" || weight < 1)) {
    return { ok: false, reason: "Paino: tyhjä tai positiivinen kokonaisluku (ei 0)." };
  }

  const timestamp = Date.now();

  await putCatch({
    id: newId(),
    sessionId: session.id,
    anglerId: input.anglerId,
    timestamp,
    species,
    length,
    weight,
    notes: (input.notes || "").trim(),
    gps: { lat: gps.lat, lon: gps.lon },
    telemetry: { depth: telemetry.depth, waterTemp: telemetry.waterTemp },
  });

  return { ok: true };
}

/**
 * @returns {Promise<{ lat: number | null, lon: number | null }>}
 */
export function fetchGpsBestEffort() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ lat: null, lon: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        });
      },
      () => resolve({ lat: null, lon: null }),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}
