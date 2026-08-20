/**
 * Mobile bottom navigation + tab panels. The nav stays put; each panel scrolls.
 * @module appTabs
 */

/** @typedef {"feed" | "session" | "profile"} AppTabId */

/** @type {readonly AppTabId[]} */
const APP_TABS = ["feed", "session", "profile"];

/** @type {AppTabId} */
let activeTab = "session";

const SCROLLBAR_HIDE_MS = 900;

/** @type {WeakMap<Element, number>} */
const scrollbarHideTimers = new WeakMap();

let overlayScrollbarsWired = false;

/**
 * Show the overlay scrollbar thumb only while a pane is scrolling.
 */
export function wireOverlayScrollbars() {
  if (overlayScrollbarsWired) return;
  overlayScrollbarsWired = true;
  document.addEventListener(
    "scroll",
    (e) => {
      const el = e.target;
      if (!(el instanceof Element) || el === document.documentElement || el === document.body) {
        return;
      }
      el.classList.add("is-scrolling");
      const prev = scrollbarHideTimers.get(el);
      if (prev) window.clearTimeout(prev);
      const next = window.setTimeout(() => {
        el.classList.remove("is-scrolling");
        scrollbarHideTimers.delete(el);
      }, SCROLLBAR_HIDE_MS);
      scrollbarHideTimers.set(el, next);
    },
    { capture: true, passive: true },
  );
}

/**
 * @param {string} value
 * @returns {value is AppTabId}
 */
function isAppTabId(value) {
  return APP_TABS.includes(/** @type {AppTabId} */ (value));
}

export function closeMenuSheet() {
  document.getElementById("menu-sheet")?.classList.add("hidden");
  document.getElementById("nav-menu")?.setAttribute("aria-expanded", "false");
}

export function openMenuSheet() {
  document.getElementById("menu-sheet")?.classList.remove("hidden");
  document.getElementById("nav-menu")?.setAttribute("aria-expanded", "true");
}

/**
 * @param {AppTabId} tab
 */
export function setActiveAppTab(tab) {
  activeTab = tab;
  closeMenuSheet();

  for (const id of APP_TABS) {
    const panel = document.getElementById(`tab-${id}`);
    const btn = document.getElementById(`nav-${id}`);
    const on = id === tab;
    panel?.classList.toggle("is-active", on);
    if (panel) panel.hidden = !on;
    btn?.classList.toggle("is-active", on);
    if (on) btn?.setAttribute("aria-current", "page");
    else btn?.removeAttribute("aria-current");
  }
}

/** @returns {AppTabId} */
export function getActiveAppTab() {
  return activeTab;
}

/**
 * @param {{ onTabChange?: (tab: AppTabId) => void }} [options]
 */
export function wireAppTabs(options = {}) {
  wireOverlayScrollbars();
  const nav = document.getElementById("app-bottom-nav");
  nav?.addEventListener("click", (e) => {
    const btn = e.target instanceof Element ? e.target.closest(".app-nav-btn") : null;
    if (!(btn instanceof HTMLElement) || !nav.contains(btn)) return;
    if (btn.id === "nav-menu") {
      const sheet = document.getElementById("menu-sheet");
      if (sheet?.classList.contains("hidden")) openMenuSheet();
      else closeMenuSheet();
      return;
    }
    const tab = btn.dataset.tab;
    if (!isAppTabId(tab)) return;
    setActiveAppTab(tab);
    if (typeof options.onTabChange === "function") {
      options.onTabChange(tab);
    }
  });

  document.getElementById("menu-sheet-close")?.addEventListener("click", () => {
    closeMenuSheet();
  });
  document.getElementById("menu-sheet")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeMenuSheet();
  });

  setActiveAppTab(activeTab);
}
