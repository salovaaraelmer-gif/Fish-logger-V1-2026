/**
 * Session title helpers: default "Kalapäivä | D.M.YY" (no leading zeros on day/month).
 * @module sessionTitle
 */

/**
 * @param {number} [ts=Date.now()] — epoch ms
 * @returns {string} e.g. "31.3.26"
 */
export function formatKalapaivaDate(ts = Date.now()) {
  const d = new Date(ts);
  const day = d.getDate();
  const month = d.getMonth() + 1;
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  return `${day}.${month}.${yy}`;
}

/**
 * @param {number} [ts=Date.now()]
 */
export function defaultSessionTitleFromDate(ts = Date.now()) {
  return `Kalapäivä | ${formatKalapaivaDate(ts)}`;
}

/**
 * @param {import('./db.js').Session | null | undefined} session
 */
export function getSessionDisplayTitle(session) {
  if (session && typeof session.title === "string" && session.title.trim()) {
    return session.title.trim();
  }
  return defaultSessionTitleFromDate(Date.now());
}
