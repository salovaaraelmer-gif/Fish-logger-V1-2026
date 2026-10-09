/**
 * Session-level fishing locations and target species (local IndexedDB + Supabase).
 * Fishing locations are a global shared catalog; target species remain per-user.
 * @module sessionMetadataService
 */

import {
  getAllFishingLocations,
  getAllUserTargetSpecies,
  putFishingLocation,
  putUserTargetSpecies,
  deleteFishingLocation,
  getSessionFishingLocationLinks,
  getSessionTargetSpeciesLinks,
  putSessionFishingLocationLink,
  putSessionTargetSpeciesLink,
  deleteSessionFishingLocationLinksForSession,
  deleteSessionFishingLocationLinksForLocationIds,
  deleteSessionTargetSpeciesLinksForSession,
  getSessionById,
} from "./db.js";
import { getAuthUserId } from "./auth.js";
import { supabase } from "./supabase.js";
import {
  fishingLocationNamesMatch,
  localFishingLocationIdsToRemove,
  normalizeFishingLocationName,
} from "./fishingLocationSyncPolicy.js";
import { formatCatalogItemLabel } from "./catalogLabels.js";

export { formatCatalogItemLabel };

/** @typedef {import('./db.js').FishingLocation} FishingLocation */
/** @typedef {import('./db.js').UserTargetSpecies} UserTargetSpecies */

/** @typedef {{ id: string, name: string, userNumber?: number }} CatalogItemDisplay */

const DEFAULT_TARGET_SPECIES_NAMES = ["Pike", "Zander", "Perch", "Trout", "Salmon"];

function newLocalId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * @param {{ userNumber?: number, name: string }} a
 * @param {{ userNumber?: number, name: string }} b
 */
function sortCatalogItems(a, b) {
  const aNum = typeof a.userNumber === "number";
  const bNum = typeof b.userNumber === "number";
  if (aNum && bNum) {
    return /** @type {number} */ (a.userNumber) - /** @type {number} */ (b.userNumber) ||
      a.name.localeCompare(b.name, "en");
  }
  return a.name.localeCompare(b.name, "en");
}

/**
 * Attach a cloud catalog id to a per-user target-species row, inserting if needed.
 * @param {UserTargetSpecies} row
 * @returns {Promise<string | null>}
 */
async function ensureTargetSpeciesSupabaseId(row) {
  if (row.supabaseId) return row.supabaseId;
  if (!navigator.onLine || !row.userId) return null;
  const ins = await supabase
    .from("user_target_species")
    .insert({ user_id: row.userId, name: row.name, user_number: row.userNumber })
    .select("id")
    .single();
  if (!ins.error && ins.data?.id) {
    const sbId = String(ins.data.id);
    await putUserTargetSpecies({ ...row, supabaseId: sbId });
    return sbId;
  }
  const existing = await supabase
    .from("user_target_species")
    .select("id")
    .eq("user_id", row.userId)
    .eq("name", row.name)
    .maybeSingle();
  if (existing.data?.id) {
    const sbId = String(existing.data.id);
    await putUserTargetSpecies({ ...row, supabaseId: sbId });
    return sbId;
  }
  return null;
}

/**
 * Ensures a global fishing location exists in Supabase (find-or-create).
 * Handles concurrent unique conflicts by resolving to the existing row.
 * @param {string} cleanedName already trimmed
 * @returns {Promise<{ id: string, name: string } | null>}
 */
async function ensureFishingLocationOnCloud(cleanedName) {
  if (!navigator.onLine || !cleanedName) return null;

  const rpc = await supabase.rpc("ensure_fishing_location", { p_name: cleanedName });
  if (!rpc.error) {
    const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    if (row?.id) {
      return { id: String(row.id), name: String(row.name ?? cleanedName) };
    }
  }

  // Fallback if RPC is unavailable: insert, then resolve unique conflicts by normalized name.
  const ins = await supabase
    .from("fishing_locations")
    .insert({ name: cleanedName })
    .select("id, name")
    .single();
  if (!ins.error && ins.data?.id) {
    return { id: String(ins.data.id), name: String(ins.data.name) };
  }

  const existing = await supabase.from("fishing_locations").select("id, name");
  if (existing.error || !existing.data) return null;
  const match = existing.data.find((r) => fishingLocationNamesMatch(String(r.name), cleanedName));
  if (!match?.id) return null;
  return { id: String(match.id), name: String(match.name) };
}

/**
 * @param {FishingLocation} row
 * @returns {Promise<string | null>}
 */
async function ensureFishingLocationSupabaseId(row) {
  if (row.supabaseId) return row.supabaseId;
  if (!navigator.onLine) return null;
  const ensured = await ensureFishingLocationOnCloud(normalizeFishingLocationName(row.name));
  if (!ensured) return null;
  await putFishingLocation({
    id: row.id,
    name: ensured.name,
    supabaseId: ensured.id,
  });
  return ensured.id;
}

