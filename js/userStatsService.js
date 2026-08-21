/**
 * Load personal stats from local session roster + catches.
 * @module userStatsService
 */

import { getAllCatches, getAllSessions, getSessionAnglerRowsForAngler } from "./db.js";
import { getAuthUserId } from "./auth.js";
import { yearsFromTimestamps } from "./userStatsCalc.js";

/**
 * @typedef {{
 *   userId: string,
 *   sessions: import('./db.js').Session[],
 *   catches: import('./db.js').CatchRecord[],
 *   years: number[],
 * }} UserStatsBundle
 */

/**
 * Sessions the user participated in; catches they logged.
 * @returns {Promise<UserStatsBundle | null>}
 */
export async function loadUserStatsBundle() {
  const userId = await getAuthUserId();
  if (!userId) return null;
  const [allSessions, roster, allCatches] = await Promise.all([
    getAllSessions(),
    getSessionAnglerRowsForAngler(userId),
    getAllCatches(),
  ]);
  const sessionIds = new Set(roster.map((row) => row.sessionId));
  const sessions = allSessions.filter((s) => sessionIds.has(s.id));
  const catches = allCatches.filter((c) => c.anglerId === userId);
  const timestamps = [
    ...sessions.map((s) => s.startTime),
    ...catches.map((c) => c.timestamp),
  ];
  return {
    userId,
    sessions,
    catches,
    years: yearsFromTimestamps(timestamps, new Date().getFullYear()),
  };
}
