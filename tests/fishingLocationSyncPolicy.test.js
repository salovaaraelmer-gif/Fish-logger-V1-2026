/**
 * Cloud-authoritative global fishing-location sync policy.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fishingLocationNamesMatch,
  localFishingLocationIdsToRemove,
  normalizeFishingLocationName,
  shouldUploadLocalSessionLinksForEmptyCloud,
} from "../js/fishingLocationSyncPolicy.js";

describe("normalizeFishingLocationName", () => {
  it("trims leading and trailing whitespace", () => {
    assert.equal(normalizeFishingLocationName("  Inkoo  "), "Inkoo");
  });
});

describe("fishingLocationNamesMatch", () => {
  it("treats trimmed case variants as the same location", () => {
    assert.equal(fishingLocationNamesMatch("Inkoo", "inkoo"), true);
    assert.equal(fishingLocationNamesMatch(" INKOO ", " Inkoo "), true);
    assert.equal(fishingLocationNamesMatch("Inkoo", "Espoo"), false);
  });
});

describe("localFishingLocationIdsToRemove", () => {
  it("keeps local rows that still exist in cloud", () => {
    const local = [
      { id: "l1", supabaseId: "c1" },
      { id: "l2", supabaseId: "c2" },
    ];
    assert.deepEqual(localFishingLocationIdsToRemove(local, ["c1", "c2"]), []);
  });

  it("removes stale cloud-linked rows missing from a successful cloud fetch", () => {
    const local = [
      { id: "l1", supabaseId: "c1" },
      { id: "l-stale", supabaseId: "deleted-cloud-id" },
    ];
    assert.deepEqual(localFishingLocationIdsToRemove(local, ["c1"]), ["l-stale"]);
  });

  it("clears all local rows when the global cloud catalog is empty", () => {
    const local = [
      { id: "l1", supabaseId: "c1" },
      { id: "l2", supabaseId: null },
    ];
    assert.deepEqual(localFishingLocationIdsToRemove(local, []), ["l1", "l2"]);
  });

  it("removes local-only rows after a successful cloud catalog load", () => {
    const local = [
      { id: "local-only", supabaseId: null },
      { id: "keep", supabaseId: "c1" },
    ];
    assert.deepEqual(localFishingLocationIdsToRemove(local, ["c1"]), ["local-only"]);
  });
});

describe("shouldUploadLocalSessionLinksForEmptyCloud", () => {
  it("never auto-pushes local session links when cloud returned zero rows", () => {
    assert.equal(shouldUploadLocalSessionLinksForEmptyCloud(), false);
  });
});