/**
 * @param {UserTargetSpecies[]} rows
 * @returns {number}
 */
function nextUserNumber(rows) {
  let max = 0;
  for (const r of rows) {
    if (typeof r.userNumber === "number" && r.userNumber > max) max = r.userNumber;
  }
  return max + 1;
}

/**
 * @param {string} name
 */
function normalizeCatalogName(name) {
  return (name || "").trim();
}

/**
 * @returns {Promise<void>}
 */
export async function ensureDefaultTargetSpeciesCatalog() {
  const uid = await getAuthUserId();
  if (!uid) return;
  const existing = await getAllUserTargetSpecies();
  const mine = existing.filter((r) => r.userId === uid);
  if (mine.length > 0) {
    if (navigator.onLine) {
      for (const row of mine) {
        await ensureTargetSpeciesSupabaseId(row);
      }
    }
    return;
  }
  let n = 1;
  for (const name of DEFAULT_TARGET_SPECIES_NAMES) {
    const row = {
      id: newLocalId(),
      userId: uid,
      name,
      userNumber: n++,
      supabaseId: null,
    };
    await putUserTargetSpecies(row);
    if (navigator.onLine) {
      await ensureTargetSpeciesSupabaseId(row);
    }
  }
}

/**
 * Syncs cloud catalogs into IndexedDB for the signed-in user.
 * Fishing locations: global cloud catalog is authoritative (successful empty clears stale local rows).
 * Target species: merge-only (unchanged seeding / offline create behavior).
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function syncUserCatalogsFromCloud() {
  const uid = await getAuthUserId();
  if (!uid || !navigator.onLine) return { ok: true };

  const [locRes, spRes] = await Promise.all([
    supabase.from("fishing_locations").select("id, name"),
    supabase.from("user_target_species").select("id, name, user_number").eq("user_id", uid),
  ]);

  if (locRes.error) return { ok: false, error: locRes.error.message };
  if (spRes.error) return { ok: false, error: spRes.error.message };

  const localLocs = await getAllFishingLocations();
  const localSp = await getAllUserTargetSpecies();
  const locBySb = new Map(
    localLocs.filter((r) => r.supabaseId).map((r) => [/** @type {string} */ (r.supabaseId), r])
  );
  const spBySb = new Map(
    localSp.filter((r) => r.supabaseId).map((r) => [/** @type {string} */ (r.supabaseId), r])
  );

  const cloudLocRows = locRes.data || [];
  for (const row of cloudLocRows) {
    const sbId = String(row.id);
    const existing = locBySb.get(sbId);
    const item = {
      id: existing?.id ?? sbId,
      name: String(row.name),
      supabaseId: sbId,
    };
    await putFishingLocation(item);
  }

  const staleLocIds = localFishingLocationIdsToRemove(
    localLocs,
    cloudLocRows.map((r) => String(r.id))
  );
  for (const id of staleLocIds) {
    await deleteFishingLocation(id);
  }
  if (staleLocIds.length) {
    await deleteSessionFishingLocationLinksForLocationIds(staleLocIds);
  }

  for (const row of spRes.data || []) {
    const sbId = String(row.id);
    const existing = spBySb.get(sbId);
    const item = {
      id: existing?.id ?? newLocalId(),
      userId: uid,
      name: String(row.name),
      userNumber: Number(row.user_number),
      supabaseId: sbId,
    };
    await putUserTargetSpecies(item);
  }

  return { ok: true };
}

/**
 * @param {"location" | "target"} kind
 * @param {string} rawName
 * @returns {Promise<{ ok: true, item: CatalogItemDisplay } | { ok: false, reason: string }>}
 */
