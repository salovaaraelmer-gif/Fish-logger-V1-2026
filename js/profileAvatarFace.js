/**
 * Shared circular profile face: photo or the Profile-tab silhouette fallback.
 * @module profileAvatarFace
 */

const FALLBACK_SVG = `<svg viewBox="0 0 24 24" class="profile-avatar-face-icon" aria-hidden="true">
  <circle cx="12" cy="8.5" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7" />
  <path d="M5.6 19.2c1-3.1 3.2-4.7 6.4-4.7s5.4 1.6 6.4 4.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
</svg>`;

/**
 * @param {string | null | undefined} url
 * @returns {HTMLElement}
 */
export function createProfileAvatarFace(url) {
  const face = document.createElement("span");
  face.className = "profile-avatar-face";
  const src = typeof url === "string" ? url.trim() : "";
  if (src) {
    const img = document.createElement("img");
    img.className = "profile-avatar-face-img";
    img.alt = "";
    img.src = src;
    face.appendChild(img);
  } else {
    face.innerHTML = FALLBACK_SVG;
  }
  return face;
}
