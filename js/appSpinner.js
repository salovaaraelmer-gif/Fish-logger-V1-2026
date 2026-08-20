/**
 * Full-screen spinner for slow loads (history sessions, overlays).
 * @module appSpinner
 */

let spinnerDepth = 0;

function spinnerEl() {
  return document.getElementById("app-spinner");
}

export function showAppSpinner() {
  spinnerDepth += 1;
  const el = spinnerEl();
  el?.classList.remove("hidden");
  el?.setAttribute("aria-busy", "true");
}

export function hideAppSpinner() {
  spinnerDepth = Math.max(0, spinnerDepth - 1);
  if (spinnerDepth > 0) return;
  const el = spinnerEl();
  el?.classList.add("hidden");
  el?.setAttribute("aria-busy", "false");
}

export function resetAppSpinner() {
  spinnerDepth = 0;
  const el = spinnerEl();
  el?.classList.add("hidden");
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
