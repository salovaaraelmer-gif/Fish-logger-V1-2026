/**
 * Owner-only catch location privacy setting.
 * @module privacySettingsService
 */

import { getAuthUserId } from "./auth.js";
import {
  CATCH_LOCATION_ONLY_ME,
  normalizeCatchLocationPrivacy,
} from "./catchLocationPrivacy.js";
import { supabase } from "./supabase.js";

/**
 * @returns {Promise<{ ok: true, catchLocations: import('./catchLocationPrivacy.js').CatchLocationPrivacy } | { ok: false, error: string }>}
 */
export async function fetchCatchLocationPrivacy() {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const { data, error } = await supabase
    .from("user_privacy_settings")
    .select("catch_locations")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    catchLocations: normalizeCatchLocationPrivacy(data?.catch_locations),
  };
}

/**
 * @param {import('./catchLocationPrivacy.js').CatchLocationPrivacy} value
 */
export async function saveCatchLocationPrivacy(value) {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, error: "Not signed in." };
  const catchLocations = normalizeCatchLocationPrivacy(value);
  const { error } = await supabase.from("user_privacy_settings").upsert(
    {
      user_id: uid,
      catch_locations: catchLocations,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, catchLocations };
}

export { CATCH_LOCATION_ONLY_ME };
