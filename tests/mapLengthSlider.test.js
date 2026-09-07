import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { valueFromRailRatio } from "../js/mapLengthSlider.js";

describe("mapLengthSlider", () => {
  it("maps rail ratio to 10 cm steps", () => {
    assert.equal(valueFromRailRatio(0, 0, 130, 10), 0);
    assert.equal(valueFromRailRatio(1, 0, 130, 10), 130);
    assert.equal(valueFromRailRatio(0.5, 0, 130, 10), 70);
    assert.equal(valueFromRailRatio(0.3, 0, 130, 10), 40);
  });

  it("clamps and ignores invalid ratios", () => {
    assert.equal(valueFromRailRatio(-0.2, 0, 130, 10), 0);
    assert.equal(valueFromRailRatio(2, 0, 130, 10), 130);
    assert.equal(valueFromRailRatio(Number.NaN, 0, 130, 10), 0);
  });
});
