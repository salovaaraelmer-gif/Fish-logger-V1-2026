/**
 * `public.profiles.username` rules shared by profile upsert and invite account setup.
 * Uniqueness is enforced by the `profiles_username_unique` index.
 * @module usernameRules
 */

export const USERNAME_MIN_LENGTH = 2;
/** Longer values are truncated by `upsertProfileForUser`, so setup rejects them instead. */
export const USERNAME_MAX_LENGTH = 30;

/**
 * Lowercase; only `a-z`, `0-9`, single `_`; no leading/trailing `_`.
 * @param {string | null | undefined} raw
 * @returns {string}
 */
export function normalizeUsername(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Error for a username the user typed, or null when `normalizeUsername` keeps it as typed (case aside).
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function usernameValidationError(raw) {
  const typed = typeof raw === "string" ? raw.trim() : "";
  if (!typed) return "Enter a username.";
  const normalized = normalizeUsername(typed);
  if (normalized !== typed.toLowerCase()) {
    return "Username can only use letters, numbers, and single underscores (not at the start or end).";
  }
  if (normalized.length < USERNAME_MIN_LENGTH) {
    return `Username must be at least ${USERNAME_MIN_LENGTH} characters.`;
  }
  if (normalized.length > USERNAME_MAX_LENGTH) {
    return `Username can be at most ${USERNAME_MAX_LENGTH} characters.`;
  }
  return null;
}
