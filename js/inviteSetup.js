/**
 * Account setup for users invited from the Supabase Dashboard:
 * name + username (+ first password), then the matching `profiles` row.
 * @module inviteSetup
 */

import { normalizeUsername, usernameValidationError } from "./usernameRules.js";

/**
 * - "account": password not saved yet → names, username, password.
 * - "profile": password already saved (or set via recovery) but no profile yet → names, username.
 * @typedef {"account" | "profile"} InviteSetupStep
 */

export const INVITE_STEP_ACCOUNT = "account";
export const INVITE_STEP_PROFILE = "profile";

export const USERNAME_TAKEN_MESSAGE = "That username is already taken. Choose another one.";

/**
 * Same rules as password recovery.
 * @param {string} password
 * @param {string} confirm
 * @returns {string | null}
 */
export function passwordValidationError(password, confirm) {
  if ((password || "").length < 6) return "Password must be at least 6 characters.";
  if (password !== confirm) return "Passwords do not match.";
  return null;
}

/**
 * @typedef {{ firstName: string, lastName: string, fullName: string, username: string, password: string | null }} InviteSetupValues
 */

/**
 * @param {{ firstName?: string, lastName?: string, username?: string, password?: string, confirm?: string }} input
 * @param {InviteSetupStep} step
 * @returns {{ ok: true, values: InviteSetupValues } | { ok: false, error: string, field: string }}
 */
export function validateInviteSetup(input, step) {
  const firstName = (input.firstName || "").trim();
  const lastName = (input.lastName || "").trim();
  if (!firstName) return { ok: false, error: "Enter your first name.", field: "first" };
  if (!lastName) return { ok: false, error: "Enter your last name.", field: "last" };
  const usernameError = usernameValidationError(input.username);
  if (usernameError) return { ok: false, error: usernameError, field: "username" };
  let password = null;
  if (step === INVITE_STEP_ACCOUNT) {
    const pwError = passwordValidationError(input.password || "", input.confirm || "");
    if (pwError) return { ok: false, error: pwError, field: "password" };
    password = input.password || "";
  }
  return {
    ok: true,
    values: {
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
      username: normalizeUsername(input.username),
      password,
    },
  };
}

/**
 * @typedef {{
 *   isUsernameTaken: (username: string) => Promise<{ taken: boolean, error: string | null }>,
 *   updateAuthUser: (values: InviteSetupValues) => Promise<{ error: { message?: string } | null }>,
 *   saveProfile: (username: string, displayName: string) => Promise<{ ok: true } | { ok: false, usernameTaken: boolean, error: string }>,
 * }} InviteSetupDeps
 */

/**
 * Availability pre-check → Auth password/metadata → strict profile upsert.
 * The unique index decides races; the entered username is never replaced.
 * After the Auth update succeeds, any failure moves to the "profile" step so the password is not asked again.
 * @param {InviteSetupValues} values
 * @param {InviteSetupStep} step
 * @param {InviteSetupDeps} deps
 * @returns {Promise<{ ok: true } | { ok: false, error: string, step: InviteSetupStep, field?: string }>}
 */
export async function runInviteSetup(values, step, deps) {
  const pre = await deps.isUsernameTaken(values.username);
  if (pre.taken) {
    return { ok: false, error: USERNAME_TAKEN_MESSAGE, step, field: "username" };
  }
  const auth = await deps.updateAuthUser(values);
  if (auth.error) {
    return { ok: false, error: auth.error.message || "Could not save your account.", step };
  }
  const profile = await deps.saveProfile(values.username, values.fullName);
  if (!profile.ok) {
    if (profile.usernameTaken) {
      return { ok: false, error: USERNAME_TAKEN_MESSAGE, step: INVITE_STEP_PROFILE, field: "username" };
    }
    return {
      ok: false,
      error: `Your password is saved, but your profile could not be created (${profile.error}). Try again.`,
      step: INVITE_STEP_PROFILE,
    };
  }
  return { ok: true };
}
