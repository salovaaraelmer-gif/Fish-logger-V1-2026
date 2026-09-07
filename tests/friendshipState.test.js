import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  acceptedFriendIds,
  formatFriendsCountLabel,
  incomingPendingRows,
  otherUserId,
  outgoingPendingRows,
  relationFromRow,
  rowForPair,
} from "../js/friendshipState.js";

const me = "user-a";
const other = "user-b";

describe("friendshipState", () => {
  it("resolves the other user on a pair", () => {
    assert.equal(otherUserId({ requester_id: me, addressee_id: other, status: "pending" }, me), other);
    assert.equal(otherUserId({ requester_id: me, addressee_id: other, status: "pending" }, other), me);
  });

  it("treats pending as outgoing or incoming", () => {
    const outgoing = { requester_id: me, addressee_id: other, status: "pending" };
    const incoming = { requester_id: other, addressee_id: me, status: "pending" };
    assert.equal(relationFromRow(outgoing, me), "outgoing");
    assert.equal(relationFromRow(incoming, me), "incoming");
    assert.equal(relationFromRow({ ...outgoing, status: "accepted" }, me), "friends");
    assert.equal(relationFromRow({ ...outgoing, status: "declined" }, me), "none");
    assert.equal(relationFromRow(null, me), "none");
  });

  it("finds the pair row and accepted friend ids", () => {
    const rows = [
      { requester_id: me, addressee_id: other, status: "accepted" },
      { requester_id: "user-c", addressee_id: me, status: "pending" },
    ];
    assert.equal(rowForPair(rows, me, other)?.addressee_id, other);
    assert.deepEqual(acceptedFriendIds(rows, me), [other]);
    assert.equal(incomingPendingRows(rows, me).length, 1);
    assert.deepEqual(outgoingPendingRows(rows, me), []);
    const sent = [{ requester_id: me, addressee_id: other, status: "pending" }];
    assert.equal(outgoingPendingRows(sent, me).length, 1);
  });

  it("formats the profile friends label", () => {
    assert.equal(formatFriendsCountLabel(0), "0 Friends");
    assert.equal(formatFriendsCountLabel(1), "1 Friend");
    assert.equal(formatFriendsCountLabel(24), "24 Friends");
  });
});
