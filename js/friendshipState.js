/**
 * Pure friendship row helpers. Status changes are enforced in the database.
 * @module friendshipState
 */

/** @typedef {"none" | "outgoing" | "incoming" | "friends"} FriendshipRelation */

/**
 * @typedef {{
 *   id?: string,
 *   requester_id: string,
 *   addressee_id: string,
 *   status: string,
 * }} FriendshipRow
 */

/**
 * @param {FriendshipRow} row
 * @param {string} myId
 * @returns {string | null}
 */
export function otherUserId(row, myId) {
  if (!row || !myId) return null;
  if (row.requester_id === myId) return row.addressee_id || null;
  if (row.addressee_id === myId) return row.requester_id || null;
  return null;
}

/**
 * @param {FriendshipRow[] | null | undefined} rows
 * @param {string} myId
 * @param {string} otherId
 * @returns {FriendshipRow | null}
 */
export function rowForPair(rows, myId, otherId) {
  if (!myId || !otherId || !Array.isArray(rows)) return null;
  return (
    rows.find(
      (row) =>
        (row.requester_id === myId && row.addressee_id === otherId) ||
        (row.requester_id === otherId && row.addressee_id === myId)
    ) || null
  );
}

/**
 * @param {FriendshipRow | null | undefined} row
 * @param {string} myId
 * @returns {FriendshipRelation}
 */
export function relationFromRow(row, myId) {
  if (!row || !myId) return "none";
  if (row.status === "accepted") return "friends";
  if (row.status === "pending" && row.addressee_id === myId) return "incoming";
  if (row.status === "pending" && row.requester_id === myId) return "outgoing";
  return "none";
}

/**
 * @param {FriendshipRow[] | null | undefined} rows
 * @param {string} myId
 * @returns {string[]}
 */
export function acceptedFriendIds(rows, myId) {
  if (!myId || !Array.isArray(rows)) return [];
  const ids = [];
  for (const row of rows) {
    if (row.status !== "accepted") continue;
    const other = otherUserId(row, myId);
    if (other) ids.push(other);
  }
  return ids;
}

/**
 * @param {FriendshipRow[] | null | undefined} rows
 * @param {string} myId
 * @returns {FriendshipRow[]}
 */
export function incomingPendingRows(rows, myId) {
  if (!myId || !Array.isArray(rows)) return [];
  return rows.filter((row) => row.status === "pending" && row.addressee_id === myId);
}

/**
 * @param {FriendshipRow[] | null | undefined} rows
 * @param {string} myId
 * @returns {FriendshipRow[]}
 */
export function outgoingPendingRows(rows, myId) {
  if (!myId || !Array.isArray(rows)) return [];
  return rows.filter((row) => row.status === "pending" && row.requester_id === myId);
}

/**
 * @param {number} count
 * @returns {string}
 */
export function formatFriendsCountLabel(count) {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return n === 1 ? "1 Friend" : `${n} Friends`;
}
