/**
 * Read-only profile for another user (friends see stats and sessions).
 * @module friendProfileUi
 */

import { backAppOr, navigateApp } from "./appRouter.js";
import { pathForSessionDetail, pathForUserStats } from "./appRoutes.js";
import { bustAvatarUrl, fetchProfileForUser, profileDisplayLabel } from "./supabaseProfile.js";
import { getAuthUserId } from "./auth.js";
import {
  acceptFriendRequest,
  declineFriendRequest,
  fetchRelationWith,
  sendFriendRequest,
} from "./friendshipService.js";
import {
  fetchOwnedSessionsForViewer,
  loadFriendStatsBundle,
} from "./friendSessionService.js";
import { buildHistorySessionCard } from "./historySessionCard.js";
import { createProfileAvatarFace } from "./profileAvatarFace.js";
import { isLiveFeedSession } from "./feedSessionModel.js";
import { computeUserPeriodStats } from "./userStatsCalc.js";
import { buildFeedSessionCard } from "./feedSessionCard.js";

/** @param {string} msg */
let onError = (msg) => console.error(msg);

let viewingUserId = /** @type {string | null} */ (null);

/**
 * @param {{ onError?: (msg: string) => void }} [options]
 */
export function wireFriendProfileUi(options = {}) {
  if (typeof options.onError === "function") onError = options.onError;
  document.getElementById("profile-other-back")?.addEventListener("click", () => {
    backAppOr("/profile");
  });
  document.getElementById("profile-other-stats-open")?.addEventListener("click", () => {
    if (viewingUserId) navigateApp(pathForUserStats(viewingUserId));
  });
}

export function hideOtherProfileView() {
  viewingUserId = null;
  document.getElementById("profile-other-view")?.classList.add("hidden");
  document.getElementById("profile-self-view")?.classList.remove("hidden");
}

/**
 * @param {string} userId
 */
export async function showOtherProfileView(userId) {
  const myId = await getAuthUserId();
  if (myId && userId === myId) {
    navigateApp("/profile", { replace: true });
    return;
  }
  viewingUserId = userId;
  document.getElementById("profile-self-view")?.classList.add("hidden");
  document.getElementById("profile-other-view")?.classList.remove("hidden");
  await paintOtherProfile(userId);
}

/**
 * @param {string} userId
 */
