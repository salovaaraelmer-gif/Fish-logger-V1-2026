/**
 * Invite account setup: validation, username rules, and the Auth → profile save order.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INVITE_STEP_ACCOUNT,
  INVITE_STEP_PROFILE,
  USERNAME_TAKEN_MESSAGE,
  passwordValidationError,
  runInviteSetup,
  validateInviteSetup,
} from "../js/inviteSetup.js";
import { normalizeUsername, usernameValidationError } from "../js/usernameRules.js";

const VALID = {
  firstName: "  Elmer ",
  lastName: " Salovaara  ",
  username: "  Elmer_S ",
  password: "secret1",
  confirm: "secret1",
};

describe("validateInviteSetup", () => {
  it("requires first name, last name and username", () => {
    assert.deepEqual(validateInviteSetup({ ...VALID, firstName: "   " }, INVITE_STEP_ACCOUNT), {
      ok: false,
      error: "Enter your first name.",
      field: "first",
    });
    assert.equal(validateInviteSetup({ ...VALID, lastName: "" }, INVITE_STEP_ACCOUNT).field, "last");
    const u = validateInviteSetup({ ...VALID, username: "  " }, INVITE_STEP_ACCOUNT);
    assert.equal(u.ok, false);
    assert.equal(u.field, "username");
    assert.equal(u.error, "Enter a username.");
  });

  it("enforces the existing password rules", () => {
    const short = validateInviteSetup({ ...VALID, password: "abc", confirm: "abc" }, INVITE_STEP_ACCOUNT);
    assert.equal(short.ok, false);
    assert.equal(short.error, "Password must be at least 6 characters.");
    const mismatch = validateInviteSetup({ ...VALID, confirm: "secret2" }, INVITE_STEP_ACCOUNT);
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.error, "Passwords do not match.");
  });

  it("trims values, lowercases the username and builds full_name", () => {
    const r = validateInviteSetup(VALID, INVITE_STEP_ACCOUNT);
    assert.equal(r.ok, true);
    assert.deepEqual(r.values, {
      firstName: "Elmer",
      lastName: "Salovaara",
      fullName: "Elmer Salovaara",
      username: "elmer_s",
      password: "secret1",
    });
  });

  it("profile step does not require or return a password", () => {
    const r = validateInviteSetup({ ...VALID, password: "", confirm: "" }, INVITE_STEP_PROFILE);
    assert.equal(r.ok, true);
    assert.equal(r.values.password, null);
  });
});

describe("username rules", () => {
  it("normalizeUsername matches the former sign-up / upsertProfileForUser rules", () => {
    assert.equal(normalizeUsername("  Elmer__S!_ "), "elmer_s");
    assert.equal(normalizeUsername("_a"), "a");
    assert.equal(normalizeUsername(undefined), "");
  });

  it("rejects characters that normalization would drop instead of silently changing them", () => {
    assert.match(usernameValidationError("elmer s") || "", /letters, numbers/);
    assert.match(usernameValidationError("elmer!") || "", /letters, numbers/);
    assert.match(usernameValidationError("_elmer") || "", /letters, numbers/);
    assert.match(usernameValidationError("el__mer") || "", /letters, numbers/);
  });

  it("enforces length and accepts valid names", () => {
    assert.match(usernameValidationError("e") || "", /at least 2/);
    assert.match(usernameValidationError("a".repeat(31)) || "", /at most 30/);
    assert.equal(usernameValidationError("Elmer_99"), null);
  });
});

describe("passwordValidationError", () => {
  it("uses the recovery messages", () => {
    assert.equal(passwordValidationError("12345", "12345"), "Password must be at least 6 characters.");
    assert.equal(passwordValidationError("123456", "1234567"), "Passwords do not match.");
    assert.equal(passwordValidationError("123456", "123456"), null);
  });
});

/**
 * @param {{ taken?: boolean, authError?: string, profile?: ({ ok: true } | { ok: false, usernameTaken: boolean, error: string })[] }} cfg
 */
