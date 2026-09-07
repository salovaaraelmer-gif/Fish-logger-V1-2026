/**
 * Feed / live-session card. Same session id always maps to one card.
 * @module feedSessionCard
 */

import { SPECIES_LABELS, speciesIconSrc } from "./catchSpecies.js";
import {
  feedCardMetaLine,
  formatLatestCatchLine,
  isLiveFeedSession,
} from "./feedSessionModel.js";
import { createProfileAvatarFace } from "./profileAvatarFace.js";
import { getSessionDisplayTitle } from "./sessionTitle.js";

const MAX_SPECIES_ICONS = 4;

/**
 * @param {import('./feedSessionModel.js').FriendSessionRow} row
 * @param {{
 *   displayName?: string,
 *   avatarUrl?: string | null,
 *   nowMs?: number,
 *   onOpen?: () => void,
 * }} [opts]
 * @returns {HTMLButtonElement}
 */
export function buildFeedSessionCard(row, opts = {}) {
  const live = isLiveFeedSession(row);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = live ? "feed-session-card is-live" : "feed-session-card";
  btn.dataset.sessionId = row.id;
  const title = getSessionDisplayTitle({
    title: row.title,
    startTime: row.started_at ? new Date(row.started_at).getTime() : Date.now(),
  });
  btn.setAttribute("aria-label", live ? `Live session: ${title}` : title);

  const head = document.createElement("div");
  head.className = "feed-session-head";
  const face = createProfileAvatarFace(opts.avatarUrl);
  face.classList.add("feed-session-avatar");
  const who = document.createElement("div");
  who.className = "feed-session-who";
  const name = document.createElement("div");
  name.className = "feed-session-name";
  name.textContent = opts.displayName || "Angler";
  const status = document.createElement("div");
  status.className = live ? "feed-session-status" : "feed-session-status is-done";
  status.textContent = live ? "Fishing now" : "Ended";
  who.append(name, status);
  head.append(face, who);
  if (live) {
    const pulse = document.createElement("span");
    pulse.className = "feed-live-dot";
    pulse.setAttribute("aria-hidden", "true");
    head.appendChild(pulse);
  }

  const place = document.createElement("div");
  place.className = "feed-session-title";
  place.textContent = title;

  const meta = document.createElement("div");
  meta.className = "feed-session-meta";
  meta.textContent = feedCardMetaLine(row, { nowMs: opts.nowMs });

  const latest = formatLatestCatchLine(row);
  const latestEl = document.createElement("div");
  latestEl.className = "feed-session-latest";
  latestEl.textContent = latest ? `Latest: ${latest}` : "No catches yet";

  btn.append(head, place, meta, latestEl, buildSpeciesRow(row.species_keys || []));
  if (typeof opts.onOpen === "function") {
    btn.addEventListener("click", opts.onOpen);
  }
  return btn;
}

/**
 * @param {string[]} speciesKeys
 */
function buildSpeciesRow(speciesKeys) {
  const row = document.createElement("div");
  row.className = "feed-session-species";
  row.setAttribute("aria-hidden", "true");
  const extra = speciesKeys.length - MAX_SPECIES_ICONS;
  const shown = extra > 0 ? speciesKeys.slice(0, MAX_SPECIES_ICONS) : speciesKeys;
  for (const key of shown) {
    const src = speciesIconSrc(key);
    if (!src) continue;
    const img = document.createElement("img");
    img.className = "history-session-species-icon";
    img.src = src;
    img.alt = SPECIES_LABELS[key] || key;
    row.appendChild(img);
  }
  return row;
}
