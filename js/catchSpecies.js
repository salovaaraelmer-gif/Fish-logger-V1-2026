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

/** @type {Readonly<Record<string, string>>} */
export const SPECIES_LABELS = Object.freeze({
  pike: "Pike",
  perch: "Perch",
  zander: "Zander",
  trout: "Trout",
  salmon: "Salmon",
  other: "Other",
});

/** Global species colors — use `colorForSpecies`; do not copy these hex values elsewhere. */
export const SPECIES_COLORS = Object.freeze({
  pike: "#1B5E20",
  perch: "#F57F17",
  zander: "#0D47A1",
  trout: "#616161",
  salmon: "#D81B60",
  other: "#4A148C",
});

export const ALL_SPECIES_ICON_SRC = "/assets/species/all.png";

const SPECIES_ICON_FILES = Object.freeze({
  pike: "/assets/species/pike.png",
  perch: "/assets/species/perch.png",
  zander: "/assets/species/zander.png",
  trout: "/assets/species/trout.png",
  salmon: "/assets/species/salmon.png",
  other: "/assets/species/other.png",
});

const SPECIES_COLOR_FALLBACK = "#546e7a";

/**
 * @param {string | null | undefined} species
 * @returns {string}
 */
export function colorForSpecies(species) {
  if (species && Object.prototype.hasOwnProperty.call(SPECIES_COLORS, species)) {
    return SPECIES_COLORS[/** @type {keyof typeof SPECIES_COLORS} */ (species)];
  }
  return SPECIES_COLOR_FALLBACK;
}

/**
 * @param {string | null | undefined} species
 * @returns {string | null}
 */
export function speciesIconSrc(species) {
  if (species && Object.prototype.hasOwnProperty.call(SPECIES_ICON_FILES, species)) {
    return SPECIES_ICON_FILES[/** @type {keyof typeof SPECIES_ICON_FILES} */ (species)];
  }
  return null;
}

/**
 * Canonical species that actually appear in the given catches, app order.
 * @param {{ species?: string }[]} catches
 * @returns {string[]}
 */
export function speciesWithCatches(catches) {
  const seen = new Set();
  for (const row of catches) {
    if (isAllowedSpecies(row?.species)) seen.add(row.species);
  }
  return SPECIES_OPTIONS.filter((key) => seen.has(key));
}

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
