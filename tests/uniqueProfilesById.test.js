import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uniqueProfilesById } from "../js/uniqueProfilesById.js";

describe("uniqueProfilesById", () => {
  it("keeps a user once when username and display name both match", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const byUsername = { id, username: "pikejoe", display_name: "Joe Pike" };
    const byName = { id, username: "pikejoe", display_name: "Joe Pike" };
    const out = uniqueProfilesById([byUsername, byName]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, id);
  });

  it("does not merge different users who share a display name", () => {
    const out = uniqueProfilesById([
      { id: "a", display_name: "Alex" },
      { id: "b", display_name: "Alex" },
    ]);
    assert.deepEqual(
      out.map((row) => row.id),
      ["a", "b"]
    );
  });

  it("skips rows without an id", () => {
    const out = uniqueProfilesById([
      { id: "a", username: "a" },
      { display_name: "No id" },
      null,
    ]);
    assert.deepEqual(
      out.map((row) => row.id),
      ["a"]
    );
  });
});
