/**
 * Profile overlay: read-only Supabase profile + auth email; logout.
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
 * @returns {Promise<void>}
 */
async function fillProfileFields() {
  const nameEl = document.getElementById("profile-display-name");
  const userEl = document.getElementById("profile-username");
  const emailEl = document.getElementById("profile-email");
  if (!nameEl || !userEl || !emailEl) return;

  nameEl.textContent = "…";
  userEl.textContent = "…";
  emailEl.textContent = "…";

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  const user = authData?.user;

  if (authErr || !user) {
    nameEl.textContent = "—";
    userEl.textContent = "—";
    emailEl.textContent = "—";
    return;
  }

  const email = orFallback(user.email, "—");
  emailEl.textContent = email;

  const { profile, error } = await fetchProfileForUser(user.id);
  if (error) {
    console.warn("[Profile] fetch profile:", error);
  }

  const displayFromAuth = getDisplayNameFromUser(user);
  const displayName = profile
    ? orFallback(profile.display_name, orFallback(displayFromAuth, "—"))
    : orFallback(displayFromAuth, "—");
  nameEl.textContent = displayName;

  const username = profile ? orFallback(profile.username, "—") : "—";
  userEl.textContent = username;
}

export function closeProfileOverlay() {
  document.getElementById("profile-overlay")?.classList.add("hidden");
}

/**
 * @param {{ onError?: (msg: string) => void }} [options]
 * @returns {void}
 */
export function wireProfileUi(options = {}) {
  const overlay = document.getElementById("profile-overlay");
  const openBtn = document.getElementById("btn-open-profile");
  const closeBtn = document.getElementById("profile-close");
  const logoutBtn = document.getElementById("profile-logout");

  openBtn?.addEventListener("click", () => {
    overlay?.classList.remove("hidden");
    void fillProfileFields();
  });

  closeBtn?.addEventListener("click", () => {
    closeProfileOverlay();
  });

  logoutBtn?.addEventListener("click", async () => {
    const { error } = await signOut();
    if (error) {
      if (typeof options.onError === "function") {
        options.onError(error.message);
      } else {
        console.error("[Profile] signOut:", error.message);
      }
      return;
    }
    closeProfileOverlay();
  });
}
