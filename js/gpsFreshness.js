/**
 * Fresh-fix rules for catch GPS. Cached or pre-flow positions are rejected.
 * @module gpsFreshness
 */

/** Browser may not return a cached fix. */
export const GEO_WATCH_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 30_000,
});

/** Reject a fix whose timestamp is older than this relative to now. */
export const GPS_MAX_AGE_MS = 90_000;

/** Allow a small clock skew before `locationRequestStartedAt`. */
export const GPS_START_SKEW_MS = 2_000;

/**
 * @typedef {{
 *   lat: number | null,
 *   lng: number | null,
 *   accuracyM: number | null,
 *   timestamp: number | null,
 *   source?: string | null,
 * }} GpsFix
 */

/**
 * A usable fix must have coordinates, a real GPS timestamp, belong to this
 * acquisition, and not be an old cached reading.
 *
 * @param {GpsFix | null | undefined} loc
 * @param {number} requestStartedAt
 * @param {number} [now]
 * @returns {boolean}
 */
export function isFreshGpsFix(loc, requestStartedAt, now = Date.now()) {
  if (!loc) return false;
  if (typeof loc.lat !== "number" || typeof loc.lng !== "number") return false;
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return false;
  if (loc.timestamp == null || !Number.isFinite(loc.timestamp)) return false;
  if (!Number.isFinite(now) || !Number.isFinite(requestStartedAt)) return false;
  if (now - loc.timestamp > GPS_MAX_AGE_MS) return false;
  if (loc.timestamp < requestStartedAt - GPS_START_SKEW_MS) return false;
  return true;
}

/**
 * Prefer a more accurate fresh fix. Missing accuracy loses to a numeric one.
 *
 * @param {GpsFix | null | undefined} current
 * @param {GpsFix | null | undefined} candidate
 * @returns {boolean}
 */
export function isBetterGpsFix(current, candidate) {
  if (!candidate) return false;
  if (!current) return true;
  const next = candidate.accuracyM;
  const prev = current.accuracyM;
  const nextOk = typeof next === "number" && Number.isFinite(next);
  const prevOk = typeof prev === "number" && Number.isFinite(prev);
  if (nextOk && prevOk) return next < prev;
  if (nextOk) return true;
  return false;
}
