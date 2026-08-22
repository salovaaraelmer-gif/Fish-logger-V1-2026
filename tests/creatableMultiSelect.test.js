/**
 * Unit tests for catalog multi-select filtering (no Add-button path).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canCreateCatalogItem,
  catalogItemMatchesQuery,
  filterUnselectedCatalogItems,
  shouldShowCatalogCreateRow,
  unselectedCatalogItems,
} from "../js/catalogSelectFilter.js";

const pike = { id: "a", name: "Pike", userNumber: 1 };
const perch = { id: "b", name: "Perch", userNumber: 2 };
const gulf = { id: "c", name: "Gulf of Finland", userNumber: 3 };
const items = [pike, perch, gulf];

describe("catalogItemMatchesQuery", () => {
  it("matches empty query", () => {
    assert.equal(catalogItemMatchesQuery(pike, ""), true);
    assert.equal(catalogItemMatchesQuery(pike, "  "), true);
  });

  it("matches name case-insensitively", () => {
    assert.equal(catalogItemMatchesQuery(gulf, "gulf"), true);
    assert.equal(catalogItemMatchesQuery(gulf, "FINLAND"), true);
    assert.equal(catalogItemMatchesQuery(gulf, "pike"), false);
  });

  it("matches user number", () => {
    assert.equal(catalogItemMatchesQuery(perch, "2"), true);
    assert.equal(catalogItemMatchesQuery(perch, "1"), false);
  });
});

describe("unselectedCatalogItems", () => {
  it("drops already selected ids", () => {
    const left = unselectedCatalogItems(items, ["a", "c"]);
    assert.deepEqual(
      left.map((i) => i.id),
      ["b"]
    );
  });

  it("accepts a Set", () => {
    const left = unselectedCatalogItems(items, new Set(["b"]));
    assert.deepEqual(
      left.map((i) => i.id),
      ["a", "c"]
    );
  });
});

describe("filterUnselectedCatalogItems", () => {
  it("filters remaining items by search text", () => {
    const left = filterUnselectedCatalogItems(items, ["a"], "fin");
    assert.deepEqual(
      left.map((i) => i.id),
      ["c"]
    );
  });

  it("returns all unselected items when query is empty", () => {
    const left = filterUnselectedCatalogItems(items, [], "");
    assert.equal(left.length, 3);
  });
});

describe("canCreateCatalogItem", () => {
  it("keeps fishing-spot create on when target-species create is off", () => {
    assert.equal(canCreateCatalogItem("location"), true);
    assert.equal(canCreateCatalogItem("target"), false);
    assert.equal(canCreateCatalogItem("location", { allowTargetCreate: false }), true);
    assert.equal(canCreateCatalogItem("target", { allowLocationCreate: true }), false);
  });
});

describe("shouldShowCatalogCreateRow", () => {
  it("shows create for searchable fishing spots", () => {
    assert.equal(shouldShowCatalogCreateRow({ allowCreate: true, disabled: false }), true);
    assert.equal(shouldShowCatalogCreateRow({ allowCreate: false, disabled: false }), false);
    assert.equal(shouldShowCatalogCreateRow({ allowCreate: true, disabled: true }), false);
  });
});
