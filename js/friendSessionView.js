/**
 * Read-only friend session detail in the existing catches overlay.
 * @module friendSessionView
 */

import {
  destroyCatchesMap,
  invalidateActiveCatchesMapSize,
  mountCatchesMap,
  renderSpeciesLegend,
} from "./catchesMap.js";
import { SPECIES_LABELS, speciesIconSrc } from "./catchSpecies.js";
import { createProfileAvatarFace } from "./profileAvatarFace.js";
import { fetchProfilesByIds, profileDisplayLabel } from "./supabaseProfile.js";
import {
  fetchSessionCatchesForViewer,
  fetchSessionDetailForViewer,
  viewerSessionToLocal,
} from "./friendSessionService.js";
import { isLiveFeedSession } from "./feedSessionModel.js";
import { formatSessionDuration } from "./sessionHistoryFormat.js";
import { formatKalapaivaDate, getSessionDisplayTitle } from "./sessionTitle.js";
import { mountSpeciesDashboard } from "./speciesDashboard.js";
import { normalizePhotoUrls } from "./catchRecordMap.js";
import { openCatchPhotoViewer } from "./catchPhotoUi.js";

const POLL_MS = 12000;

/** @type {ReturnType<typeof setInterval> | null} */
let pollId = null;
/** @type {import('./catchesMap.js').CatchesMapOptions | null} */
let lastMapOpts = null;
let lastSessionId = /** @type {string | null} */ (null);

export function stopFriendSessionPoll() {
  if (pollId != null) {
    clearInterval(pollId);
    pollId = null;
  }
}

export function clearRemoteSessionView() {
  stopFriendSessionPoll();
  lastMapOpts = null;
  lastSessionId = null;
  const ov = document.getElementById("catches-overlay");
  if (ov) delete ov.dataset.remoteSession;
  document.getElementById("catches-open-options")?.classList.remove("hidden");
  document.getElementById("catches-ended-title-input")?.classList.remove("hidden");
}

/**
 * @returns {boolean}
 */
export function mountRemoteSessionMapIfAny() {
  const container = document.getElementById("catches-map-container");
  if (!lastMapOpts || !container) return false;
  const has = mountCatchesMap(container, lastMapOpts);
  const noLoc = document.getElementById("catches-map-no-loc");
  if (noLoc) noLoc.hidden = has;
  renderSpeciesLegend(document.getElementById("catches-map-legend"));
  invalidateActiveCatchesMapSize();
  return true;
}

/**
 * Paint a friend-visible session. Returns false if the viewer cannot read it.
 * @param {string} sessionId
 */
export async function openRemoteSessionDetail(sessionId) {
  const detail = await fetchSessionDetailForViewer(sessionId);
  if (!detail.ok) return false;
  lastSessionId = sessionId;
  const ov = document.getElementById("catches-overlay");
  if (ov) {
    ov.dataset.viewSessionId = sessionId;
    ov.dataset.remoteSession = "1";
    ov.classList.remove("hidden");
  }
  document.getElementById("catches-home-panel")?.classList.remove("hidden");
  document.getElementById("catches-list-panel")?.classList.add("hidden");
  document.getElementById("catches-map-panel")?.classList.add("hidden");
  document.getElementById("catches-options-panel")?.classList.add("hidden");
  await paintRemoteSession(detail.session);
  stopFriendSessionPoll();
  if (isLiveFeedSession(detail.session)) {
    pollId = setInterval(() => {
      void refreshRemoteSession();
    }, POLL_MS);
  }
  return true;
}

async function refreshRemoteSession() {
  if (!lastSessionId) return;
  const detail = await fetchSessionDetailForViewer(lastSessionId);
  if (!detail.ok) return;
  await paintRemoteSession(detail.session);
  if (!isLiveFeedSession(detail.session)) stopFriendSessionPoll();
}

/**
 * @param {Record<string, unknown>} sessionRow
 */
