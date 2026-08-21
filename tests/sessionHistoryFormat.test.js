/**
 * History card text helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatHistoryCardMeta,
  formatHistoryCardPlace,
  formatSessionDuration,
} from "../js/sessionHistoryFormat.js";

describe("formatHistoryCardPlace", () => {
  it("uses the fishing spot as the title", () => {
    assert.equal(formatHistoryCardPlace(["Medvastö"]), "Medvastö");
  });

  it("joins multiple spots and falls back when empty", () => {
    assert.equal(formatHistoryCardPlace(["A", "B"]), "A, B");
    assert.equal(formatHistoryCardPlace([]), "No location");
  });
});

describe("formatHistoryCardMeta", () => {
  it("builds date, duration, and catch count", () => {
    const start = Date.UTC(2026, 4, 17, 8, 0, 0);
    const end = start + (5 * 60 + 38) * 60 * 1000;
    const line = formatHistoryCardMeta({ startTime: start, endTime: end, catchCount: 8 });
    assert.match(line, /5 h 38 min/);
    assert.match(line, /8 catches/);
  });

  it("uses singular catch", () => {
    const start = Date.UTC(2026, 0, 1, 12, 0, 0);
    const line = formatHistoryCardMeta({ startTime: start, endTime: start + 60 * 1000, catchCount: 1 });
    assert.match(line, /1 catch$/);
  });
});

describe("formatSessionDuration", () => {
  it("formats hours and minutes", () => {
    const start = 1_000_000;
    assert.equal(formatSessionDuration(start, start + (5 * 60 + 38) * 60 * 1000), "5 h 38 min");
  });
});
