/**
 * Personal map marker filters. In-memory only; does not change stored catches.
 * @module mapCatchFilters
 */

import { isAllowedSpecies } from "./catchSpecies.js";

/** @typedef {"all" | "year" | "custom"} MapDateMode */

/**
 * @typedef {{
 *   species: string[],
 *   dateMode: MapDateMode,
 *   year: number | "all",
 *   fromMs: number | null,
 *   toMs: number | null,
 *   minLengthCm: number,
 *   maxLengthCm: number,
 * }} MapCatchFilters
 */

export const MAP_FILTER_ALL_SPECIES = "all";

export const MAP_LENGTH_MIN_CM = 0;
export const MAP_LENGTH_MAX_CM = 130;
export const MAP_LENGTH_STEP_CM = 10;

/**
 * Snap a length to the 10 cm filter grid (0, 10, …, 130).
 * @param {unknown} value
 * @returns {number}
 */
export function snapLengthCm(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return MAP_LENGTH_MIN_CM;
  const snapped = Math.round(n / MAP_LENGTH_STEP_CM) * MAP_LENGTH_STEP_CM;
  return Math.min(MAP_LENGTH_MAX_CM, Math.max(MAP_LENGTH_MIN_CM, snapped));
}

/**
 * @returns {MapCatchFilters}
 */
export function defaultMapCatchFilters() {
  return {
    species: [],
    dateMode: "all",
    year: "all",
    fromMs: null,
    toMs: null,
    minLengthCm: MAP_LENGTH_MIN_CM,
    maxLengthCm: MAP_LENGTH_MAX_CM,
  };
}

/**
 * Empty selection means no species restriction (same as All species).
 * A leftover string value is treated as a one-species selection.
 * @param {unknown} keys
 * @returns {string[]}
 */
export function normalizeSelectedSpecies(keys) {
  if (typeof keys === "string") {
    if (!keys || keys === MAP_FILTER_ALL_SPECIES) return [];
    return isAllowedSpecies(keys) ? [keys] : [];
  }
  if (!Array.isArray(keys)) return [];
  const out = [];
  for (const key of keys) {
    if (isAllowedSpecies(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

/** @param {unknown} keys */
export function isAllSpeciesFilter(keys) {
  return normalizeSelectedSpecies(keys).length === 0;
}

/**
 * Toggle one species chip. All species clears the explicit list.
 * Deselecting the last chip returns to All species (never "match nothing").
 * @param {unknown} current
 * @param {string} tappedKey
 * @returns {string[]}
 */
export function toggleMapSpecies(current, tappedKey) {
  if (tappedKey === MAP_FILTER_ALL_SPECIES) return [];
  if (!isAllowedSpecies(tappedKey)) return normalizeSelectedSpecies(current);
  const selected = normalizeSelectedSpecies(current);
  if (selected.includes(tappedKey)) return selected.filter((key) => key !== tappedKey);
  return [...selected, tappedKey];
}

/**
 * @param {unknown} minCm
 * @param {unknown} maxCm
 * @returns {{ minLengthCm: number, maxLengthCm: number }}
 */
export function normalizeLengthRange(minCm, maxCm) {
  let min = snapLengthCm(minCm);
  let max = snapLengthCm(maxCm);
  if (min > max) {
    const swap = min;
    min = max;
    max = swap;
  }
  return { minLengthCm: min, maxLengthCm: max };
}

/** @param {unknown} minCm @param {unknown} maxCm */
export function isUnrestrictedLengthRange(minCm, maxCm) {
  const range = normalizeLengthRange(minCm, maxCm);
  return range.minLengthCm <= MAP_LENGTH_MIN_CM && range.maxLengthCm >= MAP_LENGTH_MAX_CM;
}

/** @param {unknown} minCm @param {unknown} maxCm */
export function formatLengthRangeLabel(minCm, maxCm) {
  const range = normalizeLengthRange(minCm, maxCm);
  return `${range.minLengthCm}–${range.maxLengthCm} cm`;
}

/**
 * Unrestricted range keeps catches with missing length. A narrowed range excludes them.
 * @param {unknown} length
 * @param {unknown} minCm
 * @param {unknown} maxCm
 */
export function catchMatchesLengthRange(length, minCm, maxCm) {
  if (isUnrestrictedLengthRange(minCm, maxCm)) return true;
  if (length == null || !Number.isFinite(Number(length))) return false;
  const cm = Number(length);
  const range = normalizeLengthRange(minCm, maxCm);
  return cm >= range.minLengthCm && cm <= range.maxLengthCm;
}

/**
 * @param {unknown} catchRow
 * @returns {boolean}
 */
export function catchHasValidGps(catchRow) {
  if (!catchRow || typeof catchRow !== "object") return false;
  const row = /** @type {{ location_lat?: unknown, location_lng?: unknown }} */ (catchRow);
  return (
    typeof row.location_lat === "number" &&
    typeof row.location_lng === "number" &&
    Number.isFinite(row.location_lat) &&
    Number.isFinite(row.location_lng)
  );
}

/**
 * End of local calendar day (inclusive filter bound).
 * @param {number} ms
 * @returns {number}
 */
export function endOfLocalDayMs(ms) {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Start of local calendar day.
 * @param {number} ms
 * @returns {number}
 */
export function startOfLocalDayMs(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * @param {{ location_lat?: unknown, location_lng?: unknown, species?: string, length?: number | null, timestamp?: number }[]} catches
 * @param {MapCatchFilters} filters
 */
export function applyMapCatchFilters(catches, filters) {
  const list = Array.isArray(catches) ? catches : [];
  const speciesKeys = normalizeSelectedSpecies(filters?.species);
  const dateMode = filters?.dateMode || "all";
  const minCm = filters?.minLengthCm;
  const maxCm = filters?.maxLengthCm;
  return list.filter((c) => {
    if (!catchHasValidGps(c)) return false;
    if (speciesKeys.length > 0 && !speciesKeys.includes(c.species || "")) return false;
    if (!catchMatchesLengthRange(c.length, minCm, maxCm)) return false;
    const t = typeof c.timestamp === "number" ? c.timestamp : NaN;
    if (dateMode === "year") {
      const year = filters.year;
      if (year !== "all" && Number.isFinite(year) && new Date(t).getFullYear() !== year) return false;
    }
    if (dateMode === "custom") {
      if (filters.fromMs != null && Number.isFinite(filters.fromMs) && t < filters.fromMs) return false;
      if (filters.toMs != null && Number.isFinite(filters.toMs) && t > filters.toMs) return false;
    }
    return true;
  });
}
