import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { placeMapCallout } from "../js/mapCallout.js";

describe("placeMapCallout", () => {
  it("sits above the marker when there is room", () => {
    const pos = placeMapCallout({
      wrapW: 400,
      wrapH: 700,
      x: 200,
      y: 300,
      panelW: 180,
      panelH: 120,
      pad: 10,
      gap: 16,
    });
    assert.equal(pos.placement, "above");
    assert.equal(pos.left, 200 - 90);
    assert.equal(pos.top, 300 - 120 - 16);
    assert.equal(pos.caretX, 90);
  });

  it("flips below when the marker is near the top", () => {
    const pos = placeMapCallout({
      wrapW: 400,
      wrapH: 700,
      x: 200,
      y: 40,
      panelW: 180,
      panelH: 120,
    });
    assert.equal(pos.placement, "below");
    assert.ok(pos.top > 40);
  });

  it("keeps the bubble inside the wrap near an edge", () => {
    const pos = placeMapCallout({
      wrapW: 360,
      wrapH: 500,
      x: 20,
      y: 250,
      panelW: 200,
      panelH: 100,
      pad: 10,
    });
    assert.equal(pos.left, 10);
    assert.ok(pos.left + 200 <= 360 - 10);
    assert.ok(pos.caretX >= 14);
  });
});
