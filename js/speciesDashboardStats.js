/**
 * Pure stats for the session species dashboard (active and ended).
 * @module speciesDashboardStats
 */

import { isAllowedSpecies, SPECIES_LABELS, SPECIES_OPTIONS } from "./catchSpecies.js";

/**
 * @param {string} name
 * @returns {string | null}
 */
export function catalogNameToSpeciesKey(name) {
  const n = String(name ?? "").trim().toLowerCase();
  if (!n) return null;
  if (isAllowedSpecies(n)) return n;
  for (const [key, label] of Object.entries(SPECIES_LABELS)) {
    if (String(label).toLowerCase() === n) return key;
  }
  return null;
}

/**
 * Target species first (given order), then other species that have catches.
 * @param {string[]} targetSpeciesKeys
 * @param {{ species?: string }[]} catches
 * @returns {string[]}
 */
export function listDashboardSpecies(targetSpeciesKeys, catches) {
  /** @type {string[]} */
  const ordered = [];
  const seen = new Set();
  for (const raw of targetSpeciesKeys) {
    const key = isAllowedSpecies(raw) ? raw : catalogNameToSpeciesKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }
  const fromCatches = [];
  for (const row of catches) {
    const key = typeof row?.species === "string" ? row.species : "";
    if (!isAllowedSpecies(key) || seen.has(key)) continue;
    seen.add(key);
    fromCatches.push(key);
  }
  fromCatches.sort((a, b) => SPECIES_OPTIONS.indexOf(a) - SPECIES_OPTIONS.indexOf(b));
  return [...ordered, ...fromCatches];
}

/**
 * @param {string[]} targetSpeciesKeys
 * @param {string[]} speciesList
 * @returns {string | null}
 */
export function defaultSelectedSpecies(targetSpeciesKeys, speciesList) {
  for (const raw of targetSpeciesKeys) {
    const key = isAllowedSpecies(raw) ? raw : catalogNameToSpeciesKey(raw);
    if (key && speciesList.includes(key)) return key;
  }
  return speciesList[0] ?? null;
}

/**
 * @param {{ anglerId: string, species: string, length?: number | null }[]} catches
 * @param {string} anglerId
 * @param {string} species
 * @returns {{ catchCount: number, top5Lengths: number[], top5Total: number }}
 */
export function statsForAnglerSpecies(catches, anglerId, species) {
  const anglerCatches = catches.filter((c) => c.anglerId === anglerId && c.species === species);
  const top5Lengths = anglerCatches
    .map((c) => c.length)
    .filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
    .sort((a, b) => /** @type {number} */ (b) - /** @type {number} */ (a))
    .slice(0, 5)
    .map((n) => /** @type {number} */ (n));
  return {
    catchCount: anglerCatches.length,
    top5Lengths,
    top5Total: top5Lengths.reduce((sum, n) => sum + n, 0),
  };
}

/** First / second / third angler, then extra theme-safe colors. */
export const DASHBOARD_ANGLER_COLORS = Object.freeze([
  "#58a6ff",
  "#3fb950",
  "#d29922",
  "#bc8cff",
  "#f85149",
  "#79c0ff",
]);

/**
 * @param {number} index
 * @returns {string}
 */
export function colorForAnglerIndex(index) {
  const i = Math.max(0, index);
  return DASHBOARD_ANGLER_COLORS[i % DASHBOARD_ANGLER_COLORS.length];
}

/**
 * Leader of the current mode first; ties keep session roster order.
 * Color stays on roster index, not display position.
 *
 * @template {{ rosterIndex: number, stats: { catchCount: number, top5Total: number } }} T
 * @param {T[]} rows
 * @param {"catches" | "top5"} mode
 * @returns {T[]}
 */
export function rankAnglersForDashboard(rows, mode) {
  return [...rows].sort((a, b) => {
    const scoreA = mode === "top5" ? a.stats.top5Total : a.stats.catchCount;
    const scoreB = mode === "top5" ? b.stats.top5Total : b.stats.catchCount;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.rosterIndex - b.rosterIndex;
  });
}
