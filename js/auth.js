/**
 * Auth V1 — email/password only; display name from user_metadata.full_name.
 * @module auth
 */

import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from "./supabase.js";

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
    const setRes = await withTimeout(
      supabase.auth.setSession({ access_token, refresh_token }),
      2500
    );
    if (!(typeof setRes === "object" && setRes && "timedOut" in setRes)) {
      return setRes;
    }
    // If session persistence hangs, still return authenticated user payload.
    const user = body?.user && typeof body.user === "object" ? body.user : null;
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
 */
export async function signUpWithProfile(email, password, firstName, lastName) {
  const fn = (firstName || "").trim();
  const ln = (lastName || "").trim();
  const full = [fn, ln].filter(Boolean).join(" ").trim() || fn || ln;
  return supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: {
        first_name: fn,
        last_name: ln,
        full_name: full,
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
  return supabase.auth.signOut();
}

/**
 * @returns {Promise<string | null>}
 */
export async function getAuthUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
