import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATCH_LOCATION_FRIENDS,
  CATCH_LOCATION_ONLY_ME,
  friendMaySeeCatchCoordinates,
  normalizeCatchLocationPrivacy,
} from "../js/catchLocationPrivacy.js";

describe("catchLocationPrivacy", () => {
  it("defaults unknown values to only me", () => {
    assert.equal(normalizeCatchLocationPrivacy(null), CATCH_LOCATION_ONLY_ME);
    assert.equal(normalizeCatchLocationPrivacy("friends"), CATCH_LOCATION_FRIENDS);
  });

  it("hides coordinates from friends when the owner chose only me", () => {
    assert.equal(friendMaySeeCatchCoordinates("only_me", true, false), false);
    assert.equal(friendMaySeeCatchCoordinates("friends", true, false), true);
    assert.equal(friendMaySeeCatchCoordinates("friends", false, false), false);
    assert.equal(friendMaySeeCatchCoordinates("only_me", false, true), true);
  });
});
