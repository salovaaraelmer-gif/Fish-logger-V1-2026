/**
 * Pure personal fishing stats (year filter, Top 5 line, monthly buckets).
 * @module userStatsCalc
 */

import { SPECIES_OPTIONS, speciesWithCatches } from "./catchSpecies.js";
import { formatDurationFromMs } from "./sessionHistoryFormat.js";

export const STATS_ALL_TIME = "all";

export const MONTH_LABELS = Object.freeze([
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]);

/**
 * @param {number} ts
 * @returns {number}
 */
export function calendarYear(ts) {
  return new Date(ts).getFullYear();
}

/**
 * @param {number} ts
 * @param {number | typeof STATS_ALL_TIME} year
 */
export function inYearPeriod(ts, year) {
  if (year === STATS_ALL_TIME) return true;
  return Number.isFinite(ts) && calendarYear(ts) === year;
}

/**
 * Current calendar year is always included so the default dropdown exists.
 * @param {number[]} timestamps
 * @param {number} currentYear
 * @returns {number[]}
 */
export function yearsFromTimestamps(timestamps, currentYear) {
  const years = new Set();
  if (Number.isFinite(currentYear)) years.add(currentYear);
  for (const ts of timestamps) {
    if (Number.isFinite(ts)) years.add(calendarYear(ts));
  }
  return [...years].sort((a, b) => b - a);
}

/**
 * @param {{ length: number, weightKg: number | null }[]} fish
 * @returns {string}
 */
export function formatTop5SummaryLine(fish) {
  if (!fish.length) return "No measured catches";
  const total = fish.reduce((sum, f) => sum + f.length, 0);
  const parts = [`${total} cm`];
  for (const f of fish) {
    if (f.weightKg != null) {
      const kg = f.weightKg.toLocaleString("en-GB", { maximumFractionDigits: 2 });
      parts.push(`${f.length} cm / ${kg} kg`);
    } else {
      parts.push(`${f.length} cm`);
    }
  }
  return parts.join(" · ");
}

/**
 * @param {import('./db.js').Session[]} sessions
 * @returns {{ totalMs: number, endedCount: number, totalLabel: string, averageLabel: string }}
 */
export function fishingTimeFromSessions(sessions) {
  let totalMs = 0;
  let endedCount = 0;
  for (const s of sessions) {
    if (s.endTime == null || !Number.isFinite(s.startTime) || !Number.isFinite(s.endTime)) continue;
    const dur = s.endTime - s.startTime;
    if (dur < 0) continue;
    totalMs += dur;
    endedCount += 1;
  }
  const totalLabel = formatDurationFromMs(totalMs) || "0 min";
  const averageLabel =
    endedCount > 0 ? formatDurationFromMs(totalMs / endedCount) || "0 min" : "—";
  return { totalMs, endedCount, totalLabel, averageLabel };
}

/**
 * @param {import('./db.js').CatchRecord[]} catches
 * @param {string | typeof STATS_ALL_TIME} speciesKey
 * @returns {number[]} length 12
 */
export function monthlyCatchCounts(catches, speciesKey) {
  const counts = Array(12).fill(0);
  for (const c of catches) {
    if (speciesKey !== STATS_ALL_TIME && c.species !== speciesKey) continue;
    if (!Number.isFinite(c.timestamp)) continue;
    counts[new Date(c.timestamp).getMonth()] += 1;
  }
  return counts;
}

/**
 * @param {import('./db.js').CatchRecord[]} catches
 * @param {string | typeof STATS_ALL_TIME} speciesKey
 * @returns {{ year: number, count: number }[]}
 */
export function yearlyCatchCounts(catches, speciesKey) {
  /** @type {Map<number, number>} */
  const byYear = new Map();
  for (const c of catches) {
    if (speciesKey !== STATS_ALL_TIME && c.species !== speciesKey) continue;
    if (!Number.isFinite(c.timestamp)) continue;
    const y = calendarYear(c.timestamp);
    byYear.set(y, (byYear.get(y) || 0) + 1);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => ({ year, count }));
}

/**
 * @param {import('./db.js').Session[]} sessions
 * @param {import('./db.js').CatchRecord[]} catches
 * @param {number | typeof STATS_ALL_TIME} year
 */
export function computeUserPeriodStats(sessions, catches, year) {
  const periodSessions = sessions.filter((s) => inYearPeriod(s.startTime, year));
  const periodCatches = catches.filter((c) => inYearPeriod(c.timestamp, year));
  const speciesKeys = speciesWithCatches(periodCatches);
  const primarySpecies = SPECIES_OPTIONS.find((k) => speciesKeys.includes(k)) || speciesKeys[0] || null;
  const time = fishingTimeFromSessions(periodSessions);
  return {
    sessionCount: periodSessions.length,
    fishCount: periodCatches.length,
    sessions: periodSessions,
    catches: periodCatches,
    speciesKeys,
    primarySpecies,
    time,
  };
}