export async function createCatalogItem(kind, rawName) {
  const uid = await getAuthUserId();
  if (!uid) return { ok: false, reason: "Not signed in." };
  const name = normalizeCatalogName(rawName);
  if (!name) return { ok: false, reason: "Enter a name." };

  if (kind === "location") {
    const cleaned = normalizeFishingLocationName(name);
    const all = await getAllFishingLocations();
    const dup = all.find((r) => fishingLocationNamesMatch(r.name, cleaned));
    if (dup) {
      if (navigator.onLine && !dup.supabaseId) {
        await ensureFishingLocationSupabaseId(dup);
      }
      const fresh = (await getAllFishingLocations()).find((r) => r.id === dup.id) || dup;
      return { ok: true, item: { id: fresh.id, name: fresh.name } };
    }

    if (navigator.onLine) {
      const ensured = await ensureFishingLocationOnCloud(cleaned);
      if (ensured) {
        const local = {
          id: ensured.id,
          name: ensured.name,
          supabaseId: ensured.id,
        };
        await putFishingLocation(local);
        return { ok: true, item: { id: local.id, name: local.name } };
      }
    }

    const local = {
      id: newLocalId(),
      name: cleaned,
      supabaseId: null,
    };
    await putFishingLocation(local);
    return { ok: true, item: { id: local.id, name: local.name } };
  }

  const all = (await getAllUserTargetSpecies()).filter((r) => r.userId === uid);
  const dup = all.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (dup) {
    await ensureTargetSpeciesSupabaseId(dup);
    return { ok: true, item: { id: dup.id, name: dup.name, userNumber: dup.userNumber } };
  }
  const userNumber = nextUserNumber(all);
  const local = {
    id: newLocalId(),
    userId: uid,
    name,
    userNumber,
    supabaseId: null,
  };
  await putUserTargetSpecies(local);
  if (navigator.onLine) {
    const ins = await supabase
      .from("user_target_species")
      .insert({ user_id: uid, name, user_number: userNumber })
      .select("id")
      .single();
    if (!ins.error && ins.data?.id) {
      await putUserTargetSpecies({ ...local, supabaseId: String(ins.data.id) });
    }
  }
  return { ok: true, item: { id: local.id, name: local.name, userNumber: local.userNumber } };
}

/**
 * @returns {Promise<{ locations: CatalogItemDisplay[], targets: CatalogItemDisplay[] }>}
 */
export async function getUserCatalogDisplayLists() {
  const uid = await getAuthUserId();
  if (!uid) return { locations: [], targets: [] };
  const [locs, targets] = await Promise.all([getAllFishingLocations(), getAllUserTargetSpecies()]);
  return {
    locations: locs
      .map((r) => ({ id: r.id, name: r.name }))
      .sort(sortCatalogItems),
    targets: targets
      .filter((r) => r.userId === uid)
      .map((r) => ({ id: r.id, name: r.name, userNumber: r.userNumber }))
      .sort(sortCatalogItems),
  };
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ locationIds: string[], targetSpeciesIds: string[] }>}
 */
export async function getSessionSelectedCatalogIds(sessionId) {
  const [locLinks, spLinks] = await Promise.all([
    getSessionFishingLocationLinks(sessionId),
    getSessionTargetSpeciesLinks(sessionId),
  ]);
  return {
    locationIds: locLinks.map((l) => l.locationId),
    targetSpeciesIds: spLinks.map((l) => l.targetSpeciesId),
  };
}

/**
 * @param {string} sessionId
 * @param {string[]} locationIds
 * @param {string[]} targetSpeciesIds
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function setSessionCatalogSelections(sessionId, locationIds, targetSpeciesIds) {
  await deleteSessionFishingLocationLinksForSession(sessionId);
  await deleteSessionTargetSpeciesLinksForSession(sessionId);
  for (const locationId of [...new Set(locationIds)]) {
    await putSessionFishingLocationLink({ id: newLocalId(), sessionId, locationId });
  }
  for (const targetSpeciesId of [...new Set(targetSpeciesIds)]) {
    await putSessionTargetSpeciesLink({ id: newLocalId(), sessionId, targetSpeciesId });
  }
  const session = await getSessionById(sessionId);
  const cloudSid =
    session && typeof session.supabaseSessionId === "string" ? session.supabaseSessionId : null;
  if (cloudSid && navigator.onLine) {
    return syncSessionLinksToCloud(sessionId, cloudSid);
  }
  return { ok: true };
}

/**
 * @param {string} sessionId
 * @param {string} cloudSessionId
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function syncSessionLinksToCloud(sessionId, cloudSessionId) {
  if (!navigator.onLine) return { ok: true };

  const [locLinks, spLinks] = await Promise.all([
    getSessionFishingLocationLinks(sessionId),
    getSessionTargetSpeciesLinks(sessionId),
  ]);
  const allLocs = await getAllFishingLocations();
  const allSp = await getAllUserTargetSpecies();
  const locByLocal = new Map(allLocs.map((r) => [r.id, r]));
  const spByLocal = new Map(allSp.map((r) => [r.id, r]));

  await supabase.from("session_fishing_locations").delete().eq("session_id", cloudSessionId);
  await supabase.from("session_target_species").delete().eq("session_id", cloudSessionId);

  for (const link of locLinks) {
    const cat = locByLocal.get(link.locationId);
    const sbLocId = cat ? await ensureFishingLocationSupabaseId(cat) : null;
    if (sbLocId) {
      const ins = await supabase
        .from("session_fishing_locations")
        .insert({ session_id: cloudSessionId, location_id: sbLocId });
      if (ins.error) return { ok: false, error: ins.error.message };
    }
  }

  for (const link of spLinks) {
    const cat = spByLocal.get(link.targetSpeciesId);
    const sbSpId = cat ? await ensureTargetSpeciesSupabaseId(cat) : null;
    if (sbSpId) {
      const ins = await supabase
        .from("session_target_species")
        .insert({ session_id: cloudSessionId, target_species_id: sbSpId });
      if (ins.error) return { ok: false, error: ins.error.message };
    }
  }

  return { ok: true };
}

/**
 * Pulls session catalog links from cloud into IndexedDB.
 * On a successful fetch, cloud is authoritative — including zero rows.
 * Failed fetch / offline: leave local links untouched.
 * @param {string} localSessionId
 * @param {string} cloudSessionId
 * @returns {Promise<void>}
 */
