/**
 * Pathname routing helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalizeAppPath,
  parseAppPath,
  pathForAppTab,
  pathForSessionDetail,
  serializeAppRoute,
  tabIdForRoute,
} from "../js/appRoutes.js";

describe("parseAppPath", () => {
  it("treats / and /session as session home", () => {
    assert.deepEqual(parseAppPath("/"), { name: "session" });
    assert.deepEqual(parseAppPath("/session"), { name: "session" });
    assert.deepEqual(parseAppPath("/index.html"), { name: "session" });
  });

  it("parses main tabs and stats", () => {
    assert.deepEqual(parseAppPath("/feed"), { name: "feed" });
    assert.deepEqual(parseAppPath("/map"), { name: "map" });
    assert.deepEqual(parseAppPath("/profile"), { name: "profile" });
    assert.deepEqual(parseAppPath("/stats"), { name: "stats" });
  });

  it("parses a session detail id", () => {
    const id = "8f0c1a2b-3c4d-5e6f-8a9b-0c1d2e3f4a5b";
    assert.deepEqual(parseAppPath(`/session/${id}`), {
      name: "sessionDetail",
      sessionId: id,
    });
  });

  it("marks unknown paths", () => {
    assert.deepEqual(parseAppPath("/not-a-view"), { name: "unknown" });
    assert.deepEqual(parseAppPath("/session/a/b"), { name: "unknown" });
  });
});

describe("serializeAppRoute", () => {
  it("uses / for session home", () => {
    assert.equal(serializeAppRoute({ name: "session" }), "/");
    assert.equal(serializeAppRoute({ name: "unknown" }), "/");
  });

  it("round-trips tab and stats routes", () => {
    for (const path of ["/feed", "/map", "/profile", "/stats"]) {
      assert.equal(serializeAppRoute(parseAppPath(path)), path);
    }
  });

  it("encodes session ids", () => {
    assert.equal(pathForSessionDetail("id-1"), "/session/id-1");
    const parsed = parseAppPath(pathForSessionDetail("id-1"));
    assert.equal(parsed.name, "sessionDetail");
    if (parsed.name === "sessionDetail") assert.equal(parsed.sessionId, "id-1");
  });
});

describe("canonicalizeAppPath", () => {
  it("rewrites /session and unknown paths to /", () => {
    assert.deepEqual(canonicalizeAppPath("/session"), {
      route: { name: "session" },
      path: "/",
      needsReplace: true,
    });
    assert.equal(canonicalizeAppPath("/nope").needsReplace, true);
    assert.equal(canonicalizeAppPath("/").needsReplace, false);
  });
});

describe("tab helpers", () => {
  it("maps tabs to paths", () => {
    assert.equal(pathForAppTab("session"), "/");
    assert.equal(pathForAppTab("feed"), "/feed");
    assert.equal(pathForAppTab("profile"), "/profile");
  });

  it("picks the bottom-nav tab from the route", () => {
    assert.equal(tabIdForRoute({ name: "stats" }), "profile");
    assert.equal(tabIdForRoute({ name: "sessionDetail", sessionId: "x" }), "session");
    assert.equal(tabIdForRoute({ name: "feed" }), "feed");
  });
});
