import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cloudSessionCreateUiError,
  normalizeParticipantIds,
  parseCreateFishingSessionResult,
} from "../js/sessionCloudParse.js";

describe("normalizeParticipantIds", () => {
  it("puts the owner first and drops duplicates", () => {
    const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    assert.deepEqual(normalizeParticipantIds(owner, [other, owner, other]), [owner, other]);
  });

  it("keeps additional participants when owner is omitted", () => {
    assert.deepEqual(normalizeParticipantIds(null, ["a", "b"]), ["a", "b"]);
  });
});

describe("parseCreateFishingSessionResult", () => {
  it("maps participant user ids to session-scoped anglers ids", () => {
    const parsed = parseCreateFishingSessionResult({
      session_id: "sess-1",
      participants: [
        { user_id: "u1", angler_id: "a1" },
        { user_id: "u2", angler_id: "a2" },
      ],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.sessionId, "sess-1");
    assert.equal(parsed.idByUserId.get("u1"), "a1");
    assert.equal(parsed.idByUserId.get("u2"), "a2");
  });

  it("rejects a session without participant mappings", () => {
    const parsed = parseCreateFishingSessionResult({ session_id: "sess-1", participants: [] });
    assert.equal(parsed.ok, false);
  });

  it("parses a JSON string payload", () => {
    const parsed = parseCreateFishingSessionResult(
      JSON.stringify({
        session_id: "sess-1",
        participants: [{ user_id: "u1", angler_id: "a1" }],
      })
    );
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.idByUserId.get("u1"), "a1");
  });
});

describe("cloudSessionCreateUiError", () => {
  it("does not put the raw RLS text in the UI", () => {
    const msg = cloudSessionCreateUiError('new row violates row-level security policy for table "anglers"');
    assert.match(msg, /could not start the session/i);
    assert.doesNotMatch(msg, /row-level security/i);
  });

  it("maps known RPC failures to distinct copy", () => {
    assert.match(cloudSessionCreateUiError("Each participant must have a profile"), /profile/i);
    assert.match(cloudSessionCreateUiError("Not authenticated"), /signed in/i);
  });
});
