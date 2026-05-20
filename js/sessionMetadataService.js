/**
 * Session-level fishing locations and target species (local IndexedDB + Supabase).
 * @module sessionMetadataService
 */

import {
  getAllUserFishingLocations,
  getAllUserTargetSpecies,
  putUserFishingLocation,
  putUserTargetSpecies,
  getSessionFishingLocationLinks,
  getSessionTargetSpeciesLinks,
  putSessionFishingLocationLink,
  putSessionTargetSpeciesLink,
  deleteSessionFishingLocationLinksForSession,
  deleteSessionTargetSpeciesLinksForSession,
  getSessionById,
} from "./db.js";
import { getAuthUserId } from "./auth.js";
import { supabase } from "./supabase.js";

/** @typedef {import('./db.js').UserFishingLocation} UserFishingLocation */
/** @typedef {import('./db.js').UserTargetSpecies} UserTargetSpecies */

/** @typedef {{ id: string, name: string, userNumber: number }} CatalogItemDisplay */

const DEFAULT_TARGET_SPECIES_NAMES = ["Pike", "Zander", "Perch", "Trout", "Salmon"];

function newLocalId() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * @param {{ userNumber: number, name: string }} a
 * @param {{ userNumber: number, name: string }} b
 */
function sortByUserNumber(a, b) {
  return a.userNumber - b.userNumber || a.name.localeCompare(b.name, "fi");
}

