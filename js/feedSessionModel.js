/**
 * Friend-feed session card model (one card per session; live cards update in place).
 * @module feedSessionModel
 */

import { SPECIES_LABELS } from "./catchSpecies.js";
import { formatDurationFromMs, formatHistoryCardPlace } from "./sessionHistoryFormat.js";
import { formatKalapaivaDate } from "./sessionTitle.js";

/**
 * @typedef {{
 *   id: string,
 *   user_id: string,
 *   title?: string | null,
 *   started_at?: string | null,
 *   created_at?: string | null,
 *   ended_at?: string | null,
 *   location_names?: string[] | null,
 *   catch_count?: number | null,
 *   latest_species?: string | null,
 *   latest_length_cm?: number | string | null,
 *   latest_caught_at?: string | null,
 *   latest_angler_id?: string | null,
 *   species_keys?: string[] | null,
 * }} FriendSessionRow
 */

/**
 * @param {FriendSessionRow | null | undefined} row
 * @returns {boolean}
 */
export function isLiveFeedSession(row) {
  if (!row) return false;
  return row.ended_at == null || String(row.ended_at).trim() === "";
}

/**
 * @param {FriendSessionRow} row
 * @returns {number}
 */
export function feedSessionStartMs(row) {
  const raw = row?.started_at || row?.created_at;
  const ms = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ms) ? ms : Date.now();
}

/**
 * @param {FriendSessionRow} row
 * @returns {number | null}
 */
export function feedSessionEndMs(row) {
  if (!row?.ended_at) return null;
  const ms = new Date(row.ended_at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {FriendSessionRow} row
 * @param {number} [nowMs]
 * @returns {string | null}
 */
export function feedSessionDurationLabel(row, nowMs = Date.now()) {
  const start = feedSessionStartMs(row);
  const end = isLiveFeedSession(row) ? nowMs : feedSessionEndMs(row);
  if (end == null) return null;
  return formatDurationFromMs(end - start);
}

/**
 * @param {FriendSessionRow} row
 * @returns {string | null}
 */
export function formatLatestCatchLine(row) {
  const species = row?.latest_species ? String(row.latest_species) : "";
  if (!species) return null;
  const label = SPECIES_LABELS[species] || species;
  const length = row.latest_length_cm != null ? Number(row.latest_length_cm) : NaN;
  if (Number.isFinite(length) && length > 0) {
    return `${label} · ${length} cm`;
  }
  return label;
}

/**
 * Merge feed rows by session id so ending a session updates the same card.
 * Live sessions stay first, then newest activity.
 * @param {FriendSessionRow[]} rows
 * @returns {FriendSessionRow[]}
 */
export function mergeFeedSessionsById(rows) {
  /** @type {Map<string, FriendSessionRow>} */
  const byId = new Map();
  for (const row of rows || []) {
    if (!row || typeof row.id !== "string" || !row.id) continue;
    byId.set(row.id, row);
  }
  const list = [...byId.values()];
  list.sort((a, b) => {
    const liveA = isLiveFeedSession(a) ? 1 : 0;
    const liveB = isLiveFeedSession(b) ? 1 : 0;
    if (liveA !== liveB) return liveB - liveA;
    const aMs = feedSessionEndMs(a) || feedSessionStartMs(a);
    const bMs = feedSessionEndMs(b) || feedSessionStartMs(b);
    return bMs - aMs;
  });
  return list;
}

/**
 * Feed visibility for the signed-in viewer.
 * `includeOwnSessions` is the future "Show my sessions in Feed" switch; keep it off for now.
 * @returns {{ includeOwnSessions: boolean }}
 */
export function defaultFeedVisibility() {
  return { includeOwnSessions: false };
}

/**
 * Drop the viewer's own sessions unless includeOwnSessions is on.
 * @param {FriendSessionRow[]} rows
 * @param {string | null | undefined} viewerId
 * @param {{ includeOwnSessions?: boolean }} [visibility]
 * @returns {FriendSessionRow[]}
 */
export function visibleFeedSessions(rows, viewerId, visibility = defaultFeedVisibility()) {
  const merged = mergeFeedSessionsById(rows);
  if (visibility?.includeOwnSessions) return merged;
  if (!viewerId) return merged;
  return merged.filter((row) => row.user_id !== viewerId);
}

/**
 * @param {FriendSessionRow} row
 * @param {{ displayName?: string, catchCount?: number, nowMs?: number }} [opts]
 */
export function feedCardMetaLine(row, opts = {}) {
  const place = formatHistoryCardPlace(row.location_names || []);
  const live = isLiveFeedSession(row);
  const duration = feedSessionDurationLabel(row, opts.nowMs);
  const n = Number.isFinite(opts.catchCount) ? opts.catchCount : Number(row.catch_count) || 0;
  const catches = n === 1 ? "1 fish" : `${n} fish`;
  if (live) {
    return [place, duration, catches].filter(Boolean).join(" · ");
  }
  const date = formatKalapaivaDate(feedSessionStartMs(row));
  return [place, date, duration, catches].filter(Boolean).join(" · ");
}
