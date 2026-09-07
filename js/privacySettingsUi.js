/**
 * Settings → Privacy → Catch locations.
 * @module privacySettingsUi
 */

import {
  CATCH_LOCATION_FRIENDS,
  CATCH_LOCATION_ONLY_ME,
} from "./catchLocationPrivacy.js";
import {
  fetchCatchLocationPrivacy,
  saveCatchLocationPrivacy,
} from "./privacySettingsService.js";

let wired = false;
/** @param {string} msg */
let onError = (msg) => console.error(msg);

/**
 * @param {{ onError?: (msg: string) => void }} [options]
 */
export function wirePrivacySettingsUi(options = {}) {
  if (wired) return;
  wired = true;
  if (typeof options.onError === "function") onError = options.onError;
  document.getElementById("privacy-catch-locations")?.addEventListener("change", async (event) => {
    const t = event.target;
    if (!(t instanceof HTMLInputElement) || t.name !== "privacy-catch-locations") return;
    const saved = await saveCatchLocationPrivacy(
      t.value === CATCH_LOCATION_FRIENDS ? CATCH_LOCATION_FRIENDS : CATCH_LOCATION_ONLY_ME
    );
    if (!saved.ok) onError(saved.error);
  });
}

export async function loadPrivacySettingsUi() {
  const res = await fetchCatchLocationPrivacy();
  const value = res.ok ? res.catchLocations : CATCH_LOCATION_ONLY_ME;
  document.querySelectorAll('input[name="privacy-catch-locations"]').forEach((el) => {
    if (el instanceof HTMLInputElement) el.checked = el.value === value;
  });
}
