/**
 * Shared user row: avatar, display name, username.
 * @module userResultRow
 */

import { createProfileAvatarFace } from "./profileAvatarFace.js";
import { profileDisplayLabel } from "./supabaseProfile.js";

/**
 * @param {import('./supabaseProfile.js').ProfileRow} profile
 * @param {{ onClick?: () => void, trailing?: Node | null }} [opts]
 * @returns {HTMLElement}
 */
export function buildUserResultRow(profile, opts = {}) {
  const hasClick = typeof opts.onClick === "function";
  const useButton = hasClick && !opts.trailing;
  const wrap = document.createElement(useButton ? "button" : "div");
  if (wrap instanceof HTMLButtonElement) {
    wrap.type = "button";
  }
  wrap.className = "user-result-row";
  const face = createProfileAvatarFace(profile.avatar_url);
  face.classList.add("user-result-avatar");
  const text = document.createElement("div");
  text.className = "user-result-text";
  const name = document.createElement("div");
  name.className = "user-result-name";
  name.textContent = profileDisplayLabel(profile, profile.id);
  const user = document.createElement("div");
  user.className = "user-result-username";
  const uname = typeof profile.username === "string" ? profile.username.trim() : "";
  user.textContent = uname ? `@${uname}` : "";
  text.append(name, user);
  wrap.append(face, text);
  if (opts.trailing) wrap.appendChild(opts.trailing);
  if (hasClick) {
    wrap.addEventListener("click", opts.onClick);
    if (!useButton) {
      wrap.setAttribute("role", "button");
      wrap.tabIndex = 0;
    }
  }
  return wrap;
}
