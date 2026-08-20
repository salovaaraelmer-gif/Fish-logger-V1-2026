/**
 * Canonical catch species list — UI, local records, sync, and Supabase CHECK
 * must stay identical.
 * @module catchSpecies
 */

/** @type {readonly string[]} */
export const SPECIES_OPTIONS = Object.freeze([
  "pike",
  "perch",
  "zander",
  "trout",
  "salmon",
  "other",
]);

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isAllowedSpecies(value) {
  return typeof value === "string" && SPECIES_OPTIONS.includes(value);
}

/**
 * Maps a cloud/local species string without rewriting allowed values.
 * `salmon` must stay `salmon` (never coerced to `other`).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function mapSpeciesFromDb(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}
