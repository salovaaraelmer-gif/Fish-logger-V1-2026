/**
 * Mutual friends: search, requests, accept/decline, list.
 * @module friendshipService
 */

import { getAuthUserId } from "./auth.js";
import {
  acceptedFriendIds,
  incomingPendingRows,
  otherUserId,
  outgoingPendingRows,
  relationFromRow,
  rowForPair,
} from "./friendshipState.js";
import { supabase } from "./supabase.js";
import { fetchProfilesByIds, searchProfiles } from "./supabaseProfile.js";
import { uniqueProfilesById } from "./uniqueProfilesById.js";

const FRIENDSHIP_SELECT = "id, requester_id, addressee_id, status, created_at, responded_at";

/**
 * @returns {Promise<{ ok: true, rows: import('./friendshipState.js').FriendshipRow[] } | { ok: false, error: string }>}
 */
export async function fetchMyFriendshipRows() {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const { data, error } = await supabase.from("friendships").select(FRIENDSHIP_SELECT);
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: Array.isArray(data) ? data : [] };
}

/**
 * @param {string} otherId
 */
export async function fetchRelationWith(otherId) {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  if (!otherId || otherId === uid) {
    return { ok: true, relation: /** @type {const} */ ("none"), row: null, myId: uid };
  }
  const res = await fetchMyFriendshipRows();
  if (!res.ok) return res;
  const row = rowForPair(res.rows, uid, otherId);
  return { ok: true, relation: relationFromRow(row, uid), row, myId: uid };
}

/**
 * @returns {Promise<{
 *   ok: true,
 *   myId: string,
 *   friends: import('./supabaseProfile.js').ProfileRow[],
 *   incoming: { row: import('./friendshipState.js').FriendshipRow, profile: import('./supabaseProfile.js').ProfileRow | null }[],
 *   outgoing: { row: import('./friendshipState.js').FriendshipRow, profile: import('./supabaseProfile.js').ProfileRow | null }[],
 * } | { ok: false, error: string }>}
 */
export async function loadFriendsOverview() {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const res = await fetchMyFriendshipRows();
  if (!res.ok) return res;
  const friendIds = acceptedFriendIds(res.rows, uid);
  const incomingRows = incomingPendingRows(res.rows, uid);
  const outgoingRows = outgoingPendingRows(res.rows, uid);
  const profileIds = [
    ...friendIds,
    ...incomingRows.map((row) => row.requester_id),
    ...outgoingRows.map((row) => row.addressee_id),
  ];
  const profiles = await fetchProfilesByIds(profileIds);
  return {
    ok: true,
    myId: uid,
    friends: friendIds.map((id) => profiles.get(id) || { id, username: null, display_name: null }).filter(Boolean),
    incoming: incomingRows.map((row) => ({
      row,
      profile: profiles.get(row.requester_id) || null,
    })),
    outgoing: outgoingRows.map((row) => ({
      row,
      profile: profiles.get(row.addressee_id) || null,
    })),
  };
}

/**
 * @returns {Promise<number>}
 */
export async function countAcceptedFriends() {
  const res = await fetchMyFriendshipRows();
  if (!res.ok) return 0;
  const uid = await getAuthUserId();
  if (!uid) return 0;
  return acceptedFriendIds(res.rows, uid).length;
}

/**
 * @param {string} addresseeId
 */
export async function sendFriendRequest(addresseeId) {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  if (!addresseeId || addresseeId === uid) return { ok: false, error: "Choose another user." };

  const rel = await fetchRelationWith(addresseeId);
  if (!rel.ok) return rel;
  if (rel.relation === "friends") return { ok: true };
  if (rel.relation === "outgoing") return { ok: true };
  if (rel.relation === "incoming") return { ok: false, error: "This person already sent you a request." };

  if (rel.row && rel.row.status === "declined") {
    const { error } = await supabase
      .from("friendships")
      .update({ requester_id: uid, addressee_id: addresseeId, status: "pending" })
      .eq("id", rel.row.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const { error } = await supabase.from("friendships").insert({
    requester_id: uid,
    addressee_id: addresseeId,
    status: "pending",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * @param {string} friendshipId
 */
export async function acceptFriendRequest(friendshipId) {
  if (!friendshipId) return { ok: false, error: "Missing request." };
  const { error } = await supabase.from("friendships").update({ status: "accepted" }).eq("id", friendshipId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * @param {string} friendshipId
 */
export async function declineFriendRequest(friendshipId) {
  if (!friendshipId) return { ok: false, error: "Missing request." };
  const { error } = await supabase.from("friendships").update({ status: "declined" }).eq("id", friendshipId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Requester can withdraw a pending request (same pending → declined transition). */
export async function cancelOutgoingRequest(friendshipId) {
  return declineFriendRequest(friendshipId);
}

/**
 * Search people by username or display name, excluding the signed-in user.
 * @param {string} rawQuery
 */
export async function searchUsersForFriends(rawQuery) {
  const uid = await getAuthUserId();
  const { profiles, error } = await searchProfiles(rawQuery, 20);
  if (error) return { profiles: [], error };
  const mine = uid ? profiles.filter((p) => p.id !== uid) : profiles;
  return { profiles: uniqueProfilesById(mine), error: null };
}

export { otherUserId, relationFromRow, rowForPair };
