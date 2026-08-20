/**
 * Profile tab: read-only Supabase profile + auth email; logout lives in the menu.
 * @module profileUI
 */

import { getDisplayNameFromUser, signOut } from "./auth.js";
import { supabase } from "./supabase.js";
import { fetchProfileForUser } from "./supabaseProfile.js";

/**
 * @param {string | null | undefined} s
 * @param {string} fallback
 */
function orFallback(s, fallback) {
  const t = typeof s === "string" ? s.trim() : "";
  return t || fallback;
}

/**
 * @param {string | null | undefined} iso
 * @returns {string}
 */
function formatAccountCreated(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function setProfilePlaceholders(text) {
  const nameEl = document.getElementById("profile-display-name");
  const userEl = document.getElementById("profile-username");
  const emailEl = document.getElementById("profile-email");
  const createdEl = document.getElementById("profile-created-at");
  if (nameEl) nameEl.textContent = text;
  if (userEl) userEl.textContent = text;
  if (emailEl) emailEl.textContent = text;
  if (createdEl) createdEl.textContent = text;
}

/**
 * @returns {Promise<void>}
 */
export async function fillProfileFields() {
  const nameEl = document.getElementById("profile-display-name");
  const userEl = document.getElementById("profile-username");
  const emailEl = document.getElementById("profile-email");
  const createdEl = document.getElementById("profile-created-at");
  if (!nameEl || !userEl || !emailEl || !createdEl) return;

  setProfilePlaceholders("…");

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  const user = authData?.user;

  if (authErr || !user) {
    setProfilePlaceholders("—");
    return;
  }

  emailEl.textContent = orFallback(user.email, "—");
  createdEl.textContent = formatAccountCreated(user.created_at);

  const { profile, error } = await fetchProfileForUser(user.id);
  if (error) {
    console.warn("[Profile] fetch profile:", error);
  }

  const displayFromAuth = getDisplayNameFromUser(user);
  const displayName = profile
    ? orFallback(profile.display_name, orFallback(displayFromAuth, "—"))
    : orFallback(displayFromAuth, "—");
  nameEl.textContent = displayName;
  userEl.textContent = profile ? orFallback(profile.username, "—") : "—";
}

export function closeProfileOverlay() {
  /* Profile is a tab now; kept so logout/sign-out paths stay valid. */
}

/**
 * @param {{ onError?: (msg: string) => void, onOpen?: () => void }} [options]
 * @returns {void}
 */
export function wireProfileUi(options = {}) {
  const openBtn = document.getElementById("btn-open-profile");
  const logoutBtn = document.getElementById("menu-logout");

  openBtn?.addEventListener("click", () => {
    if (typeof options.onOpen === "function") {
      options.onOpen();
    }
    void fillProfileFields();
  });

  logoutBtn?.addEventListener("click", async () => {
    const { error } = await signOut();
    if (error) {
      if (typeof options.onError === "function") {
        options.onError(error.message);
      } else {
        console.error("[Profile] signOut:", error.message);
      }
    }
  });
}
