/**
 * Full-screen spinner for slow loads (history sessions, overlays).
 * @module appSpinner
 */

let spinnerDepth = 0;

function spinnerEl() {
  return document.getElementById("app-spinner");
}

/**
 * @param {{ opaque?: boolean }} [options]
 */
export function showAppSpinner(options = {}) {
  spinnerDepth += 1;
  const el = spinnerEl();
  if (!el) return;
  el.classList.remove("hidden");
  el.setAttribute("aria-busy", "true");
  if (options.opaque) el.classList.add("is-opaque");
}

export function hideAppSpinner() {
  spinnerDepth = Math.max(0, spinnerDepth - 1);
  if (spinnerDepth > 0) return;
  const el = spinnerEl();
  el?.classList.add("hidden");
  el?.classList.remove("is-opaque");
  el?.setAttribute("aria-busy", "false");
}

export function resetAppSpinner() {
  spinnerDepth = 0;
  const el = spinnerEl();
  el?.classList.add("hidden");
  el?.classList.remove("is-opaque");
  el?.setAttribute("aria-busy", "false");
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} [delayMs] wait before showing, so fast loads do not flash
 * @returns {Promise<T>}
 */
export async function withAppSpinner(fn, delayMs = 120) {
  let shown = false;
  const timer = window.setTimeout(() => {
    shown = true;
    showAppSpinner();
  }, delayMs);
  try {
    return await fn();
  } finally {
    window.clearTimeout(timer);
    if (shown) hideAppSpinner();
  }
}
