/**
 * Pull-to-refresh on an existing scroller (no nested scroll container).
 * @module pullToRefresh
 */

export const PTR_THRESHOLD_PX = 72;
export const PTR_MAX_PULL_PX = 120;

/**
 * @param {{
 *   scrollTop?: number,
 *   enabled?: boolean,
 *   formFocused?: boolean,
 *   keyboardOpen?: boolean,
 * }} state
 * @returns {boolean}
 */
export function canBeginPull(state) {
  if (state?.enabled === false) return false;
  if (state?.formFocused) return false;
  if (state?.keyboardOpen) return false;
  return (state?.scrollTop || 0) <= 0;
}

/**
 * @param {number} dy
 * @param {number} [threshold]
 * @returns {boolean}
 */
export function pullPassesThreshold(dy, threshold = PTR_THRESHOLD_PX) {
  return Number.isFinite(dy) && dy >= threshold;
}

/**
 * @param {EventTarget | null | undefined} el
 * @returns {boolean}
 */
export function isTypingTarget(el) {
  if (!el || typeof el !== "object") return false;
  const node = /** @type {{ tagName?: string, type?: string, isContentEditable?: boolean }} */ (el);
  if (node.isContentEditable) return true;
  const tag = String(node.tagName || "").toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = String(node.type || "text").toLowerCase();
  return type !== "button" && type !== "submit" && type !== "checkbox" && type !== "radio" && type !== "file";
}

/**
 * @param {HTMLElement} scroller
 * @param {{
 *   onRefresh: () => unknown | Promise<unknown>,
 *   isEnabled?: () => boolean,
 * }} options
 */
export function wirePullToRefresh(scroller, options) {
  if (!scroller || scroller.dataset.ptrWired === "1") return;
  scroller.dataset.ptrWired = "1";

  const indicator = document.createElement("div");
  indicator.className = "ptr-indicator";
  indicator.setAttribute("aria-hidden", "true");
  const spinner = document.createElement("div");
  spinner.className = "ptr-spinner";
  indicator.appendChild(spinner);
  scroller.insertBefore(indicator, scroller.firstChild);

  let startY = 0;
  let armed = false;
  let pulling = false;
  let refreshing = false;
  let distance = 0;

  const enabled = () => (typeof options.isEnabled === "function" ? options.isEnabled() !== false : true);

  const resetIndicator = () => {
    indicator.classList.remove("is-refreshing");
    indicator.style.height = "";
  };

  const formBlocking = () => {
    const active = document.activeElement;
    return isTypingTarget(active) && scroller.contains(active);
  };

  scroller.addEventListener(
    "touchstart",
    (event) => {
      if (refreshing || event.touches.length !== 1) return;
      if (!enabled() || formBlocking()) {
        armed = false;
        return;
      }
      if (!canBeginPull({ scrollTop: scroller.scrollTop, enabled: true, formFocused: false })) {
        armed = false;
        return;
      }
      startY = event.touches[0].clientY;
      armed = true;
      pulling = false;
      distance = 0;
    },
    { passive: true }
  );

  scroller.addEventListener(
    "touchmove",
    (event) => {
      if (!armed || refreshing || event.touches.length !== 1) return;
      if (!enabled() || formBlocking()) {
        armed = false;
        pulling = false;
        resetIndicator();
        return;
      }
      const dy = event.touches[0].clientY - startY;
      if (scroller.scrollTop > 0 && !pulling) {
        armed = false;
        return;
      }
      if (dy <= 8) {
        if (pulling) {
          pulling = false;
          distance = 0;
          resetIndicator();
        }
        return;
      }
      pulling = true;
      distance = Math.min(PTR_MAX_PULL_PX, (dy - 8) * 0.5);
      indicator.style.height = `${distance}px`;
      if (event.cancelable) event.preventDefault();
    },
    { passive: false }
  );

  const finish = async () => {
    if (!armed) return;
    const shouldRefresh = pulling && pullPassesThreshold(distance);
    armed = false;
    pulling = false;
    distance = 0;
    if (!shouldRefresh) {
      resetIndicator();
      return;
    }
    refreshing = true;
    indicator.classList.add("is-refreshing");
    indicator.style.height = "";
    try {
      await options.onRefresh();
    } finally {
      refreshing = false;
      resetIndicator();
    }
  };

  scroller.addEventListener("touchend", () => {
    void finish();
  });
  scroller.addEventListener("touchcancel", () => {
    armed = false;
    pulling = false;
    distance = 0;
    if (!refreshing) resetIndicator();
  });
}
