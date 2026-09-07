/**
 * Catch GPS privacy keys. Friendship visibility is separate.
 * @module catchLocationPrivacy
 */

export const CATCH_LOCATION_ONLY_ME = "only_me";
export const CATCH_LOCATION_FRIENDS = "friends";

/** @typedef {typeof CATCH_LOCATION_ONLY_ME | typeof CATCH_LOCATION_FRIENDS} CatchLocationPrivacy */

/**
 * @param {unknown} value
 * @returns {CatchLocationPrivacy}
 */
export function normalizeCatchLocationPrivacy(value) {
  return value === CATCH_LOCATION_FRIENDS ? CATCH_LOCATION_FRIENDS : CATCH_LOCATION_ONLY_ME;
}

/**
 * Friends may see exact coordinates only when the owner chose Friends.
 * Session participants are handled in the database, not here.
 * @param {CatchLocationPrivacy} ownerSetting
 * @param {boolean} viewerIsAcceptedFriend
 * @param {boolean} viewerIsOwner
 */
export function friendMaySeeCatchCoordinates(ownerSetting, viewerIsAcceptedFriend, viewerIsOwner) {
  if (viewerIsOwner) return true;
  if (!viewerIsAcceptedFriend) return false;
  return normalizeCatchLocationPrivacy(ownerSetting) === CATCH_LOCATION_FRIENDS;
}
