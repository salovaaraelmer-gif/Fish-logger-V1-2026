/**
 * Friends overlay: search, incoming requests, current friends.
 * @module friendshipUi
 */

import { backAppOr, navigateApp } from "./appRouter.js";
import { pathForFriends, pathForUserProfile } from "./appRoutes.js";
import { getAuthUserId } from "./auth.js";
import { formatFriendsCountLabel } from "./friendshipState.js";
import {
  acceptFriendRequest,
  cancelOutgoingRequest,
  countAcceptedFriends,
  declineFriendRequest,
  fetchMyFriendshipRows,
  loadFriendsOverview,
  relationFromRow,
  rowForPair,
  searchUsersForFriends,
  sendFriendRequest,
} from "./friendshipService.js";
import { buildUserResultRow } from "./userResultRow.js";

/** @param {string} msg */
let onError = (msg) => console.error(msg);

let searchTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
let wired = false;

export function openFriendsOverlay() {
  document.getElementById("friends-overlay")?.classList.remove("hidden");
  void refreshFriendsOverlay();
}

export function closeFriendsOverlay() {
  document.getElementById("friends-overlay")?.classList.add("hidden");
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById("friends-search-input"));
  if (input) input.value = "";
  const results = document.getElementById("friends-search-results");
  if (results) {
    results.innerHTML = "";
    results.classList.add("hidden");
  }
}

export async function refreshFriendsCount() {
  const btn = document.getElementById("profile-friends-open");
  const valueEl = document.getElementById("profile-friends-count-value");
  const n = await countAcceptedFriends();
  if (valueEl) valueEl.textContent = String(n);
  const word = document.getElementById("profile-friends-count-word");
  if (word) word.textContent = n === 1 ? "Friend" : "Friends";
  if (btn) btn.setAttribute("aria-label", formatFriendsCountLabel(n));
}

/**
 * @param {{ onError?: (msg: string) => void }} [options]
 */
export function wireFriendsUi(options = {}) {
  if (wired) return;
  wired = true;
  if (typeof options.onError === "function") onError = options.onError;

  document.getElementById("profile-friends-open")?.addEventListener("click", () => {
    navigateApp(pathForFriends());
  });
  document.getElementById("friends-back")?.addEventListener("click", () => {
    backAppOr("/profile");
  });

  const input = document.getElementById("friends-search-input");
  input?.addEventListener("input", () => {
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      void runFriendSearch();
    }, 220);
  });
}

async function runFriendSearch() {
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById("friends-search-input"));
  const box = document.getElementById("friends-search-results");
  if (!input || !box) return;
  const q = input.value.trim();
  if (q.length < 1) {
    box.innerHTML = "";
    box.classList.add("hidden");
    return;
  }
  const { profiles, error } = await searchUsersForFriends(q);
  if (error) {
    onError(error);
    return;
  }
  box.innerHTML = "";
  if (profiles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "No users found.";
    box.appendChild(empty);
    box.classList.remove("hidden");
    return;
  }
  const mine = await fetchMyFriendshipRows();
  const uid = await getAuthUserId();
  for (const profile of profiles) {
    const row = mine.ok && uid ? rowForPair(mine.rows, uid, profile.id) : null;
    const relation = relationFromRow(row, uid || "");
    box.appendChild(
      buildUserResultRow(profile, {
        onClick: () => navigateApp(pathForUserProfile(profile.id)),
        trailing: searchTrailing(profile, relation, row),
      })
    );
  }
  box.classList.remove("hidden");
}

/**
 * @param {import('./supabaseProfile.js').ProfileRow} profile
 * @param {import('./friendshipState.js').FriendshipRelation} relation
 * @param {import('./friendshipState.js').FriendshipRow | null} row
 */
function searchTrailing(profile, relation, row) {
  if (relation === "friends") return statusPill("Friends");
  if (relation === "outgoing") return statusPill("Pending");
  if (relation === "incoming" && row?.id) return requestActions(row.id);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "btn btn-primary friends-row-btn";
  add.textContent = "Add";
  add.addEventListener("click", async (event) => {
    event.stopPropagation();
    const r = await sendFriendRequest(profile.id);
    if (!r.ok) onError(r.error);
    await runFriendSearch();
    await refreshFriendsOverlay();
  });
  return add;
}