function fakeDeps(cfg = {}) {
  const calls = { taken: [], auth: [], profile: [] };
  const profileResults = [...(cfg.profile || [{ ok: true }])];
  return {
    calls,
    deps: {
      isUsernameTaken: async (u) => {
        calls.taken.push(u);
        return { taken: Boolean(cfg.taken), error: null };
      },
      updateAuthUser: async (values) => {
        calls.auth.push(values);
        return { error: cfg.authError ? { message: cfg.authError } : null };
      },
      saveProfile: async (username, displayName) => {
        calls.profile.push({ username, displayName });
        return profileResults.shift() || { ok: true };
      },
    },
  };
}

const values = /** @type {any} */ (validateInviteSetup(VALID, INVITE_STEP_ACCOUNT)).values;

describe("runInviteSetup", () => {
  it("valid setup saves Auth then the profile with the entered username and full name", async () => {
    const { deps, calls } = fakeDeps();
    assert.deepEqual(await runInviteSetup(values, INVITE_STEP_ACCOUNT, deps), { ok: true });
    assert.deepEqual(calls.taken, ["elmer_s"]);
    assert.equal(calls.auth.length, 1);
    assert.equal(calls.auth[0].password, "secret1");
    assert.deepEqual(calls.profile, [{ username: "elmer_s", displayName: "Elmer Salovaara" }]);
  });

  it("taken username (pre-check) stops before any Auth change", async () => {
    const { deps, calls } = fakeDeps({ taken: true });
    const r = await runInviteSetup(values, INVITE_STEP_ACCOUNT, deps);
    assert.deepEqual(r, { ok: false, error: USERNAME_TAKEN_MESSAGE, step: INVITE_STEP_ACCOUNT, field: "username" });
    assert.equal(calls.auth.length, 0);
    assert.equal(calls.profile.length, 0);
  });

  it("Auth failure keeps the account step and never writes the profile", async () => {
    const { deps, calls } = fakeDeps({ authError: "Network down" });
    const r = await runInviteSetup(values, INVITE_STEP_ACCOUNT, deps);
    assert.deepEqual(r, { ok: false, error: "Network down", step: INVITE_STEP_ACCOUNT });
    assert.equal(calls.profile.length, 0);
  });

  it("unique-constraint race after Auth success: username-taken error, profile step, no rename", async () => {
    const { deps, calls } = fakeDeps({
      profile: [{ ok: false, usernameTaken: true, error: "duplicate key value violates unique constraint" }],
    });
    const r = await runInviteSetup(values, INVITE_STEP_ACCOUNT, deps);
    assert.deepEqual(r, { ok: false, error: USERNAME_TAKEN_MESSAGE, step: INVITE_STEP_PROFILE, field: "username" });
    assert.deepEqual(calls.profile, [{ username: "elmer_s", displayName: "Elmer Salovaara" }]);
  });

  it("other profile failure after Auth success moves to the profile step for retry", async () => {
    const { deps } = fakeDeps({ profile: [{ ok: false, usernameTaken: false, error: "timeout" }] });
    const r = await runInviteSetup(values, INVITE_STEP_ACCOUNT, deps);
    assert.equal(r.ok, false);
    assert.equal(r.step, INVITE_STEP_PROFILE);
    assert.match(r.error, /password is saved.*timeout/);
  });

  it("profile-step retry sends no password and succeeds", async () => {
    const profileValues = /** @type {any} */ (
      validateInviteSetup({ ...VALID, username: "elmer_2", password: "", confirm: "" }, INVITE_STEP_PROFILE)
    ).values;
    const { deps, calls } = fakeDeps();
    assert.deepEqual(await runInviteSetup(profileValues, INVITE_STEP_PROFILE, deps), { ok: true });
    assert.equal(calls.auth[0].password, null);
    assert.deepEqual(calls.profile, [{ username: "elmer_2", displayName: "Elmer Salovaara" }]);
  });
});
