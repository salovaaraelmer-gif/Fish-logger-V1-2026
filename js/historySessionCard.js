/**
 * Compact Profile → History session card.
 * @module historySessionCard
 */

import { SPECIES_LABELS, speciesIconSrc } from "./catchSpecies.js";
import { createProfileAvatarFace } from "./profileAvatarFace.js";
import { formatHistoryCardMeta, formatHistoryCardPlace } from "./sessionHistoryFormat.js";

const MAX_AVATARS = 4;
const MAX_SPECIES_ICONS = 4;

/**
 * @typedef {{
 *   placeNames: string[],
 *   startTime: number,
 *   endTime: number | null,
 *   catchCount: number,
 *   speciesKeys: string[],
 *   anglers: { id: string, avatarUrl?: string | null }[],
 * }} HistoryCardModel
 */

/**
 * @param {HistoryCardModel} model
 * @returns {HTMLButtonElement}
 */
export function buildHistorySessionCard(model) {
  const place = formatHistoryCardPlace(model.placeNames);
  const meta = formatHistoryCardMeta({
    startTime: model.startTime,
    endTime: model.endTime,
    catchCount: model.catchCount,
  });

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "history-session-row";
  btn.setAttribute("aria-label", historyCardAriaLabel(place, meta, model.speciesKeys));

  const top = document.createElement("div");
  top.className = "history-session-top";
  const placeEl = document.createElement("div");
  placeEl.className = "history-session-place";
  placeEl.textContent = place;
  top.append(placeEl, buildSpeciesIcons(model.speciesKeys));

  const metaEl = document.createElement("div");
  metaEl.className = "history-session-meta";
  metaEl.textContent = meta;

  btn.append(top, metaEl, buildAvatarRow(model.anglers));
  return btn;
}

/**
 * @param {string} place
 * @param {string} meta
 * @param {string[]} speciesKeys
 */
function historyCardAriaLabel(place, meta, speciesKeys) {
  const names = speciesKeys.map((k) => SPECIES_LABELS[k] || k);
  return names.length ? `${place}. ${meta}. ${names.join(", ")}` : `${place}. ${meta}`;
}

/**
 * @param {string[]} speciesKeys
 */
function buildSpeciesIcons(speciesKeys) {
  const row = document.createElement("div");
  row.className = "history-session-species";
  row.setAttribute("aria-hidden", "true");
  const extra = speciesKeys.length - MAX_SPECIES_ICONS;
  const shown = extra > 0 ? speciesKeys.slice(0, MAX_SPECIES_ICONS) : speciesKeys;
  for (const key of shown) {
    const src = speciesIconSrc(key);
    if (!src) continue;
    const img = document.createElement("img");
    img.className = "history-session-species-icon";
    img.src = src;
    img.alt = "";
    row.appendChild(img);
  }
  if (extra > 0) row.appendChild(overflowBadge(extra));
  return row;
}

/**
 * @param {{ id: string, avatarUrl?: string | null }[]} anglers
 */
function buildAvatarRow(anglers) {
  const row = document.createElement("div");
  row.className = "history-session-avatars";
  row.setAttribute("aria-hidden", "true");
  if (anglers.length === 0) return row;
  const extra = anglers.length - MAX_AVATARS;
  const shown = extra > 0 ? anglers.slice(0, MAX_AVATARS) : anglers;
  for (const angler of shown) {
    const face = createProfileAvatarFace(angler.avatarUrl);
    face.classList.add("history-session-avatar");
    row.appendChild(face);
  }
  if (extra > 0) {
    const more = overflowBadge(extra);
    more.classList.add("history-session-avatar-more");
    row.appendChild(more);
  }
  return row;
}

/**
 * @param {number} n
 */
function overflowBadge(n) {
  const el = document.createElement("span");
  el.className = "history-overflow";
  el.textContent = `+${n}`;
  return el;
}
