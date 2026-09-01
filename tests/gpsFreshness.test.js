/**
 * GPS freshness: reject cached or pre-flow coordinates.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GEO_WATCH_OPTIONS,
  GPS_MAX_AGE_MS,
  isBetterGpsFix,
  isFreshGpsFix,
} from "../js/gpsFreshness.js";

describe("GEO_WATCH_OPTIONS", () => {
  it("requests a fresh high-accuracy fix", () => {
    assert.equal(GEO_WATCH_OPTIONS.maximumAge, 0);
    assert.equal(GEO_WATCH_OPTIONS.enableHighAccuracy, true);
  });
});

describe("isFreshGpsFix", () => {
  const startedAt = 1_000_000;
  const now = startedAt + 5_000;
  const ok = {
    lat: 60.16,
    lng: 24.94,
    accuracyM: 8,
    timestamp: startedAt + 1_000,
  };

  it("accepts a fix from the current logging window", () => {
    assert.equal(isFreshGpsFix(ok, startedAt, now), true);
  });

  it("rejects an hour-old cached coordinate", () => {
    const stale = { ...ok, timestamp: startedAt - 60 * 60 * 1000 };
    assert.equal(isFreshGpsFix(stale, startedAt, now), false);
  });

  it("rejects a fix from before catch logging started", () => {
    const early = { ...ok, timestamp: startedAt - 10_000 };
    assert.equal(isFreshGpsFix(early, startedAt, now), false);
  });

  it("rejects a missing GPS timestamp", () => {
    assert.equal(isFreshGpsFix({ ...ok, timestamp: null }, startedAt, now), false);
  });

  it("rejects a fix older than the max age even if it started after the request", () => {
    const aged = { ...ok, timestamp: startedAt + 100 };
    assert.equal(isFreshGpsFix(aged, startedAt, startedAt + GPS_MAX_AGE_MS + 1_000), false);
  });
});

describe("isBetterGpsFix", () => {
  it("prefers a tighter accuracy", () => {
    const coarse = { lat: 1, lng: 2, accuracyM: 40, timestamp: 1 };
    const fine = { lat: 1, lng: 2, accuracyM: 9, timestamp: 2 };
    assert.equal(isBetterGpsFix(coarse, fine), true);
    assert.equal(isBetterGpsFix(fine, coarse), false);
  });

  it("takes the first fix when none exists yet", () => {
    assert.equal(isBetterGpsFix(null, { lat: 1, lng: 2, accuracyM: null, timestamp: 1 }), true);
  });
});