/** @param {string} text */
function statusPill(text) {
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = text;
  return pill;
}

/** @param {string} friendshipId */
function requestActions(friendshipId) {
  const actions = document.createElement("div");
  actions.className = "friends-row-actions";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "btn btn-primary friends-row-btn";
  accept.textContent = "Accept";
  accept.addEventListener("click", async (event) => {
    event.stopPropagation();
    const r = await acceptFriendRequest(friendshipId);
    if (!r.ok) onError(r.error);
    await runFriendSearch();
    await refreshFriendsOverlay();
  });
  const decline = document.createElement("button");
  decline.type = "button";
  decline.className = "btn friends-row-btn";
  decline.textContent = "Decline";
  decline.addEventListener("click", async (event) => {
    event.stopPropagation();
    const r = await declineFriendRequest(friendshipId);
    if (!r.ok) onError(r.error);
    await runFriendSearch();
    await refreshFriendsOverlay();
  });
  actions.append(accept, decline);
  return actions;
}

async function refreshFriendsOverlay() {
  const incomingEl = document.getElementById("friends-incoming-list");
  const outgoingEl = document.getElementById("friends-outgoing-list");
  const friendsEl = document.getElementById("friends-list");
  const incomingEmpty = document.getElementById("friends-incoming-empty");
  const outgoingEmpty = document.getElementById("friends-outgoing-empty");
  const friendsEmpty = document.getElementById("friends-empty");
  if (!incomingEl || !friendsEl || !outgoingEl) return;

  const res = await loadFriendsOverview();
  if (!res.ok) {
    onError(res.error);
    return;
  }

  incomingEl.innerHTML = "";
  outgoingEl.innerHTML = "";
  friendsEl.innerHTML = "";

  if (res.incoming.length === 0) {
    if (incomingEmpty) incomingEmpty.hidden = false;
  } else if (incomingEmpty) incomingEmpty.hidden = true;

  for (const item of res.incoming) {
    const profile = item.profile || {
      id: item.row.requester_id,
      username: null,
      display_name: null,
    };
    incomingEl.appendChild(
      buildUserResultRow(profile, {
        onClick: () => navigateApp(pathForUserProfile(profile.id)),
        trailing: item.row.id ? requestActions(item.row.id) : null,
      })
    );
  }

  if (res.outgoing.length === 0) {
    if (outgoingEmpty) outgoingEmpty.hidden = false;
  } else if (outgoingEmpty) outgoingEmpty.hidden = true;

  for (const item of res.outgoing) {
    const profile = item.profile || {
      id: item.row.addressee_id,
      username: null,
      display_name: null,
    };
    outgoingEl.appendChild(
      buildUserResultRow(profile, {
        onClick: () => navigateApp(pathForUserProfile(profile.id)),
        trailing: outgoingTrailing(item.row.id),
      })
    );
  }

  if (res.friends.length === 0) {
    if (friendsEmpty) friendsEmpty.hidden = false;
  } else if (friendsEmpty) friendsEmpty.hidden = true;

  for (const profile of res.friends) {
    friendsEl.appendChild(
      buildUserResultRow(profile, {
        onClick: () => navigateApp(pathForUserProfile(profile.id)),
      })
    );
  }

  await refreshFriendsCount();
}

/** @param {string | undefined} friendshipId */
function outgoingTrailing(friendshipId) {
  const actions = document.createElement("div");
  actions.className = "friends-row-actions";
  actions.appendChild(statusPill("Pending"));
  if (!friendshipId) return actions;
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn friends-row-btn";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", async (event) => {
    event.stopPropagation();
    const r = await cancelOutgoingRequest(friendshipId);
    if (!r.ok) onError(r.error);
    await runFriendSearch();
    await refreshFriendsOverlay();
  });
  actions.appendChild(cancel);
  return actions;
}
