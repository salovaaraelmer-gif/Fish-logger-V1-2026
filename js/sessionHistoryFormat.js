/**
 * History list header formatting.
 * @module sessionHistoryFormat
 */

import { formatKalapaivaDate } from "./sessionTitle.js";

/**
 * @param {number} startMs
 * @param {number | null} endMs
 * @returns {string | null}
 */
export function formatSessionDuration(startMs, endMs) {
  if (endMs == null || !Number.isFinite(endMs)) return null;
  const ms = endMs - startMs;
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/**
 * @param {{
 *   anglerLabel: string,
 *   locationNames: string[],
 *   startTime: number,
 *   endTime: number | null,
 * }} opts
 * @returns {string}
 */
export function formatHistorySessionHeader(opts) {
  const anglers = opts.anglerLabel.trim() || "—";
  const locations = formatHistoryCardPlace(opts.locationNames);
  const date = formatKalapaivaDate(opts.startTime);
  const duration = formatSessionDuration(opts.startTime, opts.endTime);
  const parts = [anglers, locations, date];
  if (duration) parts.push(duration);
  return parts.join(" · ");
}

/**
 * @param {string[]} locationNames
 * @returns {string}
 */
export function formatHistoryCardPlace(locationNames) {
  const names = (locationNames || []).map((n) => String(n).trim()).filter(Boolean);
  return names.length > 0 ? names.join(", ") : "No location";
}

/**
 * Compact secondary line: date · duration · catch count.
 * @param {{ startTime: number, endTime: number | null, catchCount: number }} opts
 * @returns {string}
 */
export function formatHistoryCardMeta(opts) {
  const date = formatKalapaivaDate(opts.startTime);
  const duration = formatSessionDuration(opts.startTime, opts.endTime);
  const n = Number.isFinite(opts.catchCount) ? Math.max(0, opts.catchCount) : 0;
  const catches = n === 1 ? "1 catch" : `${n} catches`;
  return duration ? `${date} · ${duration} · ${catches}` : `${date} · ${catches}`;
}
