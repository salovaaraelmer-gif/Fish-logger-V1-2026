/**
 * Auth V1 — email/password only; display name from user_metadata.full_name.
 * @module auth
 */

import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "./supabase.js";

/** Fallback when `getUser()` is slow or session persistence lags after REST login. */
let cachedAuthUserId = null;

/**
 * @param {string | null} userId
 */
export function setCachedAuthUserId(userId) {
  cachedAuthUserId = userId;
}

export function clearCachedAuthUserId() {
  cachedAuthUserId = null;
}

/**
 * Maps Supabase Auth errors (incl. HTTP 429 rate limits) to readable English UI text.
 * @param {{ message?: string; status?: number } | null | undefined} error
 * @returns {string}
 */
export function formatAuthErrorForUi(error) {
  if (!error) return "Unknown error.";
  const raw = String(error.message || "");
  const msg = raw.toLowerCase();
  const status = typeof error.status === "number" ? error.status : undefined;
  if (
    status === 429 ||
    msg.includes("rate limit") ||
    msg.includes("too many") ||
    msg.includes("email rate limit") ||
    /\b429\b/.test(msg)
  ) {
    return "Too many attempts in a short time. Wait a few minutes and try again.";
  }
  return raw;
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T | { timedOut: true }>}
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve({ timedOut: true }), ms);
    }),
  ]);
}

/**
 * @param {string} email
 * @param {string} password
 */
async function signInWithPasswordRestFallback(email, password) {
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 9000);
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: email.trim(), password }),
      signal: ctrl.signal,
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = typeof body?.msg === "string" ? body.msg : "Login failed.";
      return { data: { user: null, session: null }, error: { message: msg } };
    }
    const access_token = typeof body?.access_token === "string" ? body.access_token : null;
    const refresh_token = typeof body?.refresh_token === "string" ? body.refresh_token : null;
    if (!access_token || !refresh_token) {
      return { data: { user: null, session: null }, error: { message: "Login failed." } };
    }
    let setRes = await withTimeout(
      supabase.auth.setSession({ access_token, refresh_token }),
      6000
    );
    if (typeof setRes === "object" && setRes && "timedOut" in setRes) {
      console.warn("[Auth] setSession timed out (6s) — retrying once");
      setRes = await withTimeout(
        supabase.auth.setSession({ access_token, refresh_token }),
        6000
      );
    }
    if (!(typeof setRes === "object" && setRes && "timedOut" in setRes)) {
      const userId = setRes?.data?.user?.id ?? body?.user?.id ?? null;
      if (userId) {
        cachedAuthUserId = userId;
        console.log("[Auth] login success — session persisted, userId:", userId);
      }
      return setRes;
    }
    // If session persistence hangs, still return authenticated user payload.
    const user = body?.user && typeof body.user === "object" ? body.user : null;
    if (user?.id) {
      cachedAuthUserId = user.id;
      console.warn("[Auth] login partial — user payload ok but session persistence timed out, userId:", user.id);
    }
    return { data: { user, session: null }, error: null };
  } catch (err) {
    if (err && typeof err === "object" && "name" in err && err.name === "AbortError") {
      return { data: { user: null, session: null }, error: { message: "Login request timed out." } };
    }
    return { data: { user: null, session: null }, error: { message: "Login failed." } };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Visible display name for UI. Never uses email.
 * @param {{ user_metadata?: Record<string, unknown> } | null | undefined} user
 * @returns {string}
 */
export function getDisplayNameFromUser(user) {
  if (!user) return "";
  const m = user.user_metadata || {};
  if (typeof m.full_name === "string" && m.full_name.trim()) {
    return m.full_name.trim();
  }
  const f = typeof m.first_name === "string" ? m.first_name.trim() : "";
  const l = typeof m.last_name === "string" ? m.last_name.trim() : "";
  if (f || l) return `${f} ${l}`.trim();
  return "User";
}

/**
 * @param {string} email
 * @param {string} password
 * @param {string} firstName
 * @param {string} lastName
 * @param {string} [username] — stored in metadata; app upserts `public.profiles.username` on login
 */
export async function signUpWithProfile(email, password, firstName, lastName, username) {
  const fn = (firstName || "").trim();
  const ln = (lastName || "").trim();
  const full = [fn, ln].filter(Boolean).join(" ").trim() || fn || ln;
  const rawU = typeof username === "string" ? username.trim().toLowerCase() : "";
  const u = rawU.replace(/[^a-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        first_name: fn,
        last_name: ln,
        full_name: full,
        ...(u.length >= 2 ? { username: u } : {}),
      },
    },
  });
}

/**
 * @param {string} email
 * @param {string} password
 */
export async function signInWithEmail(email, password) {
  // REST-first: network logs show token endpoint is healthy while SDK signIn can hang.
  return signInWithPasswordRestFallback(email, password);
}

export async function signOut() {
  clearCachedAuthUserId();
  return supabase.auth.signOut();
}

/**
 * Site URL for Supabase email links (password reset, etc.). Must match Auth → URL config.
 * @returns {string}
 */
export function getAuthSiteUrl() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/`;
}

/**
 * Sends password reset email (user clicks link → lands on site with recovery session).
 * @param {string} email
 * @returns {ReturnType<typeof supabase.auth.resetPasswordForEmail>}
 */
export function sendPasswordResetEmail(email) {
  const redirectTo = getAuthSiteUrl();
  return supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
}

/**
 * @param {string} newPassword
 */
export function updatePassword(newPassword) {
  return supabase.auth.updateUser({ password: newPassword });
}

/**
 * @returns {Promise<string | null>}
 */
export async function getAuthUserId() {
  try {
    const maybe = await withTimeout(supabase.auth.getUser(), 4000);
    if (maybe && !(typeof maybe === "object" && "timedOut" in maybe)) {
      const userId = maybe.data?.user?.id ?? null;
      if (userId) {
        cachedAuthUserId = userId;
        return userId;
      }
    } else {
      console.warn("[Auth] getUser timed out — using cached user id if available");
    }
  } catch (err) {
    console.warn("[Auth] getUser failed:", err);
  }
  return cachedAuthUserId;
}
