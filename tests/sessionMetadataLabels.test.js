/**
 * Catalog label formatting for global locations vs numbered target species.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCatalogItemLabel } from "../js/catalogLabels.js";

describe("formatCatalogItemLabel", () => {
  it("shows only the name for global fishing locations", () => {
    assert.equal(formatCatalogItemLabel({ id: "1", name: "Inkoo" }), "Inkoo");
  });

  it("keeps the number prefix for target species", () => {
    assert.equal(
      formatCatalogItemLabel({ id: "1", name: "Pike", userNumber: 1 }),
      "1 — Pike"
    );
  });
});
