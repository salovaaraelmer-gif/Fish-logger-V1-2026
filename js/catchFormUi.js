/**
 * Catch-entry overlay: autofill guards and mobile keyboard layout.
 * @module catchFormUi
 */

export const CATCH_NAV_FOCUS_CLASS = "is-catch-input-focused";
export const CATCH_VV_SYNC_CLASS = "is-vv-synced";
export const CATCH_KEYBOARD_OPEN_CLASS = "is-keyboard-open";
export const CATCH_KEYBOARD_HEIGHT_PX = 80;

/** Autocomplete value that is not a login, payment, or address token. */
export const CATCH_ENTRY_AUTOFILL_VALUE = "off";

/**
 * Catch measurement / notes fields. Names are prefixed so Chrome does not
 * treat them as password, card, or address fields.
 */
export const CATCH_ENTRY_FIELD_SPECS = [
  { id: "fish-input-length", name: "al_catch_length_cm", measurement: true },
  { id: "fish-input-weight", name: "al_catch_weight_kg", measurement: true },
  { id: "fish-input-depth", name: "al_catch_depth_m", measurement: true },
  { id: "fish-input-water-temp", name: "al_catch_water_temp_c", measurement: true },
  { id: "fish-notes", name: "al_catch_notes", measurement: false },
];

const PERSONAL_AUTOFILL_TOKENS = new Set([
  "email",
  "username",
  "current-password",
  "new-password",
  "cc-name",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "street-address",
  "address-line1",
  "postal-code",
  "country",
  "tel",
  "name",
  "organization",
]);

/**
 * @param {string | null | undefined} token
 * @returns {boolean}
 */
export function isPersonalAutofillToken(token) {
  return PERSONAL_AUTOFILL_TOKENS.has(String(token || "").trim().toLowerCase());
}

/**
 * @param {{ height?: number } | null | undefined} visualViewport
 * @param {number} layoutHeight
 * @returns {boolean}
 */
export function isMobileKeyboardOpen(visualViewport, layoutHeight) {
  if (!visualViewport || !Number.isFinite(visualViewport.height)) return false;
  if (!Number.isFinite(layoutHeight)) return false;
  return layoutHeight - visualViewport.height > CATCH_KEYBOARD_HEIGHT_PX;
}

/**
 * @param {Pick<HTMLElement, "tagName" | "type"> | null | undefined} el
 * @returns {boolean}
 */
export function isCatchTypingField(el) {
  if (!el) return false;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  const type = String(el.type || "text").toLowerCase();
  return type === "text" || type === "search" || type === "tel" || type === "number";
}

/**
 * @param {ParentNode | null | undefined} root
 */
export function applyCatchEntryAutofillGuards(root) {
  if (!root || typeof root.querySelector !== "function") return;
  for (const spec of CATCH_ENTRY_FIELD_SPECS) {
    const el = root.querySelector(`#${spec.id}`);
    if (!el) continue;
    el.setAttribute("name", spec.name);
    el.setAttribute("autocomplete", CATCH_ENTRY_AUTOFILL_VALUE);
    el.setAttribute("data-lpignore", "true");
    el.setAttribute("data-1p-ignore", "true");
    el.setAttribute("data-form-type", "other");
    el.removeAttribute("pattern");
    if (!spec.measurement) continue;
    el.setAttribute("autocapitalize", "none");
    el.setAttribute("autocorrect", "off");
    el.setAttribute("spellcheck", "false");
    el.setAttribute("enterkeyhint", "done");
  }
}

/**
 * @param {HTMLElement | null | undefined} overlay
 */
export function clearCatchOverlayViewport(overlay) {
  if (!overlay) return;
  overlay.classList.remove(
    CATCH_VV_SYNC_CLASS,
    CATCH_KEYBOARD_OPEN_CLASS,
    CATCH_NAV_FOCUS_CLASS
  );
  overlay.style.removeProperty("--catch-vv-top");
  overlay.style.removeProperty("--catch-vv-height");
}