async function paintOtherProfile(userId) {
  const nameEl = document.getElementById("profile-other-display-name");
  const userEl = document.getElementById("profile-other-username");
  const actionHost = document.getElementById("profile-other-actions");
  const statsBox = document.getElementById("profile-other-stats-open");
  const history = document.getElementById("profile-other-history");
  const historyList = document.getElementById("profile-other-history-list");
  const historyEmpty = document.getElementById("profile-other-history-empty");
  const liveHost = document.getElementById("profile-other-live");
  if (!nameEl || !userEl || !actionHost) return;

  nameEl.textContent = "…";
  userEl.textContent = "…";
  actionHost.innerHTML = "";
  showOtherAvatar(null);
  statsBox?.classList.add("hidden");
  history?.classList.add("hidden");
  if (liveHost) liveHost.innerHTML = "";

  const { profile, error } = await fetchProfileForUser(userId);
  if (error) onError(error);
  const label = profileDisplayLabel(profile || { id: userId, username: null, display_name: null }, userId);
  nameEl.textContent = label;
  const uname = profile?.username ? String(profile.username).trim() : "";
  userEl.textContent = uname ? `@${uname}` : "—";
  showOtherAvatar(profile?.avatar_url);

  const rel = await fetchRelationWith(userId);
  if (!rel.ok) {
    onError(rel.error);
    return;
  }
  paintRelationActions(actionHost, userId, rel.relation, rel.row);

  if (rel.relation !== "friends") return;

  statsBox?.classList.remove("hidden");
  history?.classList.remove("hidden");

  const bundle = await loadFriendStatsBundle(userId);
  if (bundle) {
    const year = new Date().getFullYear();
    const period = computeUserPeriodStats(bundle.sessions, bundle.catches, year);
    setText("profile-other-stat-sessions-value", String(period.sessionCount));
    setText("profile-other-stat-fish-value", String(period.fishCount));
  }

  const sessionsRes = await fetchOwnedSessionsForViewer(userId);
  if (!sessionsRes.ok) {
    onError(sessionsRes.error);
    return;
  }
  const live = sessionsRes.sessions.filter((s) => isLiveFeedSession(s));
  const ended = sessionsRes.sessions.filter((s) => !isLiveFeedSession(s));

  if (liveHost) {
    liveHost.innerHTML = "";
    for (const row of live) {
      liveHost.appendChild(
        buildFeedSessionCard(row, {
          displayName: label,
          avatarUrl: profile?.avatar_url,
          onOpen: () => navigateApp(pathForSessionDetail(row.id)),
        })
      );
    }
  }

  if (historyList) historyList.innerHTML = "";
  if (ended.length === 0) {
    if (historyEmpty) historyEmpty.hidden = false;
  } else if (historyEmpty) historyEmpty.hidden = true;

  for (const row of ended) {
    const btn = buildHistorySessionCard({
      placeNames: row.location_names || [],
      startTime: row.started_at || row.created_at ? new Date(row.started_at || row.created_at || 0).getTime() : Date.now(),
      endTime: row.ended_at ? new Date(row.ended_at).getTime() : null,
      catchCount: Number(row.catch_count) || 0,
      speciesKeys: Array.isArray(row.species_keys) ? row.species_keys : [],
      anglers: [{ id: userId, avatarUrl: profile?.avatar_url ?? null }],
    });
    btn.addEventListener("click", () => navigateApp(pathForSessionDetail(row.id)));
    historyList?.appendChild(btn);
  }
}

/**
 * @param {HTMLElement} host
 * @param {string} userId
 * @param {import('./friendshipState.js').FriendshipRelation} relation
 * @param {import('./friendshipState.js').FriendshipRow | null} row
 */
function paintRelationActions(host, userId, relation, row) {
  host.innerHTML = "";
  if (relation === "friends") {
    const pill = document.createElement("p");
    pill.className = "pill";
    pill.textContent = "Friends";
    host.appendChild(pill);
    return;
  }
  if (relation === "outgoing") {
    const pill = document.createElement("p");
    pill.className = "meta";
    pill.textContent = "Friend request sent";
    host.appendChild(pill);
    return;
  }
  if (relation === "incoming" && row?.id) {
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "btn btn-primary";
    accept.textContent = "Accept request";
    accept.addEventListener("click", async () => {
      const r = await acceptFriendRequest(row.id);
      if (!r.ok) onError(r.error);
      await paintOtherProfile(userId);
    });
    const decline = document.createElement("button");
    decline.type = "button";
    decline.className = "btn";
    decline.textContent = "Decline";
    decline.addEventListener("click", async () => {
      const r = await declineFriendRequest(row.id);
      if (!r.ok) onError(r.error);
      await paintOtherProfile(userId);
    });
    host.append(accept, decline);
    return;
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "btn btn-primary";
  add.textContent = "Add friend";
  add.addEventListener("click", async () => {
    const r = await sendFriendRequest(userId);
    if (!r.ok) onError(r.error);
    await paintOtherProfile(userId);
  });
  host.appendChild(add);
}

/**
 * @param {string | null | undefined} url
 */
function showOtherAvatar(url) {
  const host = document.getElementById("profile-other-avatar");
  if (!host) return;
  host.innerHTML = "";
  const face = createProfileAvatarFace(bustAvatarUrl(url) || url);
  face.classList.add("profile-other-avatar-face");
  host.appendChild(face);
}

/**
 * @param {string} id
 * @param {string} text
 */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