export async function loadSessionLinksFromCloud(localSessionId, cloudSessionId) {
  if (!navigator.onLine) return;

  const [locRes, spRes] = await Promise.all([
    supabase
      .from("session_fishing_locations")
      .select("location_id, fishing_locations ( id, name )")
      .eq("session_id", cloudSessionId),
    supabase
      .from("session_target_species")
      .select("target_species_id, user_target_species ( id, name, user_number )")
      .eq("session_id", cloudSessionId),
  ]);

  // Failed fetch: preserve local IndexedDB (do not clear, do not push).
  if (locRes.error || spRes.error) return;

  const uid = await getAuthUserId();
  if (!uid) return;

  // Successful empty cloud links are authoritative — do not push stale IndexedDB back.
  const cloudLocRows = locRes.data || [];
  const cloudSpRows = spRes.data || [];

  await deleteSessionFishingLocationLinksForSession(localSessionId);
  await deleteSessionTargetSpeciesLinksForSession(localSessionId);

  const allLocs = await getAllFishingLocations();
  const allSp = await getAllUserTargetSpecies();

  for (const row of cloudLocRows) {
    const embed = row.fishing_locations;
    const cloud = Array.isArray(embed) ? embed[0] : embed;
    if (!cloud || typeof cloud !== "object") continue;
    const c = /** @type {{ id: string, name: string }} */ (cloud);
    let local = allLocs.find((r) => r.supabaseId === c.id || r.id === c.id);
    if (!local) {
      local = {
        id: String(c.id),
        name: String(c.name),
        supabaseId: String(c.id),
      };
      await putFishingLocation(local);
      allLocs.push(local);
    }
    await putSessionFishingLocationLink({
      id: newLocalId(),
      sessionId: localSessionId,
      locationId: local.id,
    });
  }

  for (const row of cloudSpRows) {
    const embed = row.user_target_species;
    const cloud = Array.isArray(embed) ? embed[0] : embed;
    if (!cloud || typeof cloud !== "object") continue;
    const c = /** @type {{ id: string, name: string, user_number: number }} */ (cloud);
    let local = allSp.find((r) => r.supabaseId === c.id);
    if (!local) {
      local = {
        id: newLocalId(),
        userId: uid,
        name: String(c.name),
        userNumber: Number(c.user_number),
        supabaseId: String(c.id),
      };
      await putUserTargetSpecies(local);
      allSp.push(local);
    }
    await putSessionTargetSpeciesLink({
      id: newLocalId(),
      sessionId: localSessionId,
      targetSpeciesId: local.id,
    });
  }
}

/**
 * @typedef {{ locationNames: string[], targetNames: string[] }} SessionMetadataDisplay
 */

/**
 * @param {string[]} sessionIds
 * @returns {Promise<Map<string, SessionMetadataDisplay>>}
 */
export async function getSessionMetadataDisplayBySessionIds(sessionIds) {
  /** @type {Map<string, SessionMetadataDisplay>} */
  const out = new Map();
  const unique = [...new Set(sessionIds.filter(Boolean))];
  if (unique.length === 0) return out;

  const [allLocs, allSp] = await Promise.all([getAllFishingLocations(), getAllUserTargetSpecies()]);
  const locById = new Map(allLocs.map((r) => [r.id, r]));
  const spById = new Map(allSp.map((r) => [r.id, r]));

  await Promise.all(
    unique.map(async (sessionId) => {
      const [locLinks, spLinks] = await Promise.all([
        getSessionFishingLocationLinks(sessionId),
        getSessionTargetSpeciesLinks(sessionId),
      ]);
      const locationNames = locLinks
        .map((l) => locById.get(l.locationId))
        .filter(Boolean)
        .map((r) => /** @type {FishingLocation} */ (r).name)
        .sort((a, b) => a.localeCompare(b, "en"));
      const targetNames = spLinks
        .map((l) => spById.get(l.targetSpeciesId))
        .filter(Boolean)
        .map((r) => /** @type {UserTargetSpecies} */ (r).name)
        .sort((a, b) => a.localeCompare(b, "en"));
      out.set(sessionId, { locationNames, targetNames });
    })
  );

  return out;
}