/**
 * @param {HTMLElement | null | undefined} overlay
 * @param {{ height: number, offsetTop?: number } | null} [viewport]
 * @param {number} [layoutHeight]
 * @returns {boolean}
 */
export function syncCatchOverlayToVisualViewport(
  overlay,
  viewport = typeof window !== "undefined" ? window.visualViewport : null,
  layoutHeight = typeof window !== "undefined" ? window.innerHeight : 0
) {
  if (!overlay || overlay.classList.contains("hidden")) {
    clearCatchOverlayViewport(overlay);
    return false;
  }
  if (!viewport || !Number.isFinite(viewport.height)) return false;
  const top = Number.isFinite(viewport.offsetTop) ? viewport.offsetTop : 0;
  overlay.style.setProperty("--catch-vv-top", `${top}px`);
  overlay.style.setProperty("--catch-vv-height", `${viewport.height}px`);
  overlay.classList.add(CATCH_VV_SYNC_CLASS);
  const keyboardOpen = isMobileKeyboardOpen(viewport, layoutHeight);
  overlay.classList.toggle(CATCH_KEYBOARD_OPEN_CLASS, keyboardOpen);
  return keyboardOpen;
}

/**
 * @param {HTMLElement} field
 */
function scrollFieldIntoStepBody(field) {
  const body = field.closest(".fish-step-body");
  if (!body) {
    field.scrollIntoView({ block: "center", inline: "nearest" });
    return;
  }
  const bodyRect = body.getBoundingClientRect();
  const fieldRect = field.getBoundingClientRect();
  const pad = 16;
  if (fieldRect.top >= bodyRect.top + pad && fieldRect.bottom <= bodyRect.bottom - pad) {
    return;
  }
  const delta = fieldRect.top - bodyRect.top - (bodyRect.height / 2 - fieldRect.height / 2);
  body.scrollTop += delta;
}

/**
 * @param {HTMLElement} overlay
 */
export function onCatchFormOverlayShown(overlay) {
  syncCatchOverlayToVisualViewport(overlay);
}

/**
 * @param {HTMLElement | null | undefined} overlay
 */
export function onCatchFormOverlayHidden(overlay) {
  clearCatchOverlayViewport(overlay);
}

/**
 * @param {HTMLElement | null | undefined} overlay
 */
export function wireCatchFormUi(overlay) {
  if (!overlay || overlay.dataset.catchFormUiWired === "1") return;
  overlay.dataset.catchFormUiWired = "1";
  applyCatchEntryAutofillGuards(overlay);

  overlay.querySelectorAll("form").forEach((form) => {
    form.setAttribute("autocomplete", "off");
    form.addEventListener("submit", (e) => e.preventDefault());
  });

  /** @type {ReturnType<typeof setTimeout> | number} */
  let blurTimer = 0;
  /** @type {ReturnType<typeof setTimeout> | number} */
  let scrollTimer = 0;

  overlay.addEventListener("focusin", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!isCatchTypingField(target)) return;
    window.clearTimeout(blurTimer);
    overlay.classList.add(CATCH_NAV_FOCUS_CLASS);
    syncCatchOverlayToVisualViewport(overlay);
    const align = () => {
      scrollFieldIntoStepBody(target);
      syncCatchOverlayToVisualViewport(overlay);
    };
    window.requestAnimationFrame(align);
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(align, 280);
  });

  overlay.addEventListener("focusout", () => {
    window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(() => {
      const active = document.activeElement;
      if (isCatchTypingField(active) && overlay.contains(active)) return;
      overlay.classList.remove(CATCH_NAV_FOCUS_CLASS);
      syncCatchOverlayToVisualViewport(overlay);
    }, 60);
  });

  const sync = () => syncCatchOverlayToVisualViewport(overlay);
  window.visualViewport?.addEventListener("resize", sync);
  window.visualViewport?.addEventListener("scroll", sync);
  window.addEventListener("resize", sync);
}
