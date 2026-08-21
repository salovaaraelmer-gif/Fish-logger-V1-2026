/**
 * Unit tests for session species dashboard stats.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  catalogNameToSpeciesKey,
  colorForAnglerIndex,
  defaultSelectedSpecies,
  listDashboardSpecies,
  rankAnglersForDashboard,
  statsForAnglerSpecies,
} from "../js/speciesDashboardStats.js";

describe("catalogNameToSpeciesKey", () => {
  it("maps catalog display names to catch keys", () => {
    assert.equal(catalogNameToSpeciesKey("Pike"), "pike");
    assert.equal(catalogNameToSpeciesKey("ZANDER"), "zander");
    assert.equal(catalogNameToSpeciesKey("salmon"), "salmon");
  });

  it("returns null for unmapped custom names", () => {
    assert.equal(catalogNameToSpeciesKey("Sea trout"), null);
    assert.equal(catalogNameToSpeciesKey(""), null);
  });
});

describe("listDashboardSpecies", () => {
  it("puts target species first, then other caught species", () => {
    const list = listDashboardSpecies(["pike"], [
      { species: "zander" },
      { species: "perch" },
      { species: "pike" },
    ]);
    assert.deepEqual(list, ["pike", "perch", "zander"]);
  });

  it("keeps extra target species after the primary", () => {
    const list = listDashboardSpecies(["pike", "trout"], [{ species: "perch" }]);
    assert.deepEqual(list, ["pike", "trout", "perch"]);
  });

  it("does not invent species with no target and no catches", () => {
    assert.deepEqual(listDashboardSpecies([], []), []);
  });
});

describe("defaultSelectedSpecies", () => {
  it("defaults to the primary target", () => {
    assert.equal(defaultSelectedSpecies(["pike", "perch"], ["pike", "perch", "zander"]), "pike");
  });

  it("falls back to the first listed species", () => {
    assert.equal(defaultSelectedSpecies([], ["perch", "zander"]), "perch");
  });
});

describe("statsForAnglerSpecies", () => {
  const catches = [
    { anglerId: "a", species: "pike", length: 112 },
    { anglerId: "a", species: "pike", length: 87 },
    { anglerId: "a", species: "pike", length: 106 },
    { anglerId: "a", species: "pike", length: 98 },
    { anglerId: "a", species: "pike", length: 94 },
    { anglerId: "a", species: "pike", length: 80 },
    { anglerId: "a", species: "pike", length: null },
    { anglerId: "a", species: "perch", length: 30 },
    { anglerId: "b", species: "pike", length: 70 },
  ];

  it("counts all catches of that species including unmeasured", () => {
    assert.equal(statsForAnglerSpecies(catches, "a", "pike").catchCount, 7);
  });

  it("uses the five longest measured lengths and their total", () => {
    const s = statsForAnglerSpecies(catches, "a", "pike");
    assert.deepEqual(s.top5Lengths, [112, 106, 98, 94, 87]);
    assert.equal(s.top5Total, 497);
  });

  it("omits missing lengths instead of padding", () => {
    const s = statsForAnglerSpecies(catches, "b", "pike");
    assert.deepEqual(s.top5Lengths, [70]);
    assert.equal(s.top5Total, 70);
  });
});

describe("colorForAnglerIndex", () => {
  it("keeps first three as blue, green, yellow", () => {
    assert.equal(colorForAnglerIndex(0), "#58a6ff");
    assert.equal(colorForAnglerIndex(1), "#3fb950");
    assert.equal(colorForAnglerIndex(2), "#d29922");
  });
});

describe("rankAnglersForDashboard", () => {
  const rows = [
    { id: "first", rosterIndex: 0, stats: { catchCount: 3, top5Total: 200 } },
    { id: "second", rosterIndex: 1, stats: { catchCount: 5, top5Total: 120 } },
    { id: "third", rosterIndex: 2, stats: { catchCount: 5, top5Total: 400 } },
  ];

  it("puts the catch-count leader first", () => {
    assert.deepEqual(
      rankAnglersForDashboard(rows, "catches").map((r) => r.id),
      ["second", "third", "first"]
    );
  });

  it("puts the Top 5 total leader first", () => {
    assert.deepEqual(
      rankAnglersForDashboard(rows, "top5").map((r) => r.id),
      ["third", "first", "second"]
    );
  });
});
