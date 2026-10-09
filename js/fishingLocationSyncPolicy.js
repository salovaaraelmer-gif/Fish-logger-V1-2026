/**
 * Pure policy helpers for cloud-authoritative global fishing-location sync.
 * Keeps successful-empty cloud responses from being overwritten by IndexedDB.
 * @module fishingLocationSyncPolicy
 */

/**
 * Normalize a fishing-location display name for comparison / create.
 * Trim only — case folding is applied separately for equality checks.
 * @param {string} name
 * @returns {string}
 */
export function normalizeFishingLocationName(name) {
  return String(name ?? "").trim();
}

/**
 * Case-insensitive equality after trim (matches DB unique index semantics).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function fishingLocationNamesMatch(a, b) {
  return normalizeFishingLocationName(a).toLowerCase() === normalizeFishingLocationName(b).toLowerCase();
}

/**
 * Local fishing-location row ids that must be removed after a successful
 * global cloud catalog fetch. Rows whose `supabaseId` is still present in cloud
 * are kept. Local-only rows (no supabaseId) are removed — cloud is authoritative.
 *
 * @param {Array<{ id: string, supabaseId?: string | null }>} localRows
 * @param {Iterable<string>} cloudLocationIds
 * @returns {string[]}
 */
export function localFishingLocationIdsToRemove(localRows, cloudLocationIds) {
  const cloudIds = new Set([...cloudLocationIds].map(String));
  return (localRows || [])
    .filter((r) => r && typeof r.id === "string")
    .filter((r) => !r.supabaseId || !cloudIds.has(String(r.supabaseId)))
    .map((r) => r.id);
}

/**
 * Successful empty cloud session-location fetch is authoritative.
 * Never auto-push local session links / catalog rows just because cloud returned zero links.
 *
 * @returns {false}
 */
export function shouldUploadLocalSessionLinksForEmptyCloud() {
  return false;
}
