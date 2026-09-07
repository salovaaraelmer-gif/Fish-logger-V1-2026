import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMapCatchFilters,
  catchHasValidGps,
  catchMatchesLengthRange,
  defaultMapCatchFilters,
  formatLengthRangeLabel,
  isAllSpeciesFilter,
  MAP_LENGTH_MAX_CM,
  MAP_LENGTH_MIN_CM,
  normalizeLengthRange,
  snapLengthCm,
  toggleMapSpecies,
} from "../js/mapCatchFilters.js";

function catchRow(partial) {
  return {
    species: "pike",
    length: 50,
    timestamp: Date.parse("2026-06-01T12:00:00"),
    location_lat: 60.1,
    location_lng: 24.9,
    ...partial,
  };
}

describe("mapCatchFilters", () => {
  it("drops catches without finite GPS", () => {
    assert.equal(catchHasValidGps(catchRow({ location_lat: null })), false);
    assert.equal(catchHasValidGps(catchRow()), true);
    assert.equal(applyMapCatchFilters([catchRow({ location_lng: Infinity })], defaultMapCatchFilters()).length, 0);
  });

  it("treats empty species as all species", () => {
    const rows = [catchRow({ species: "pike" }), catchRow({ species: "perch" })];
    assert.equal(applyMapCatchFilters(rows, defaultMapCatchFilters()).length, 2);
    assert.equal(isAllSpeciesFilter([]), true);
    assert.equal(isAllSpeciesFilter("all"), true);
  });

  it("matches any of several selected species", () => {
    const rows = [
      catchRow({ species: "pike" }),
      catchRow({ species: "perch" }),
      catchRow({ species: "zander" }),
    ];
    const filtered = applyMapCatchFilters(rows, {
      ...defaultMapCatchFilters(),
      species: ["pike", "zander"],
    });
    assert.deepEqual(
      filtered.map((row) => row.species),
      ["pike", "zander"]
    );
  });

  it("toggles species without allowing an empty match-nothing state", () => {
    assert.deepEqual(toggleMapSpecies([], "all"), []);
    assert.deepEqual(toggleMapSpecies([], "pike"), ["pike"]);
    assert.deepEqual(toggleMapSpecies(["pike"], "perch"), ["pike", "perch"]);
    assert.deepEqual(toggleMapSpecies(["pike", "perch"], "pike"), ["perch"]);
    assert.deepEqual(toggleMapSpecies(["perch"], "perch"), []);
    assert.deepEqual(toggleMapSpecies(["pike"], "all"), []);
  });

  it("keeps missing lengths when the length range is unrestricted", () => {
    assert.equal(catchMatchesLengthRange(null, 0, 130), true);
    assert.equal(catchMatchesLengthRange(undefined, MAP_LENGTH_MIN_CM, MAP_LENGTH_MAX_CM), true);
    const rows = [catchRow({ length: null }), catchRow({ length: 80 })];
    assert.equal(applyMapCatchFilters(rows, defaultMapCatchFilters()).length, 2);
  });

  it("hides catches outside the length range and missing lengths when narrowed", () => {
    const rows = [
      catchRow({ length: 25 }),
      catchRow({ length: 40 }),
      catchRow({ length: 90 }),
      catchRow({ length: null }),
    ];
    const filtered = applyMapCatchFilters(rows, {
      ...defaultMapCatchFilters(),
      minLengthCm: 30,
      maxLengthCm: 50,
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].length, 40);
  });

  it("formats and snaps the length range to 10 cm steps", () => {
    assert.equal(snapLengthCm(39), 40);
    assert.equal(snapLengthCm(4), 0);
    assert.equal(snapLengthCm(65), 70);
    assert.equal(formatLengthRangeLabel(30, 65), "30–70 cm");
    assert.deepEqual(normalizeLengthRange(-4, 400), { minLengthCm: 0, maxLengthCm: 130 });
    assert.deepEqual(normalizeLengthRange(80, 40), { minLengthCm: 40, maxLengthCm: 80 });
    assert.deepEqual(normalizeLengthRange(33, 58), { minLengthCm: 30, maxLengthCm: 60 });
  });

  it("applies species, length range, and year together", () => {
    const rows = [
      catchRow({ species: "pike", length: 70, timestamp: Date.parse("2026-03-01") }),
      catchRow({ species: "perch", length: 70, timestamp: Date.parse("2026-03-01") }),
      catchRow({ species: "pike", length: 30, timestamp: Date.parse("2026-03-01") }),
      catchRow({ species: "pike", length: 70, timestamp: Date.parse("2025-03-01") }),
      catchRow({ species: "zander", length: 70, timestamp: Date.parse("2026-03-01") }),
    ];
    const filtered = applyMapCatchFilters(rows, {
      ...defaultMapCatchFilters(),
      species: ["pike", "zander"],
      minLengthCm: 60,
      maxLengthCm: 130,
      dateMode: "year",
      year: 2026,
    });
    assert.equal(filtered.length, 2);
    assert.deepEqual(
      filtered.map((row) => row.species),
      ["pike", "zander"]
    );
  });

  it("applies a custom date range", () => {
    const rows = [
      catchRow({ timestamp: Date.parse("2026-01-10") }),
      catchRow({ timestamp: Date.parse("2026-06-10") }),
      catchRow({ timestamp: Date.parse("2026-12-10") }),
    ];
    const filtered = applyMapCatchFilters(rows, {
      ...defaultMapCatchFilters(),
      dateMode: "custom",
      fromMs: Date.parse("2026-03-01"),
      toMs: Date.parse("2026-09-01"),
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].timestamp, Date.parse("2026-06-10"));
  });
});
