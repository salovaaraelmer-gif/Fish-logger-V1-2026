/**
 * Password steps that must finish before the normal app activates:
 * - "recovery": user opened a password reset link.
 * - "invite": user was invited from the Supabase Dashboard and has not set a password yet.
 * @module authPasswordFlow
 */

/** @typedef {"recovery" | "invite"} PasswordFlow */

export const PASSWORD_FLOW_RECOVERY = "recovery";
export const PASSWORD_FLOW_INVITE = "invite";

/**
 * `user_metadata` key written together with the invited user's first password.
 * UX gate only (user-editable), never used for authorization.
 */
export const INVITE_PASSWORD_SET_KEY = "invite_password_set";

/**
 * Reads the Supabase implicit-flow callback `type` (`#...&type=invite` / `type=recovery`).
 * Must run before supabase-js clears the hash.
 * @param {string} hash
 * @param {string} search
 * @returns {PasswordFlow | null}
 */
export function passwordFlowFromCallbackUrl(hash, search) {
  for (const raw of [hash, search]) {
    if (!raw) continue;
    const text = raw.replace(/^[#?]/, "");
    let type = "";
    try {
      type = new URLSearchParams(text).get("type") || "";
    } catch {
      type = "";
    }
    if (!type) {
      const encoded = /type%3D(recovery|invite)/i.exec(text);
      type = encoded ? encoded[1] : "";
    }
    type = type.toLowerCase();
    if (type === PASSWORD_FLOW_RECOVERY) return PASSWORD_FLOW_RECOVERY;
    if (type === PASSWORD_FLOW_INVITE) return PASSWORD_FLOW_INVITE;
  }
  return null;
}

/**
 * True for a Dashboard-invited user who has not completed the in-app "Set password" step.
 * Users who signed up themselves have no `invited_at`.
 * @param {{ invited_at?: string | null, user_metadata?: Record<string, unknown> } | null | undefined} user
 * @returns {boolean}
 */
export function userNeedsInvitePassword(user) {
  if (!user || !user.invited_at) return false;
  const m = user.user_metadata || {};
  return m[INVITE_PASSWORD_SET_KEY] !== true;
}

/**
 * Recovery wins over invite; a pending flow is never cleared by a weaker signal.
 * @param {PasswordFlow | null} current
 * @param {PasswordFlow | null} incoming
 * @returns {PasswordFlow | null}
 */
export function mergePasswordFlow(current, incoming) {
  if (current === PASSWORD_FLOW_RECOVERY || incoming === PASSWORD_FLOW_RECOVERY) {
    return PASSWORD_FLOW_RECOVERY;
  }
  return incoming || current || null;
}

/**
 * @param {PasswordFlow} flow
 * @returns {{ title: string, text: string, button: string }}
 */
export function passwordPanelCopy(flow) {
  if (flow === PASSWORD_FLOW_INVITE) {
    return {
      title: "Set your password",
      text: "Create a password to finish setting up your account.",
      button: "Set password",
    };
  }
  return {
    title: "New password",
    text: "Enter a new password for your account.",
    button: "Save password",
  };
}
