import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultFeedVisibility,
  feedCardMetaLine,
  formatLatestCatchLine,
  isLiveFeedSession,
  mergeFeedSessionsById,
  visibleFeedSessions,
} from "../js/feedSessionModel.js";

describe("feedSessionModel", () => {
  it("treats a null ended_at as the live card for that session", () => {
    assert.equal(isLiveFeedSession({ id: "s1", user_id: "u1", ended_at: null }), true);
    assert.equal(isLiveFeedSession({ id: "s1", user_id: "u1", ended_at: "2026-09-01T12:00:00Z" }), false);
  });

  it("keeps one card per session id when the same session ends", () => {
    const live = { id: "s1", user_id: "u1", ended_at: null, catch_count: 2, created_at: "2026-09-01T08:00:00Z" };
    const ended = { id: "s1", user_id: "u1", ended_at: "2026-09-01T12:00:00Z", catch_count: 4, created_at: "2026-09-01T08:00:00Z" };
    const merged = mergeFeedSessionsById([live, ended]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].catch_count, 4);
    assert.equal(isLiveFeedSession(merged[0]), false);
  });

  it("sorts live sessions above completed ones", () => {
    const live = { id: "s-live", user_id: "u1", ended_at: null, created_at: "2026-01-01T00:00:00Z" };
    const done = {
      id: "s-done",
      user_id: "u2",
      ended_at: "2026-09-01T12:00:00Z",
      created_at: "2026-09-01T08:00:00Z",
    };
    const merged = mergeFeedSessionsById([done, live]);
    assert.equal(merged[0].id, "s-live");
    assert.equal(merged[1].id, "s-done");
  });

  it("formats latest catch and live meta without duplicating a new item", () => {
    assert.equal(
      formatLatestCatchLine({ latest_species: "pike", latest_length_cm: 82 }),
      "Pike · 82 cm"
    );
    const meta = feedCardMetaLine(
      {
        id: "s1",
        user_id: "u1",
        ended_at: null,
        location_names: ["Kymijoki"],
        catch_count: 3,
        started_at: "2026-09-01T10:00:00Z",
      },
      { nowMs: Date.parse("2026-09-01T11:30:00Z") }
    );
    assert.match(meta, /Kymijoki/);
    assert.match(meta, /3 fish/);
  });

  it("hides the viewer's own sessions unless includeOwnSessions is on", () => {
    const mine = { id: "s-me", user_id: "me", ended_at: null, created_at: "2026-09-01T08:00:00Z" };
    const friend = { id: "s-fr", user_id: "friend", ended_at: null, created_at: "2026-09-01T09:00:00Z" };
    const hidden = visibleFeedSessions([mine, friend], "me", defaultFeedVisibility());
    assert.deepEqual(
      hidden.map((row) => row.id),
      ["s-fr"]
    );
    const shown = visibleFeedSessions([mine, friend], "me", { includeOwnSessions: true });
    assert.equal(shown.length, 2);
    assert.equal(shown.some((row) => row.id === "s-me"), true);
  });
});
