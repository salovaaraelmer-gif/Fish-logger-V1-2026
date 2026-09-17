import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missingAnglersRowUiMessage } from "../js/sessionCloudParse.js";

describe("missingAnglersRowUiMessage", () => {
  it("does not include session or user identifiers", () => {
    const msg = missingAnglersRowUiMessage();
    assert.match(msg, /participant is not set up/i);
    assert.doesNotMatch(msg, /session_id/i);
    assert.doesNotMatch(msg, /user_id/i);
    assert.doesNotMatch(msg, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  });
});