/**
 * @param {UserFishingLocation[] | UserTargetSpecies[]} rows
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
  if (mine.length > 0) return;
  let n = 1;
  for (const name of DEFAULT_TARGET_SPECIES_NAMES) {
    await putUserTargetSpecies({
      id: newLocalId(),
      userId: uid,
      name,
      userNumber: n++,
      supabaseId: null,
    });
  }
  if (navigator.onLine) {
    await syncUserCatalogsFromCloud();
  }
}

/**
 * Merges cloud catalog rows into IndexedDB for the signed-in user.
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function syncUserCatalogsFromCloud() {
  const uid = await getAuthUserId();
  if (!uid || !navigator.onLine) return { ok: true };

  const [locRes, spRes] = await Promise.all([
    supabase.from("user_fishing_locations").select("id, name, user_number").eq("user_id", uid),
    supabase.from("user_target_species").select("id, name, user_number").eq("user_id", uid),
  ]);

  if (locRes.error) return { ok: false, error: locRes.error.message };
  if (spRes.error) return { ok: false, error: spRes.error.message };

  const localLocs = await getAllUserFishingLocations();
  const localSp = await getAllUserTargetSpecies();
  const locBySb = new Map(
    localLocs.filter((r) => r.supabaseId).map((r) => [/** @type {string} */ (r.supabaseId), r])
  );
  const spBySb = new Map(
    localSp.filter((r) => r.supabaseId).map((r) => [/** @type {string} */ (r.supabaseId), r])
  );

  for (const row of locRes.data || []) {
    const sbId = String(row.id);
    const existing = locBySb.get(sbId);
    const item = {
      id: existing?.id ?? newLocalId(),
      userId: uid,
      name: String(row.name),
      userNumber: Number(row.user_number),
      supabaseId: sbId,
    };
    await putUserFishingLocation(item);
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
  if (!uid) return { ok: false, reason: "Kirjautuminen puuttuu." };
  const name = normalizeCatalogName(rawName);
  if (!name) return { ok: false, reason: "Anna nimi." };

  if (kind === "location") {
    const all = (await getAllUserFishingLocations()).filter((r) => r.userId === uid);
    const dup = all.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (dup) {
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
    await putUserFishingLocation(local);
    if (navigator.onLine) {
      const ins = await supabase
        .from("user_fishing_locations")
        .insert({ user_id: uid, name, user_number: userNumber })
        .select("id")
        .single();
      if (!ins.error && ins.data?.id) {
        await putUserFishingLocation({ ...local, supabaseId: String(ins.data.id) });
      }
    }
    return { ok: true, item: { id: local.id, name: local.name, userNumber: local.userNumber } };
  }

  const all = (await getAllUserTargetSpecies()).filter((r) => r.userId === uid);
  const dup = all.find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (dup) {
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
  const [locs, targets] = await Promise.all([getAllUserFishingLocations(), getAllUserTargetSpecies()]);
  return {
    locations: locs
      .filter((r) => r.userId === uid)
      .map((r) => ({ id: r.id, name: r.name, userNumber: r.userNumber }))
      .sort(sortByUserNumber),
    targets: targets
      .filter((r) => r.userId === uid)
      .map((r) => ({ id: r.id, name: r.name, userNumber: r.userNumber }))
      .sort(sortByUserNumber),
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
  const allLocs = await getAllUserFishingLocations();
  const allSp = await getAllUserTargetSpecies();
  const locByLocal = new Map(allLocs.map((r) => [r.id, r]));
  const spByLocal = new Map(allSp.map((r) => [r.id, r]));

  await supabase.from("session_fishing_locations").delete().eq("session_id", cloudSessionId);
  await supabase.from("session_target_species").delete().eq("session_id", cloudSessionId);

  for (const link of locLinks) {
    const cat = locByLocal.get(link.locationId);
    let sbLocId = cat?.supabaseId;
    if (!sbLocId && cat) {
      const created = await createCatalogItem("location", cat.name);
      if (created.ok) {
        const refreshed = (await getAllUserFishingLocations()).find((r) => r.id === created.item.id);
        sbLocId = refreshed?.supabaseId ?? null;
      }
    }
    if (sbLocId) {
      const ins = await supabase
        .from("session_fishing_locations")
        .insert({ session_id: cloudSessionId, location_id: sbLocId });
      if (ins.error) return { ok: false, error: ins.error.message };
    }
  }

  for (const link of spLinks) {
    const cat = spByLocal.get(link.targetSpeciesId);
    let sbSpId = cat?.supabaseId;
    if (!sbSpId && cat) {
      const created = await createCatalogItem("target", cat.name);
      if (created.ok) {
        const refreshed = (await getAllUserTargetSpecies()).find((r) => r.id === created.item.id);
        sbSpId = refreshed?.supabaseId ?? null;
      }
    }
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
 * @param {string} localSessionId
 * @param {string} cloudSessionId
 * @returns {Promise<void>}
 */
export async function loadSessionLinksFromCloud(localSessionId, cloudSessionId) {
  if (!navigator.onLine) return;

  const [locRes, spRes] = await Promise.all([
    supabase
      .from("session_fishing_locations")
      .select("location_id, user_fishing_locations ( id, name, user_number )")
      .eq("session_id", cloudSessionId),
    supabase
      .from("session_target_species")
      .select("target_species_id, user_target_species ( id, name, user_number )")
      .eq("session_id", cloudSessionId),
  ]);

  if (locRes.error || spRes.error) return;

  const uid = await getAuthUserId();
  if (!uid) return;

  await deleteSessionFishingLocationLinksForSession(localSessionId);
  await deleteSessionTargetSpeciesLinksForSession(localSessionId);

  const allLocs = await getAllUserFishingLocations();
  const allSp = await getAllUserTargetSpecies();

  for (const row of locRes.data || []) {
    const embed = row.user_fishing_locations;
    const cloud = Array.isArray(embed) ? embed[0] : embed;
    if (!cloud || typeof cloud !== "object") continue;
    const c = /** @type {{ id: string, name: string, user_number: number }} */ (cloud);
    let local = allLocs.find((r) => r.supabaseId === c.id);
    if (!local) {
      local = {
        id: newLocalId(),
        userId: uid,
        name: String(c.name),
        userNumber: Number(c.user_number),
        supabaseId: String(c.id),
      };
      await putUserFishingLocation(local);
    }
    await putSessionFishingLocationLink({
      id: newLocalId(),
      sessionId: localSessionId,
      locationId: local.id,
    });
  }

  for (const row of spRes.data || []) {
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

  const [allLocs, allSp] = await Promise.all([getAllUserFishingLocations(), getAllUserTargetSpecies()]);
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
        .map((r) => /** @type {UserFishingLocation} */ (r).name)
        .sort((a, b) => a.localeCompare(b, "fi"));
      const targetNames = spLinks
        .map((l) => spById.get(l.targetSpeciesId))
        .filter(Boolean)
        .map((r) => /** @type {UserTargetSpecies} */ (r).name)
        .sort((a, b) => a.localeCompare(b, "fi"));
      out.set(sessionId, { locationNames, targetNames });
    })
  );

  return out;
}

/**
 * @param {CatalogItemDisplay} item
 * @returns {string}
 */
export function formatCatalogItemLabel(item) {
  return `${item.userNumber} — ${item.name}`;
}
