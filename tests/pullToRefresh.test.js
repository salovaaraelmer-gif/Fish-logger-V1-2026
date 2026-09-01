/**
 * Pull-to-refresh gating (top-of-page, no form/keyboard, no Map).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PTR_THRESHOLD_PX,
  canBeginPull,
  isTypingTarget,
  pullPassesThreshold,
} from "../js/pullToRefresh.js";

describe("canBeginPull", () => {
  it("allows a downward pull only at the top of the scroller", () => {
    assert.equal(canBeginPull({ scrollTop: 0 }), true);
    assert.equal(canBeginPull({ scrollTop: 12 }), false);
  });

  it("does not start while a form field is focused or the keyboard is open", () => {
    assert.equal(canBeginPull({ scrollTop: 0, formFocused: true }), false);
    assert.equal(canBeginPull({ scrollTop: 0, keyboardOpen: true }), false);
  });

  it("can be disabled for Map and other blocked views", () => {
    assert.equal(canBeginPull({ scrollTop: 0, enabled: false }), false);
  });
});

describe("pullPassesThreshold", () => {
  it("requires a clear downward distance", () => {
    assert.equal(pullPassesThreshold(PTR_THRESHOLD_PX), true);
    assert.equal(pullPassesThreshold(PTR_THRESHOLD_PX - 1), false);
    assert.equal(pullPassesThreshold(8), false);
  });
});

describe("isTypingTarget", () => {
  it("treats text fields as typing targets", () => {
    assert.equal(isTypingTarget({ tagName: "INPUT", type: "text" }), true);
    assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
    assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
    assert.equal(isTypingTarget({ tagName: "INPUT", type: "button" }), false);
  });
});
