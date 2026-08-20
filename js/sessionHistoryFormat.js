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
  const locations =
    opts.locationNames.length > 0 ? opts.locationNames.join(", ") : "No location";
  const date = formatKalapaivaDate(opts.startTime);
  const duration = formatSessionDuration(opts.startTime, opts.endTime);
  const parts = [anglers, locations, date];
  if (duration) parts.push(duration);
  return parts.join(" · ");
}
