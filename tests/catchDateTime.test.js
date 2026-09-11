import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATCH_TIME_NOW_SLACK_MS,
  formatLocalDateInput,
  formatLocalTimeInput,
  isCatchTimeEffectivelyNow,
  parseLocalDateTimeMs,
} from "../js/catchDateTime.js";

describe("local catch date and time", () => {
  it("round-trips a local September evening", () => {
    const ms = new Date(2026, 8, 8, 18, 42, 0, 0).getTime();
    const date = formatLocalDateInput(ms);
    const time = formatLocalTimeInput(ms);
    assert.equal(date, "2026-09-08");
    assert.equal(time, "18:42");
    assert.equal(parseLocalDateTimeMs(date, time), ms);
  });

  it("accepts a time value with seconds from the picker", () => {
    const ms = new Date(2026, 8, 8, 18, 42, 7, 0).getTime();
    assert.equal(parseLocalDateTimeMs("2026-09-08", "18:42:07"), ms);
  });

  it("rejects incomplete values", () => {
    assert.equal(parseLocalDateTimeMs("", "18:42"), null);
    assert.equal(parseLocalDateTimeMs("2026-09-08", ""), null);
    assert.equal(parseLocalDateTimeMs("8.9.26", "18:42"), null);
  });
});

describe("isCatchTimeEffectivelyNow", () => {
  it("treats the current minute as now", () => {
    const now = Date.UTC(2026, 8, 11, 10, 0, 0);
    assert.equal(isCatchTimeEffectivelyNow(now, now), true);
  });

  it("allows a short logging delay and rejects older times", () => {
    const now = Date.UTC(2026, 8, 11, 10, 0, 0);
    assert.equal(isCatchTimeEffectivelyNow(now - CATCH_TIME_NOW_SLACK_MS, now), true);
    assert.equal(isCatchTimeEffectivelyNow(now - CATCH_TIME_NOW_SLACK_MS - 1, now), false);
    assert.equal(isCatchTimeEffectivelyNow(now - 3 * 24 * 60 * 60 * 1000, now), false);
  });
});
