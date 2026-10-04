/**
 * Pure policy helpers for cloud-authoritative fishing-location sync.
 * Keeps successful-empty cloud responses from being overwritten by IndexedDB.
 * @module fishingLocationSyncPolicy
 */

/**
 * Local fishing-location row ids for `uid` that must be removed after a successful
 * cloud catalog fetch. Rows whose `supabaseId` is still present in cloud are kept.
 * Local-only rows (no supabaseId) are removed — cloud is authoritative.
 *
 * @param {Array<{ id: string, userId: string, supabaseId?: string | null }>} localRows
 * @param {Iterable<string>} cloudLocationIds
 * @param {string} uid
 * @returns {string[]}
 */
export function localFishingLocationIdsToRemove(localRows, cloudLocationIds, uid) {
  const cloudIds = new Set([...cloudLocationIds].map(String));
  return (localRows || [])
    .filter((r) => r && r.userId === uid && typeof r.id === "string")
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
