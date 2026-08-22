/**
 * Browser History API wrapper. Pushes a history entry for each main view.
 * @module appRouter
 */

import { canonicalizeAppPath, parseAppPath } from "./appRoutes.js";

const STATE_KEY = "anglrNav";

/** @typedef {import('./appRoutes.js').AppRoute} AppRoute */

/** @type {((route: AppRoute, meta: { reason: string }) => void | Promise<void>) | null} */
let routeListener = null;

let started = false;

/**
 * @param {unknown} state
 * @returns {state is { anglrNav: true, depth: number }}
 */
function isAppHistoryState(state) {
  return Boolean(state && typeof state === "object" && STATE_KEY in state);
}

/**
 * @param {number} depth
 */
function makeState(depth) {
  return { [STATE_KEY]: true, depth };
}

function currentDepth() {
  const state = window.history.state;
  if (isAppHistoryState(state) && typeof state.depth === "number") {
    return state.depth;
  }
  return 0;
}

/**
 * @param {string} path
 * @param {string} suffix search + hash to keep (auth codes / recovery)
 */
function replaceWith(path, suffix = "") {
  window.history.replaceState(makeState(currentDepth()), "", path + suffix);
}

/**
 * @param {AppRoute} route
 * @param {string} reason
 */
async function emit(route, reason) {
  if (typeof routeListener !== "function") return;
  await routeListener(route, { reason });
}

/**
 * @param {{ onRoute: (route: AppRoute, meta: { reason: string }) => void | Promise<void> }} options
 * @returns {Promise<void>}
 */
export async function startAppRouter(options) {
  routeListener = options.onRoute;
  if (!started) {
    started = true;
    window.addEventListener("popstate", () => {
      const { route, path, needsReplace } = canonicalizeAppPath(window.location.pathname);
      if (needsReplace) {
        replaceWith(path);
      }
      void emit(route, "pop");
    });
  }

  const { route, path, needsReplace } = canonicalizeAppPath(window.location.pathname);
  const suffix = `${window.location.search || ""}${window.location.hash || ""}`;
  if (needsReplace || !isAppHistoryState(window.history.state)) {
    window.history.replaceState(makeState(0), "", (needsReplace ? path : window.location.pathname) + suffix);
  }
  await emit(route, "init");
}

/**
 * Navigate to a main-view path. Pushes history unless `replace` is set.
 * @param {string} path
 * @param {{ replace?: boolean }} [options]
 */
export function navigateApp(path, options = {}) {
  const { route, path: canonical } = canonicalizeAppPath(path);
  const replace = Boolean(options.replace);
  const current = window.location.pathname || "/";
  if (canonical === current && !replace) {
    void emit(route, "same");
    return;
  }
  if (replace) {
    replaceWith(canonical);
  } else {
    window.history.pushState(makeState(currentDepth() + 1), "", canonical);
  }
  void emit(route, replace ? "replace" : "push");
}

/**
 * In-app back: pop if this visit created later app entries; otherwise replace
 * with a parent view so a direct URL does not dump the user onto another site.
 * @param {string} fallbackPath
 */
export function backAppOr(fallbackPath) {
  if (currentDepth() > 0) {
    window.history.back();
    return;
  }
  navigateApp(fallbackPath, { replace: true });
}

/**
 * Auth logout / similar: put the URL on home without applying a view.
 */
export function resetAppUrlHome() {
  window.history.replaceState(makeState(0), "", "/");
}

/** @returns {AppRoute} */
export function routeFromLocation() {
  return parseAppPath(window.location.pathname || "/");
}

export function isAppRouterStarted() {
  return started;
}
