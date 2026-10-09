/**
 * Invite vs recovery password-step detection.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INVITE_PASSWORD_SET_KEY,
  isInvitedUser,
  mergePasswordFlow,
  passwordFlowFromCallbackUrl,
  passwordPanelCopy,
  userNeedsInvitePassword,
} from "../js/authPasswordFlow.js";

const IMPLICIT_HASH =
  "#access_token=aaa.bbb.ccc&expires_at=1800000000&expires_in=3600&refresh_token=rrr&token_type=bearer";

describe("passwordFlowFromCallbackUrl", () => {
  it("detects Supabase invite callback hash", () => {
    assert.equal(passwordFlowFromCallbackUrl(`${IMPLICIT_HASH}&type=invite`, ""), "invite");
  });

  it("detects recovery callback hash", () => {
    assert.equal(passwordFlowFromCallbackUrl(`${IMPLICIT_HASH}&type=recovery`, ""), "recovery");
  });

  it("detects URL-encoded type in query", () => {
    assert.equal(passwordFlowFromCallbackUrl("", "?redirect=%2F%3Ftype%3Drecovery"), "recovery");
    assert.equal(passwordFlowFromCallbackUrl("", "?next=type%3Dinvite"), "invite");
  });

  it("ignores signup confirmation, magic link, errors and plain URLs", () => {
    assert.equal(passwordFlowFromCallbackUrl(`${IMPLICIT_HASH}&type=signup`, ""), null);
    assert.equal(passwordFlowFromCallbackUrl(`${IMPLICIT_HASH}&type=magiclink`, ""), null);
    assert.equal(
      passwordFlowFromCallbackUrl("#error=access_denied&error_code=otp_expired&error_description=x", ""),
      null
    );
    assert.equal(passwordFlowFromCallbackUrl("", ""), null);
    assert.equal(passwordFlowFromCallbackUrl("", "?tab=feed"), null);
  });
});

describe("userNeedsInvitePassword", () => {
  it("is false for self-signup users (no invited_at)", () => {
    assert.equal(
      userNeedsInvitePassword({ invited_at: null, user_metadata: { full_name: "A B" } }),
      false
    );
    assert.equal(userNeedsInvitePassword({ user_metadata: {} }), false);
    assert.equal(userNeedsInvitePassword(null), false);
  });

  it("is true for invited users until the password step is recorded", () => {
    const invited = { invited_at: "2026-10-09T08:00:00Z", user_metadata: { email: "x@y.z" } };
    assert.equal(userNeedsInvitePassword(invited), true);
    assert.equal(
      userNeedsInvitePassword({ ...invited, user_metadata: { [INVITE_PASSWORD_SET_KEY]: true } }),
      false
    );
    assert.equal(
      userNeedsInvitePassword({ ...invited, user_metadata: { [INVITE_PASSWORD_SET_KEY]: "true" } }),
      true
    );
  });
});

describe("mergePasswordFlow", () => {
  it("keeps recovery over invite in either order", () => {
    assert.equal(mergePasswordFlow("recovery", "invite"), "recovery");
    assert.equal(mergePasswordFlow("invite", "recovery"), "recovery");
  });

  it("does not clear a pending flow with a null signal", () => {
    assert.equal(mergePasswordFlow("invite", null), "invite");
    assert.equal(mergePasswordFlow("recovery", null), "recovery");
    assert.equal(mergePasswordFlow(null, null), null);
    assert.equal(mergePasswordFlow(null, "invite"), "invite");
  });
});

describe("passwordPanelCopy", () => {
  it("invite account step shows profile + password fields, without reset wording", () => {
    const c = passwordPanelCopy("invite", "account");
    assert.equal(c.title, "Set up your account");
    assert.equal(c.text, "Create your profile and password to finish setting up your account.");
    assert.equal(c.button, "Finish setup");
    assert.equal(c.passwordLabel, "Password");
    assert.equal(c.showInviteFields, true);
    assert.equal(c.showPasswordFields, true);
    assert.doesNotMatch(`${c.title} ${c.text} ${c.button}`, /reset/i);
  });

  it("invite profile step hides password fields (password already saved)", () => {
    const c = passwordPanelCopy("invite", "profile");
    assert.equal(c.title, "Set up your account");
    assert.equal(c.text, "Create your profile to finish setting up your account.");
    assert.equal(c.button, "Finish setup");
    assert.equal(c.showInviteFields, true);
    assert.equal(c.showPasswordFields, false);
  });

  it("keeps the existing recovery wording and hides profile fields", () => {
    assert.deepEqual(passwordPanelCopy("recovery"), {
      title: "New password",
      text: "Enter a new password for your account.",
      button: "Save password",
      passwordLabel: "New password",
      showInviteFields: false,
      showPasswordFields: true,
    });
  });
});

describe("isInvitedUser", () => {
  it("only matches users with invited_at", () => {
    assert.equal(isInvitedUser({ invited_at: "2026-10-09T08:00:00Z" }), true);
    assert.equal(isInvitedUser({ invited_at: null }), false);
    assert.equal(isInvitedUser(null), false);
  });
});
