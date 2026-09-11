/**
 * Local catch date/time helpers for standalone logging.
 * @module catchDateTime
 */

/** Catch time within this window of now may use live GPS and current weather. */
export const CATCH_TIME_NOW_SLACK_MS = 10 * 60 * 1000;

/**
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * @param {number} [ms]
 * @returns {string} YYYY-MM-DD in local time
 */
export function formatLocalDateInput(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * @param {number} [ms]
 * @returns {string} HH:MM in local time
 */
export function formatLocalTimeInput(ms = Date.now()) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Combines `<input type="date">` and `<input type="time">` as local time.
 *
 * @param {string} dateStr
 * @param {string} timeStr
 * @returns {number | null}
 */
export function parseLocalDateTimeMs(dateStr, timeStr) {
  const date = String(dateStr || "").trim();
  const time = String(timeStr || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return null;
  const ms = new Date(`${date}T${time}`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {number} caughtAtMs
 * @param {number} [nowMs]
 */
export function isCatchTimeEffectivelyNow(caughtAtMs, nowMs = Date.now()) {
  if (!Number.isFinite(caughtAtMs) || !Number.isFinite(nowMs)) return false;
  return Math.abs(caughtAtMs - nowMs) <= CATCH_TIME_NOW_SLACK_MS;
}