async function paintRemoteSession(sessionRow) {
  const sessionId = String(sessionRow.id || "");
  const catchesRes = await fetchSessionCatchesForViewer(sessionId);
  const catches = catchesRes.ok ? catchesRes.catches : [];
  const roster = Array.isArray(sessionRow.roster_user_ids)
    ? sessionRow.roster_user_ids.filter((id) => typeof id === "string")
    : [];
  const ownerId = typeof sessionRow.user_id === "string" ? sessionRow.user_id : null;
  const anglerIds = [...new Set([...roster, ...catches.map((c) => c.anglerId), ownerId].filter(Boolean))];
  const profiles = await fetchProfilesByIds(/** @type {string[]} */ (anglerIds));

  /** @type {Record<string, string>} */
  const nameById = {};
  /** @type {Record<string, string | null>} */
  const avatarById = {};
  for (const id of anglerIds) {
    const row = profiles.get(id);
    nameById[id] = profileDisplayLabel(row, id);
    avatarById[id] = row?.avatar_url || null;
  }

  document.getElementById("catches-session-menu-btn")?.classList.add("hidden");
  document.getElementById("catches-open-options")?.classList.add("hidden");
  document.getElementById("catches-ended-title-input")?.classList.add("hidden");

  const titleWrap = document.getElementById("catches-ended-title-wrap");
  const titleDisp = document.getElementById("catches-ended-title-display");
  const localSession = viewerSessionToLocal(sessionRow);
  if (titleWrap && titleDisp) {
    titleWrap.classList.remove("hidden");
    titleWrap.setAttribute("aria-hidden", "false");
    titleDisp.textContent = getSessionDisplayTitle(localSession);
    titleDisp.removeAttribute("tabindex");
  }

  const live = isLiveFeedSession(/** @type {import('./feedSessionModel.js').FriendSessionRow} */ (sessionRow));
  const dashEl = document.getElementById("catches-ended-dashboard");
  const summaryDl = document.getElementById("ended-dash-summary-dl");
  if (dashEl && summaryDl) {
    dashEl.classList.remove("hidden");
    fillRemoteSummary(summaryDl, localSession, sessionRow, catches, nameById, ownerId, live);
  }

  const dashHost = document.getElementById("ended-species-dashboard");
  if (dashHost) {
    mountSpeciesDashboard(dashHost, {
      anglers: anglerIds.map((id) => ({
        id,
        name: nameById[id],
        avatarUrl: avatarById[id],
      })),
      catches,
      targetSpeciesKeys: [],
    });
    dashHost.classList.remove("hidden");
  }

  const listEl = document.getElementById("catches-table-body");
  const emptyEl = document.getElementById("catches-empty");
  const wrap = document.getElementById("catches-table-wrap");
  if (listEl) {
    listEl.innerHTML = "";
    const sorted = [...catches].sort((a, b) => a.timestamp - b.timestamp);
    for (const c of sorted) {
      listEl.appendChild(buildReadOnlyCatchCard(c, nameById, avatarById, live));
    }
  }
  if (catches.length === 0) {
    emptyEl?.classList.remove("hidden");
    if (emptyEl) emptyEl.textContent = "No catches logged in this session.";
  } else {
    emptyEl?.classList.add("hidden");
    wrap?.classList.remove("hidden");
  }

  lastMapOpts = {
    catches,
    nameById,
    ownerUserId: ownerId,
    activeSession: live,
  };
  const mapPanel = document.getElementById("catches-map-panel");
  if (mapPanel && !mapPanel.classList.contains("hidden")) {
    mountRemoteSessionMapIfAny();
  }
}

/**
 * @param {HTMLElement} dl
 * @param {import('./db.js').Session} session
 * @param {Record<string, unknown>} sessionRow
 * @param {import('./db.js').CatchRecord[]} catches
 * @param {Record<string, string>} nameById
 * @param {string | null} ownerId
 * @param {boolean} live
 */
function fillRemoteSummary(dl, session, sessionRow, catches, nameById, ownerId, live) {
  dl.innerHTML = "";
  appendDl(dl, "Day", formatKalapaivaDate(session.startTime));
  const duration = live
    ? formatSessionDuration(session.startTime, Date.now())
    : formatSessionDuration(session.startTime, session.endTime);
  if (duration) appendDl(dl, "Duration", duration);
  const loc = Array.isArray(sessionRow.location_names) ? sessionRow.location_names : [];
  appendDl(dl, "Fishing spots", loc.length ? loc.join(", ") : "No location");
  appendDl(dl, "Total catches", String(catches.length));
  if (ownerId) appendDl(dl, "Owner", nameById[ownerId] || ownerId);
}

/**
 * @param {HTMLElement} dl
 * @param {string} label
 * @param {string} value
 */
function appendDl(dl, label, value) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  dl.append(dt, dd);
}

/**
 * @param {import('./db.js').CatchRecord} c
 * @param {Record<string, string>} nameById
 * @param {Record<string, string | null>} avatarById
 * @param {boolean} live
 */
function buildReadOnlyCatchCard(c, nameById, avatarById, live) {
  const article = document.createElement("article");
  article.className = "catch-card";
  article.setAttribute("role", "listitem");
  const body = document.createElement("div");
  body.className = "catch-card-body";
  const anglerRow = document.createElement("div");
  anglerRow.className = "catch-card-angler";
  const face = createProfileAvatarFace(avatarById[c.anglerId]);
  face.classList.add("catch-card-avatar");
  const nameEl = document.createElement("span");
  nameEl.className = "catch-card-angler-name";
  nameEl.textContent = nameById[c.anglerId] || c.anglerId;
  anglerRow.append(face, nameEl);
  const fishRow = document.createElement("div");
  fishRow.className = "catch-card-fish";
  const iconSrc = speciesIconSrc(c.species);
  if (iconSrc) {
    const icon = document.createElement("img");
    icon.className = "catch-card-species-icon";
    icon.src = iconSrc;
    icon.alt = "";
    fishRow.appendChild(icon);
  }
  const parts = [SPECIES_LABELS[c.species] || c.species];
  if (c.length != null) parts.push(`${c.length} cm`);
  if (c.weight_kg != null) {
    parts.push(`${c.weight_kg.toLocaleString("en-GB", { maximumFractionDigits: 2 })} kg`);
  }
  const fishText = document.createElement("span");
  fishText.textContent = parts.join(" · ");
  fishRow.appendChild(fishText);
  const whenEl = document.createElement("div");
  whenEl.className = "catch-card-meta";
  const d = new Date(c.timestamp);
  whenEl.textContent = live
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  body.append(anglerRow, fishRow, whenEl);
  article.appendChild(body);
  const photos = normalizePhotoUrls(c.photo_urls);
  if (photos[0]) {
    const img = document.createElement("img");
    img.className = "catch-card-photo-main";
    img.src = photos[0];
    img.alt = "";
    img.addEventListener("click", () => openCatchPhotoViewer(photos[0]));
    article.appendChild(img);
  }
  return article;
}

export { destroyCatchesMap };
