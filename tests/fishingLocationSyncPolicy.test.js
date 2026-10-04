/**
 * Cloud-authoritative fishing-location sync policy.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  localFishingLocationIdsToRemove,
  shouldUploadLocalSessionLinksForEmptyCloud,
} from "../js/fishingLocationSyncPolicy.js";

describe("localFishingLocationIdsToRemove", () => {
  const uid = "user-a";

  it("keeps local rows that still exist in cloud", () => {
    const local = [
      { id: "l1", userId: uid, supabaseId: "c1" },
      { id: "l2", userId: uid, supabaseId: "c2" },
    ];
    assert.deepEqual(localFishingLocationIdsToRemove(local, ["c1", "c2"], uid), []);
  });

  it("removes stale cloud-linked rows missing from a successful cloud fetch", () => {
    const local = [
      { id: "l1", userId: uid, supabaseId: "c1" },
      { id: "l-stale", userId: uid, supabaseId: "deleted-cloud-id" },
    ];
    assert.deepEqual(localFishingLocationIdsToRemove(local, ["c1"], uid), ["l-stale"]);
  });

  it("clears all local rows for the user when cloud catalog is empty", () => {
    const local = [
      { id: "l1", userId: uid, supabaseId: "c1" },
      { id: "l2", userId: uid, supabaseId: null },
      { id: "other", userId: "user-b", supabaseId: "c9" },
    ];
    assert.deepEqual(localFishingLocationIdsToRemove(local, [], uid), ["l1", "l2"]);
  });

  it("removes local-only rows after a successful cloud catalog load", () => {
    const local = [
      { id: "local-only", userId: uid, supabaseId: null },
      { id: "keep", userId: uid, supabaseId: "c1" },
    ];
    assert.deepEqual(localFishingLocationIdsToRemove(local, ["c1"], uid), ["local-only"]);
  });

  it("does not remove rows belonging to another user", () => {
    const local = [{ id: "other", userId: "user-b", supabaseId: "c1" }];
    assert.deepEqual(localFishingLocationIdsToRemove(local, [], uid), []);
  });
});

describe("shouldUploadLocalSessionLinksForEmptyCloud", () => {
  it("never auto-pushes local session links when cloud returned zero rows", () => {
    assert.equal(shouldUploadLocalSessionLinksForEmptyCloud(), false);
  });
});
