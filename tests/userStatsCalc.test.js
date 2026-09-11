/**
 * Personal stats calculations.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STATS_ALL_TIME,
  calendarYear,
  computeUserPeriodStats,
  fishingTimeFromSessions,
  formatTop5SummaryLine,
  inYearPeriod,
  monthlyCatchCounts,
  speciesStatsLabel,
  statsForUserSpecies,
  sessionsForPersonalStats,
  catchesForPersonalStats,
  yearlyCatchCounts,
  yearsFromTimestamps,
} from "../js/userStatsCalc.js";
import { statsForAnglerSpecies } from "../js/speciesDashboardStats.js";

describe("year period", () => {
  it("keeps All time open and filters a calendar year", () => {
    const ts = Date.UTC(2026, 4, 17);
    assert.equal(inYearPeriod(ts, STATS_ALL_TIME), true);
    assert.equal(calendarYear(new Date(2026, 0, 1).getTime()), 2026);
  });

  it("always includes the current year", () => {
    assert.deepEqual(yearsFromTimestamps([], 2026), [2026]);
    assert.deepEqual(yearsFromTimestamps([new Date(2024, 6, 1).getTime()], 2026), [2026, 2024]);
  });
});

describe("formatTop5SummaryLine", () => {
  it("puts the total first and includes weight when present", () => {
    const line = formatTop5SummaryLine([
      { length: 114, weightKg: 10.7 },
      { length: 109, weightKg: null },
      { length: 106, weightKg: null },
      { length: 103, weightKg: null },
      { length: 101, weightKg: null },
    ]);
    assert.equal(line, "533 cm · 114 cm / 10.7 kg · 109 cm · 106 cm · 103 cm · 101 cm");
  });
});

describe("computeUserPeriodStats", () => {
  const sessions = [
    { id: "s1", startTime: new Date(2026, 4, 1).getTime(), endTime: new Date(2026, 4, 1).getTime() + 2 * 3600000 },
    { id: "s2", startTime: new Date(2025, 4, 1).getTime(), endTime: new Date(2025, 4, 1).getTime() + 3600000 },
  ];
  const catches = [
    { anglerId: "u1", species: "pike", timestamp: new Date(2026, 4, 1).getTime(), length: 110, weight_kg: 8 },
    { anglerId: "u1", species: "perch", timestamp: new Date(2026, 4, 1).getTime(), length: null },
    { anglerId: "u1", species: "pike", timestamp: new Date(2025, 4, 1).getTime(), length: 90 },
  ];

  it("counts sessions and all catches for the user year", () => {
    const stats = computeUserPeriodStats(sessions, catches, 2026);
    assert.equal(stats.sessionCount, 1);
    assert.equal(stats.fishCount, 2);
    assert.deepEqual(stats.speciesKeys, ["pike", "perch"]);
  });

  it("shares Top 5 with the session dashboard helper", () => {
    const stats = computeUserPeriodStats(sessions, catches, 2026);
    const shared = statsForAnglerSpecies(stats.catches, "u1", "pike");
    assert.deepEqual(shared.top5Lengths, [110]);
    assert.equal(shared.top5Total, 110);
  });
});

describe("speciesStatsLabel", () => {
  it("names All species and each fish", () => {
    assert.equal(speciesStatsLabel(STATS_ALL_TIME), "All species");
    assert.equal(speciesStatsLabel("pike"), "Pike");
  });
});

describe("statsForUserSpecies", () => {
  const catches = [
    { anglerId: "u1", species: "pike", length: 110, weight_kg: 8 },
    { anglerId: "u1", species: "perch", length: 30, weight_kg: null },
    { anglerId: "u2", species: "pike", length: 140, weight_kg: null },
  ];

  it("counts one species or every species for the user", () => {
    const pike = statsForUserSpecies(catches, "u1", "pike");
    assert.equal(pike.catchCount, 1);
    assert.deepEqual(pike.top5Fish.map((f) => f.length), [110]);
    const all = statsForUserSpecies(catches, "u1", STATS_ALL_TIME);
    assert.equal(all.catchCount, 2);
    assert.deepEqual(all.top5Fish.map((f) => f.length), [110, 30]);
  });

  it("keeps zero-catch species empty instead of dropping them", () => {
    const trout = statsForUserSpecies(catches, "u1", "trout");
    assert.equal(trout.catchCount, 0);
    assert.deepEqual(trout.top5Fish, []);
  });
});

describe("sessionsForPersonalStats", () => {
  it("keeps roster sessions and hosted sessions", () => {
    const all = [
      { id: "a", ownerUserId: "other" },
      { id: "b", ownerUserId: "u1" },
      { id: "c", ownerUserId: null },
    ];
    const rows = sessionsForPersonalStats(all, new Set(["a"]), "u1");
    assert.deepEqual(rows.map((s) => s.id), ["a", "b"]);
  });
});

describe("monthly and yearly buckets", () => {
  const catches = [
    { species: "pike", timestamp: new Date(2026, 0, 10).getTime() },
    { species: "pike", timestamp: new Date(2026, 0, 11).getTime() },
    { species: "perch", timestamp: new Date(2026, 5, 1).getTime() },
    { species: "pike", timestamp: new Date(2025, 5, 1).getTime() },
  ];

  it("counts a year by month and can filter species", () => {
    const all = monthlyCatchCounts(catches.filter((c) => calendarYear(c.timestamp) === 2026), STATS_ALL_TIME);
    assert.equal(all[0], 2);
    assert.equal(all[5], 1);
    const pike = monthlyCatchCounts(catches.filter((c) => calendarYear(c.timestamp) === 2026), "pike");
    assert.equal(pike[0], 2);
    assert.equal(pike[5], 0);
  });

  it("aggregates All time by year", () => {
    const rows = yearlyCatchCounts(catches, STATS_ALL_TIME);
    assert.deepEqual(rows, [
      { year: 2025, count: 1 },
      { year: 2026, count: 3 },
    ]);
  });
});

describe("fishingTimeFromSessions", () => {
  it("sums ended sessions only", () => {
    const start = 1_000_000;
    const t = fishingTimeFromSessions([
      { startTime: start, endTime: start + 2 * 3600000 },
      { startTime: start, endTime: null },
    ]);
    assert.equal(t.endedCount, 1);
    assert.equal(t.totalLabel, "2 h 0 min");
  });
});

describe("catchesForPersonalStats", () => {
  it("includes standalone fish and session fish for that user", () => {
    const rows = [
      { anglerId: "me", sessionId: "s1", species: "pike" },
      { anglerId: "me", sessionId: null, species: "perch" },
      { anglerId: "other", sessionId: null, species: "pike" },
      { anglerId: "me", sessionId: "other-session", species: "trout" },
    ];
    assert.deepEqual(
      catchesForPersonalStats(rows, "me", new Set(["s1"])).map((c) => c.species),
      ["pike", "perch"]
    );
  });
});
