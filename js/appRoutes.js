/**
 * Pathname routes for main AnglrLog views. Temporary UI (dialogs, catch steps)
 * stays out of the URL.
 * @module appRoutes
 */

/** @typedef {"feed" | "map" | "session" | "profile"} AppTabId */

/**
 * @typedef {
 *   | { name: "feed" }
 *   | { name: "map" }
 *   | { name: "session" }
 *   | { name: "profile" }
 *   | { name: "stats" }
 *   | { name: "friends" }
 *   | { name: "userProfile", userId: string }
 *   | { name: "userStats", userId: string }
 *   | { name: "sessionDetail", sessionId: string }
 *   | { name: "unknown" }
 * } AppRoute
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * @param {string} value
 * @returns {boolean}
 */
function isRouteUuid(value) {
  return UUID_RE.test(value);
}

/**
 * @param {string} pathname
 * @returns {string[]}
 */
function pathSegments(pathname) {
  const raw = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return raw.split("/").filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
}

/**
 * @param {string} pathname
 * @returns {AppRoute}
 */
export function parseAppPath(pathname) {
  const parts = pathSegments(pathname || "/");
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "index.html")) {
    return { name: "session" };
  }
  if (parts.length === 1) {
    const a = parts[0];
    if (a === "feed") return { name: "feed" };
    if (a === "map") return { name: "map" };
    if (a === "session") return { name: "session" };
    if (a === "profile") return { name: "profile" };
    if (a === "stats") return { name: "stats" };
    if (a === "friends") return { name: "friends" };
    return { name: "unknown" };
  }
  if (parts[0] === "session" && parts.length === 2 && parts[1]) {
    return { name: "sessionDetail", sessionId: parts[1] };
  }
  if (parts[0] === "profile" && parts.length === 2 && isRouteUuid(parts[1])) {
    return { name: "userProfile", userId: parts[1] };
  }
  if (
    parts[0] === "profile" &&
    parts.length === 3 &&
    isRouteUuid(parts[1]) &&
    parts[2] === "stats"
  ) {
    return { name: "userStats", userId: parts[1] };
  }
  return { name: "unknown" };
}

/**
 * Canonical path for a parsed route. Unknown routes map to session home.
 * @param {AppRoute} route
 * @returns {string}
 */
export function serializeAppRoute(route) {
  switch (route.name) {
    case "feed":
      return "/feed";
    case "map":
      return "/map";
    case "profile":
      return "/profile";
    case "stats":
      return "/stats";
    case "friends":
      return "/friends";
    case "userProfile":
      return `/profile/${encodeURIComponent(route.userId)}`;
    case "userStats":
      return `/profile/${encodeURIComponent(route.userId)}/stats`;
    case "sessionDetail":
      return `/session/${encodeURIComponent(route.sessionId)}`;
    case "session":
    default:
      return "/";
  }
}

/**
 * @param {string} pathname
 * @returns {{ route: Exclude<AppRoute, { name: "unknown" }>, path: string, needsReplace: boolean }}
 */
export function canonicalizeAppPath(pathname) {
  const parsed = parseAppPath(pathname);
  const route = parsed.name === "unknown" ? { name: /** @type {const} */ ("session") } : parsed;
  const path = serializeAppRoute(route);
  const current = pathname.split("?")[0] || "/";
  return { route, path, needsReplace: current !== path };
}

/**
 * @param {AppTabId} tab
 * @returns {string}
 */
export function pathForAppTab(tab) {
  if (tab === "feed") return "/feed";
  if (tab === "map") return "/map";
  if (tab === "profile") return "/profile";
  return "/";
}

/**
 * @param {string} sessionId
 * @returns {string}
 */
export function pathForSessionDetail(sessionId) {
  return serializeAppRoute({ name: "sessionDetail", sessionId });
}

/**
 * @param {string} userId
 * @returns {string}
 */
export function pathForUserProfile(userId) {
  return serializeAppRoute({ name: "userProfile", userId });
}

/**
 * @param {string} userId
 * @returns {string}
 */
export function pathForUserStats(userId) {
  return serializeAppRoute({ name: "userStats", userId });
}

/** @returns {string} */
export function pathForFriends() {
  return "/friends";
}

/**
 * Bottom-nav tab that should appear active for this route.
 * @param {AppRoute} route
 * @returns {AppTabId}
 */
export function tabIdForRoute(route) {
  if (route.name === "feed") return "feed";
  if (route.name === "map") return "map";
  if (
    route.name === "profile" ||
    route.name === "stats" ||
    route.name === "friends" ||
    route.name === "userProfile" ||
    route.name === "userStats"
  ) {
    return "profile";
  }
  return "session";
}
