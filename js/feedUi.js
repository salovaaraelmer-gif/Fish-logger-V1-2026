/**
 * Friends activity feed: one card per friend session, updated in place.
 * @module feedUi
 */

import { navigateApp } from "./appRouter.js";
import { pathForSessionDetail, pathForUserProfile } from "./appRoutes.js";
import { buildFeedSessionCard } from "./feedSessionCard.js";
import { fetchFriendFeedSessions } from "./friendSessionService.js";
import { fetchProfilesByIds, profileDisplayLabel } from "./supabaseProfile.js";

const POLL_MS = 12000;

/** @param {string} msg */
let onError = (msg) => console.error(msg);

/** @type {ReturnType<typeof setInterval> | null} */
let pollId = null;
let wired = false;

export function stopFeedPoll() {
  if (pollId != null) {
    clearInterval(pollId);
    pollId = null;
  }
}

export function startFeedPoll() {
  stopFeedPoll();
  pollId = setInterval(() => {
    void refreshFeed({ silent: true });
  }, POLL_MS);
}

/**
 * @param {{ onError?: (msg: string) => void }} [options]
 */
export function wireFeedUi(options = {}) {
  if (wired) return;
  wired = true;
  if (typeof options.onError === "function") onError = options.onError;
}

/**
 * @param {{ silent?: boolean }} [opts]
 */
export async function refreshFeed(opts = {}) {
  const list = document.getElementById("feed-list");
  const empty = document.getElementById("feed-empty");
  if (!list) return;

  const res = await fetchFriendFeedSessions();
  if (!res.ok) {
    if (!opts.silent) onError(res.error);
    return;
  }

  const ownerIds = [...new Set(res.sessions.map((s) => s.user_id).filter(Boolean))];
  const profiles = await fetchProfilesByIds(ownerIds);
  const nowMs = Date.now();

  list.innerHTML = "";
  if (res.sessions.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  for (const row of res.sessions) {
    const profile = profiles.get(row.user_id);
    const card = buildFeedSessionCard(row, {
      displayName: profileDisplayLabel(profile, row.user_id),
      avatarUrl: profile?.avatar_url,
      nowMs,
      onOpen: () => navigateApp(pathForSessionDetail(row.id)),
    });
    const nameBtn = card.querySelector(".feed-session-name");
    if (nameBtn) {
      nameBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        navigateApp(pathForUserProfile(row.user_id));
      });
    }
    list.appendChild(card);
  }
}
