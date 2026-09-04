/**
 * Catch-entry overlay: autofill guards and mobile keyboard layout.
 * @module catchFormUi
 */

export const CATCH_NAV_FOCUS_CLASS = "is-catch-input-focused";
export const CATCH_VV_SYNC_CLASS = "is-vv-synced";
export const CATCH_KEYBOARD_OPEN_CLASS = "is-keyboard-open";
export const CATCH_KEYBOARD_HEIGHT_PX = 80;

/** Unrecognized autocomplete token — not a login, payment, or address hint. */
export const CATCH_ENTRY_AUTOFILL_VALUE = "al-no-fill";

const PERSONAL_NAME_HINTS = [
  "email",
  "username",
  "password",
  "address",
  "location",
  "street",
  "postal",
  "country",
  "city",
  "phone",
  "tel",
  "card",
  "cc-",
  "payment",
  "account",
  "contact",
  "organization",
];

/**
 * Catch measurement / notes fields. Names avoid personal-data heuristics.
 */
export const CATCH_ENTRY_FIELD_SPECS = [
  { id: "fish-input-length", name: "al_meas_cm", measurement: true, inputMode: "numeric" },
  { id: "fish-input-weight", name: "al_meas_mass", measurement: true, inputMode: "decimal" },
  { id: "fish-input-depth", name: "al_meas_m", measurement: true, inputMode: "decimal" },
  { id: "fish-input-water-temp", name: "al_meas_c", measurement: true, inputMode: "decimal" },
  { id: "fish-notes", name: "al_field_memo", measurement: false, inputMode: null },
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
  const value = String(token || "").trim().toLowerCase();
  if (!value) return false;
  if (PERSONAL_AUTOFILL_TOKENS.has(value)) return true;
  return PERSONAL_NAME_HINTS.some((hint) => value.includes(hint));
}

/**
 * Shared keyboard state: visual viewport vs layout height, not a single input blur.
 *
 * @param {{ height?: number, offsetTop?: number } | null | undefined} visualViewport
 * @param {number} layoutHeight
 * @returns {boolean}
 */
export function isMobileKeyboardOpen(visualViewport, layoutHeight) {
  if (!visualViewport || !Number.isFinite(visualViewport.height)) return false;
  if (!Number.isFinite(layoutHeight)) return false;
  const shrink = layoutHeight - visualViewport.height;
  if (shrink > CATCH_KEYBOARD_HEIGHT_PX) return true;
  const offsetTop = Number.isFinite(visualViewport.offsetTop) ? visualViewport.offsetTop : 0;
  return offsetTop > CATCH_KEYBOARD_HEIGHT_PX && shrink > 24;
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
 * iOS/Android open the keyboard from the field's editable state at
 * pointer/touch start. Removing readonly only on focus shows a caret
 * and no keyboard.
 *
 * @param {EventTarget | HTMLElement | null | undefined} el
 * @returns {boolean}
 */
export function unlockCatchTypingField(el) {
  if (!isCatchTypingField(el)) return false;
  const field = /** @type {HTMLElement & { readOnly?: boolean }} */ (el);
  field.removeAttribute("readonly");
  if ("readOnly" in field) field.readOnly = false;
  return true;
}

/**
 * @param {EventTarget | HTMLElement | null | undefined} el
 * @returns {boolean}
 */
export function lockCatchTypingField(el) {
  if (!isCatchTypingField(el)) return false;
  const field = /** @type {HTMLElement & { readOnly?: boolean }} */ (el);
  field.setAttribute("readonly", "true");
  if ("readOnly" in field) field.readOnly = true;
  return true;
}

/**
 * @param {{ target?: EventTarget | null } | null | undefined} event
 * @returns {boolean}
 */
export function unlockCatchTypingFieldFromEvent(event) {
  return unlockCatchTypingField(event?.target);
}

/**
 * @param {ParentNode | null | undefined} root
 */
export function applyCatchEntryAutofillGuards(root) {
  if (!root || typeof root.querySelector !== "function") return;
  const active = typeof document !== "undefined" ? document.activeElement : null;
  for (const spec of CATCH_ENTRY_FIELD_SPECS) {
    const el = root.querySelector(`#${spec.id}`);
    if (!el) continue;
    el.setAttribute("name", spec.name);
    el.setAttribute("autocomplete", CATCH_ENTRY_AUTOFILL_VALUE);
    el.setAttribute("data-lpignore", "true");
    el.setAttribute("data-1p-ignore", "true");
    el.setAttribute("data-form-type", "other");
    el.removeAttribute("pattern");
    if (el !== active) lockCatchTypingField(el);
    if (!spec.measurement) continue;
    el.setAttribute("inputmode", spec.inputMode);
    el.setAttribute("autocapitalize", "none");
    el.setAttribute("autocorrect", "off");
    el.setAttribute("spellcheck", "false");
    el.setAttribute("enterkeyhint", "done");
    el.setAttribute("maxlength", spec.inputMode === "numeric" ? "6" : "12");
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
  const active = typeof document !== "undefined" ? document.activeElement : null;
  const typingFocused = Boolean(
    isCatchTypingField(active) && overlay.contains(/** @type {Node} */ (active))
  );
  overlay.classList.toggle(CATCH_NAV_FOCUS_CLASS, typingFocused && keyboardOpen);
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
  applyCatchEntryAutofillGuards(overlay);
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
  /** @type {ReturnType<typeof setTimeout> | number} */
  let keyboardPoll = 0;

  const sync = () => syncCatchOverlayToVisualViewport(overlay);

  const armKeyboardPoll = () => {
    window.clearTimeout(keyboardPoll);
    const tick = () => {
      if (overlay.classList.contains("hidden")) return;
      const open = syncCatchOverlayToVisualViewport(overlay);
      const active = document.activeElement;
      const typing = isCatchTypingField(active) && overlay.contains(active);
      if (open || typing) {
        keyboardPoll = window.setTimeout(tick, 200);
      }
    };
    keyboardPoll = window.setTimeout(tick, 180);
  };

  overlay.addEventListener("pointerdown", unlockCatchTypingFieldFromEvent, {
    capture: true,
    passive: true,
  });
  overlay.addEventListener("touchstart", unlockCatchTypingFieldFromEvent, {
    capture: true,
    passive: true,
  });

  overlay.addEventListener("focusin", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!isCatchTypingField(target)) return;
    window.clearTimeout(blurTimer);
    unlockCatchTypingField(target);
    sync();
    armKeyboardPoll();
    const align = () => {
      scrollFieldIntoStepBody(target);
      syncCatchOverlayToVisualViewport(overlay);
    };
    window.requestAnimationFrame(align);
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(align, 280);
  });

  overlay.addEventListener("focusout", (e) => {
    const leaving = /** @type {HTMLElement} */ (e.target);
    window.clearTimeout(blurTimer);
    blurTimer = window.setTimeout(() => {
      const active = document.activeElement;
      if (isCatchTypingField(leaving) && active !== leaving) {
        lockCatchTypingField(leaving);
      }
      syncCatchOverlayToVisualViewport(overlay);
      armKeyboardPoll();
    }, 60);
  });

  if (typeof window === "undefined") return;

  window.visualViewport?.addEventListener("resize", () => {
    sync();
    armKeyboardPoll();
  });
  window.visualViewport?.addEventListener("scroll", sync);
  window.addEventListener("resize", () => {
    sync();
    armKeyboardPoll();
  });
}
