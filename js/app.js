/**
 * Fish Logger V1 — UI and wiring.
 */

import {
  putAngler,
  getSessionAnglersForSession,
  getSessionById,
  getSessionBySupabaseCloudId,
  getAllEndedSessions,
  getCatchesForSession,
  getCatchById,
  putCatch,
  putSession,
  putSessionAngler,
  findSessionAngler,
  deleteCatch,
  deleteSessionCascade,
  setIndexedDbUserId,
  purgeLegacyFishLoggerDatabase,
} from "./db.js";
import {
  startSession,
  endActiveSession,
  markAnglerInactive,
  markSessionCsvExportedById,
  saveActiveSessionTitle,
  newId,
} from "./sessionService.js";
import { defaultSessionTitleFromDate, getSessionDisplayTitle } from "./sessionTitle.js";
import {
  buildSessionCatchesCsv,
  defaultFishLogFilename,
  triggerCsvDownload,
} from "./csvExport.js";
import {
  SPECIES_OPTIONS,
  saveCatch,
  updateCatch,
  fetchDeviceLocationBestEffort,
  parseOptionalLengthCm,
  parseOptionalDepthM,
  parseOptionalWaterTempC,
  parseOptionalWeightKg,
} from "./catchService.js";
import { supabase } from "./supabase.js";
import {
  getDisplayNameFromUser,
  getAuthUserId,
  signInWithEmail,
  signUpWithProfile,
  sendPasswordResetEmail,
  updatePassword,
  formatAuthErrorForUi,
} from "./auth.js";
import {
  upsertProfileForUser,
  fetchProfileDisplayNames,
  searchProfiles,
  profileDisplayLabel,
} from "./supabaseProfile.js";
import { closeProfileOverlay, wireProfileUi } from "./profileUI.js";
import {
  catchRecordToSupabasePayload,
  insertSupabaseCatch,
  updateSupabaseCatch,
  deleteSupabaseCatch,
} from "./supabaseCatchSync.js";
import {
  fetchSessionAnglerIdBySessionAndUser,
  insertSessionScopedAnglers,
} from "./legacyAnglers.js";
import { fetchParticipantSessionsForUser } from "./supabaseParticipantSessions.js";
import {
  setParticipantSessionFetchResult,
  getActiveSessionForParticipantUi,
  getLastParticipantRehydrateOk,
  getParticipantEndedCloudRows,
} from "./participantSessionCache.js";
import { pullSessionRosterAndCatchesFromCloud } from "./supabaseParticipantSync.js";

/** @type {Record<string, string>} */
const SPECIES_LABELS = {
  pike: "Hauki",
  perch: "Ahven",
  zander: "Kuha",
  trout: "Taimen",
  other: "Muu",
};

/**
 * App species key → value stored in `public.catches.species`.
 * Must match your DB (including any CHECK on `species`). See `SUPABASE_CATCHES_SCHEMA.md`.
 */
const SPECIES_KEY_TO_SUPABASE = {
  pike: "pike",
  perch: "perch",
  zander: "zander",
  trout: "trout",
  other: "other",
};

/**
 * @param {string | null | undefined} speciesKey
 * @returns {string | null}
 */
function mapSpeciesKeyToSupabaseSpecies(speciesKey) {
  if (!speciesKey) return null;
  return SPECIES_KEY_TO_SUPABASE[speciesKey] ?? null;
}

/**
 * Resolves session-scoped `public.anglers.id` by (`session_id`, `user_id`). Uses `cloudSessionId` or active cloud session.
 * @param {string} profileUserId — participant profile / auth id
 * @param {string | null | undefined} [cloudSessionId] — defaults to `activeSupabaseSessionId`
 * @returns {Promise<string | null>}
 */
async function resolveLegacyAnglerIdForCloudCatch(profileUserId, cloudSessionId) {
  const sid = cloudSessionId || activeSupabaseSessionId;
  if (!sid) return null;
  const id = await fetchSessionAnglerIdBySessionAndUser(sid, profileUserId);
  if (id) {
    supabaseAnglerRowByLocalId.set(profileUserId, { id });
  }
  return id;
}

/**
 * Adds roster rows in `session_anglers` for selected anglers whose local id matches a `profiles.id`.
 * @param {string} cloudSessionId
 * @param {string[]} selectedLocalAnglerIds
 * @returns {Promise<{ ok: true, profileIds: string[] } | { ok: false, error: string }>}
 */
async function insertSessionAnglersForSelectedProfiles(cloudSessionId, selectedLocalAnglerIds) {
  const candidates = [...new Set(selectedLocalAnglerIds)];
  const profileIds = [];
  for (const user_id of candidates) {
    const { data, error } = await supabase
      .from("session_anglers")
      .insert({ session_id: cloudSessionId, user_id })
      .select("user_id")
      .maybeSingle();
    if (!error && data && typeof data.user_id === "string") {
      profileIds.push(data.user_id);
      continue;
    }
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const msg = error && typeof error.message === "string" ? error.message.toLowerCase() : "";
    if (code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
      profileIds.push(user_id);
      continue;
    }
    if (code === "23503" || msg.includes("foreign key")) {
      continue;
    }
    if (error) {
      console.error("[Supabase] session_anglers insert failed:", error);
      return { ok: false, error: error.message || "session_anglers insert failed" };
    }
  }
  return { ok: true, profileIds };
}

/**
 * Session-scoped `public.anglers.id` for deletes / best-effort ops.
 * @param {string} localAnglerId
 * @param {string} localSessionId
 * @returns {Promise<string | null>}
 */
async function resolveSupabaseAnglerId(localAnglerId, localSessionId) {
  const sess = await getSessionById(localSessionId);
  const cloudSid =
    sess && typeof sess.supabaseSessionId === "string" && sess.supabaseSessionId
      ? sess.supabaseSessionId
      : null;
  const resolved = await resolveLegacyAnglerIdForCloudCatch(localAnglerId, cloudSid);
  if (resolved) return resolved;
  const sa = await findSessionAngler(localSessionId, localAnglerId);
  if (typeof sa?.supabaseAnglerId === "string" && sa.supabaseAnglerId) {
    return sa.supabaseAnglerId;
  }
  return null;
}

/**
 * Deletes a catch in Supabase when possible, then caller removes the local row.
 * @param {import('./db.js').CatchRecord} c
 * @returns {Promise<boolean>} false = stop (showed error); true = safe to delete locally
 */
async function deleteCatchFromSupabaseBestEffort(c) {
  const remoteId = c.supabase_id;
  if (typeof remoteId === "string" && remoteId.length > 0) {
    if (!navigator.onLine) {
      setSyncStatus("offline");
      showError("Offline.");
      return false;
    }
    setSyncStatus("syncing");
    const delSb = await deleteSupabaseCatch(remoteId);
    if (!delSb.ok) {
      setSyncStatus("error");
      showError(`Supabase-poisto epäonnistui: ${delSb.error}`);
      return false;
    }
    setSyncStatus("synced");
    return true;
  }
  if (!c.sessionId) return true;
  const sess = await getSessionById(c.sessionId);
  const sbSessionId =
    sess && typeof sess.supabaseSessionId === "string" && sess.supabaseSessionId
      ? sess.supabaseSessionId
      : null;
  const speciesForDb = mapSpeciesKeyToSupabaseSpecies(c.species);
  const sbAnglerId = await resolveSupabaseAnglerId(c.anglerId, c.sessionId);
  if (!sbSessionId || !sbAnglerId || !speciesForDb) {
    return true;
  }
  if (!navigator.onLine) {
    setSyncStatus("offline");
    showError("Offline.");
    return false;
  }
  setSyncStatus("syncing");
  const caughtAt = new Date(c.timestamp).toISOString();
  const { error } = await supabase
    .from("catches")
    .delete()
    .eq("session_id", sbSessionId)
    .eq("angler_id", sbAnglerId)
    .eq("caught_at", caughtAt)
    .eq("species", speciesForDb);
  if (error) {
    setSyncStatus("error");
    showError(`Supabase-poisto epäonnistui: ${error.message}`);
    return false;
  }
  setSyncStatus("synced");
  return true;
}

/**
 * Finds `public.sessions.id` when the local row has no `supabaseSessionId` (older data, failed persist).
 * Matches sessions where the current user appears in `session_anglers`, by `title` and closest `created_at`.
 * @param {import('./db.js').Session} s
 * @returns {Promise<string | null>}
 */
async function resolveCloudSessionIdForLocalSession(s) {
  if (typeof s.supabaseSessionId === "string" && s.supabaseSessionId) {
    return s.supabaseSessionId;
  }
  const uid = await getAuthUserId();
  if (!uid || !navigator.onLine) return null;
  const title =
    typeof s.title === "string" && s.title.trim()
      ? s.title.trim()
      : defaultSessionTitleFromDate(s.startTime);

  const { data: rows, error } = await supabase.from("session_anglers").select(
    `
      session_id,
      sessions!inner ( id, created_at, title )
    `
  ).eq("user_id", uid);

  if (error) {
    console.warn("[Session] cloud id lookup (participant):", error.message);
    return null;
  }

  const list = Array.isArray(rows) ? rows : [];
  /** @type {{ id: string, created_at?: string | null }[]} */
  const matching = [];
  for (const row of list) {
    const sess = row && typeof row === "object" && "sessions" in row ? row.sessions : null;
    if (!sess || typeof sess !== "object") continue;
    const sObj = /** @type {{ id?: string, created_at?: string | null, title?: string | null }} */ (sess);
    const t = typeof sObj.title === "string" ? sObj.title.trim() : "";
    if (t === title && typeof sObj.id === "string" && sObj.id) {
      matching.push({ id: sObj.id, created_at: sObj.created_at ?? null });
    }
  }
  if (matching.length === 0) return null;
  if (matching.length === 1) return matching[0].id;
  const startMs = s.startTime;
  let bestId = /** @type {string | null} */ (null);
  let bestDelta = Infinity;
  for (const row of matching) {
    if (!row.created_at) continue;
    const d = Math.abs(new Date(row.created_at).getTime() - startMs);
    if (d < bestDelta) {
      bestDelta = d;
      bestId = row.id;
    }
  }
  if (bestId != null && bestDelta < 20 * 60 * 1000) {
    return bestId;
  }
  return matching[0].id;
}

/**
 * Removes cloud rows for a session using the Supabase session UUID, then local IndexedDB cascade.
 * `session_anglers` rows are removed by `ON DELETE CASCADE` when the session row is deleted.
 * @param {string} localSessionId
 * @returns {Promise<boolean>}
 */
async function deleteSessionCloudThenLocal(localSessionId) {
  const s = await getSessionById(localSessionId);
  if (!s) {
    showError("Sessiota ei löytynyt.");
    return false;
  }
  let cloudSid =
    typeof s.supabaseSessionId === "string" && s.supabaseSessionId ? s.supabaseSessionId : null;
  if (!cloudSid) {
    const resolved = await resolveCloudSessionIdForLocalSession(s);
    if (resolved) {
      cloudSid = resolved;
      await putSession({ ...s, supabaseSessionId: resolved });
    }
  }
  if (cloudSid) {
    if (!navigator.onLine) {
      showError("Yhteys puuttuu. Pilvestä poistaminen ei onnistu.");
      return false;
    }
    const uid = await getAuthUserId();
    if (!uid) {
      showError("Kirjautuminen puuttuu.");
      return false;
    }
    // RLS policies use user_id; filter explicitly so deletes match rows. Use .select() to verify row counts.
    const cRes = await supabase
      .from("catches")
      .delete()
      .eq("session_id", cloudSid)
      .eq("user_id", uid)
      .select("id");
    if (cRes.error) {
      console.error("[Session] cloud delete catches:", cRes.error);
      showError(`Pilvi (saaliit): ${cRes.error.message}`);
      return false;
    }
    const sRes = await supabase
      .from("sessions")
      .delete()
      .eq("id", cloudSid)
      .eq("user_id", uid)
      .select("id");
    if (sRes.error) {
      console.error("[Session] cloud delete session:", sRes.error);
      showError(`Pilvi (sessio): ${sRes.error.message}`);
      return false;
    }
    if (!sRes.data || sRes.data.length === 0) {
      showError(
        "Pilvestä ei poistunut sessioriviä (0 riviä). Tarkista: RLS DELETE -politiikat ja että riveillä on user_id = kirjautunut käyttäjä."
      );
      return false;
    }
  } else {
    const proceed = window.confirm(
      "Pilvi-sessiota ei löytynyt (ei tallennettua tunnistetta). Poistetaanko vain tästä laitteesta? Supabase-rivit jäävät ellei poista niitä käsin."
    );
    if (!proceed) return false;
  }
  await deleteSessionCascade(localSessionId);
  return true;
}

/**
 * Restores in-memory Supabase sync state from IndexedDB after reload. Without this,
 * `activeSupabaseSessionId` and angler UUIDs were only in RAM, so catches never synced.
 */
async function rehydrateSupabaseSessionContext() {
  const session = await getActiveSessionForParticipantUi();
  if (!session || session.endTime != null) {
    activeSupabaseSessionId = null;
    activeSupabaseAnglerRows = null;
    supabaseAnglerRowByLocalId.clear();
    return;
  }
  const cloudSid =
    typeof session.supabaseSessionId === "string" && session.supabaseSessionId
      ? session.supabaseSessionId
      : null;
  if (!cloudSid) {
    activeSupabaseSessionId = null;
    activeSupabaseAnglerRows = null;
    supabaseAnglerRowByLocalId.clear();
    return;
  }
  activeSupabaseSessionId = cloudSid;
  activeSupabaseAnglerRows = null;
  supabaseAnglerRowByLocalId.clear();
  const sas = await getSessionAnglersForSession(session.id);
  for (const sa of sas) {
    const scoped = await fetchSessionAnglerIdBySessionAndUser(cloudSid, sa.anglerId);
    if (scoped) {
      supabaseAnglerRowByLocalId.set(sa.anglerId, { id: scoped });
      if (typeof sa.supabaseAnglerId !== "string" || sa.supabaseAnglerId !== scoped) {
        await putSessionAngler({ ...sa, supabaseAnglerId: scoped });
      }
    } else if (typeof sa.supabaseAnglerId === "string" && sa.supabaseAnglerId) {
      supabaseAnglerRowByLocalId.set(sa.anglerId, { id: sa.supabaseAnglerId });
    }
  }
}

/**
 * Insert catch to Supabase and persist returned id on the local row.
 * @param {import('./db.js').CatchRecord} record
 * @returns {Promise<null | { ok: true } | { ok: false, error: string }>}
 */
async function syncCatchCreateToSupabase(record) {
  const speciesForDb = mapSpeciesKeyToSupabaseSpecies(record.species);
  if (!activeSupabaseSessionId || !speciesForDb) return null;
  const sbAnglerId = await resolveLegacyAnglerIdForCloudCatch(record.anglerId);
  if (!sbAnglerId) {
    return {
      ok: false,
      error:
        "Kalastajalle ei löydy anglers-riviä tälle sessiolle (session_id + user_id). Käynnistä sessio uudelleen tai tarkista pilvi.",
    };
  }
  const authUserId = await getAuthUserId();
  if (!authUserId) {
    return { ok: false, error: "Kirjautuminen puuttuu." };
  }
  if (!navigator.onLine) {
    setSyncStatus("offline");
    return { ok: false, error: "Offline." };
  }
  setSyncStatus("syncing");
  const payload = catchRecordToSupabasePayload(
    record,
    activeSupabaseSessionId,
    sbAnglerId,
    speciesForDb,
    authUserId
  );
  console.log("[catch sync] insert", {
    localSessionId: record.sessionId,
    supabaseSessionId: activeSupabaseSessionId,
    participantUserId: record.anglerId,
    resolvedSessionScopedAnglersId: sbAnglerId,
    payload,
  });
  const ins = await insertSupabaseCatch(payload);
  if (!ins.ok) return { ok: false, error: ins.error };
  await putCatch({ ...record, supabase_id: ins.id });
  return { ok: true };
}

/**
 * @param {import('./db.js').CatchRecord} record
 * @returns {Promise<null | { ok: true } | { ok: false, error: string }>}
 */
async function syncCatchUpdateToSupabase(record) {
  if (!record.supabase_id) return null;
  const speciesForDb = mapSpeciesKeyToSupabaseSpecies(record.species);
  if (!activeSupabaseSessionId || !speciesForDb) {
    return { ok: false, error: "Supabase-sessio tai lajitieto puuttuu." };
  }
  const sbAnglerId = await resolveLegacyAnglerIdForCloudCatch(record.anglerId);
  if (!sbAnglerId) {
    return {
      ok: false,
      error:
        "Kalastajalle ei löydy anglers-riviä tälle sessiolle (session_id + user_id).",
    };
  }
  const authUserId = await getAuthUserId();
  if (!authUserId) {
    return { ok: false, error: "Kirjautuminen puuttuu." };
  }
  if (!navigator.onLine) {
    setSyncStatus("offline");
    return { ok: false, error: "Offline." };
  }
  setSyncStatus("syncing");
  const payload = catchRecordToSupabasePayload(
    record,
    activeSupabaseSessionId,
    sbAnglerId,
    speciesForDb,
    authUserId
  );
  console.log("[catch sync] update", {
    localSessionId: record.sessionId,
    supabaseSessionId: activeSupabaseSessionId,
    participantUserId: record.anglerId,
    resolvedSessionScopedAnglersId: sbAnglerId,
    supabaseCatchId: record.supabase_id,
    payload,
  });
  const res = await updateSupabaseCatch(record.supabase_id, payload);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

/**
 * @param {string} title
 * @returns {Promise<{ ok: true } | { ok: false, error: string } | { skipped: true } | { ok: true, offline: true }>}
 */
async function pushSessionTitleToSupabase(title) {
  if (!activeSupabaseSessionId) return { skipped: true };
  if (!navigator.onLine) {
    sessionTitleNeedsCloudSync = true;
    setSyncStatus("offline");
    return { ok: true, offline: true };
  }
  setSyncStatus("syncing");
  const { error } = await supabase
    .from("sessions")
    .update({ title })
    .eq("id", activeSupabaseSessionId);
  if (error) {
    sessionTitleNeedsCloudSync = true;
    setSyncStatus("error");
    return { ok: false, error: error.message };
  }
  sessionTitleNeedsCloudSync = false;
  setSyncStatus("synced");
  return { ok: true };
}

async function syncPendingSessionTitleToCloud() {
  if (!sessionTitleNeedsCloudSync || !activeSupabaseSessionId) return;
  const s = await getActiveSessionForParticipantUi();
  if (!s) return;
  const title = getSessionDisplayTitle(s);
  await pushSessionTitleToSupabase(title);
}

/**
 * Saves current input to IndexedDB and Supabase; keeps edit mode open.
 * @returns {Promise<string | null>} Resolved title, or null if no session.
 */
async function flushSessionTitleSave() {
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById("session-title-input"));
  if (!input || input.classList.contains("hidden")) return null;
  const r = await saveActiveSessionTitle(input.value);
  if (!r.ok) return null;
  input.value = r.title;
  const cloud = await pushSessionTitleToSupabase(r.title);
  if (cloud && "ok" in cloud && cloud.ok === false && "error" in cloud) {
    showError(`Otsikon synkronointi epäonnistui: ${cloud.error}`);
  }
  return r.title;
}

async function exitSessionTitleEdit() {
  const title = await flushSessionTitleSave();
  sessionTitleEditing = false;
  const display = document.getElementById("session-title-display");
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById("session-title-input"));
  if (!display || !input) return;
  const s = await getActiveSessionForParticipantUi();
  display.textContent = title != null ? title : s ? getSessionDisplayTitle(s) : "";
  input.classList.add("hidden");
  display.classList.remove("hidden");
}

async function beginSessionTitleEdit() {
  const session = await getActiveSessionForParticipantUi();
  if (!session) return;
  const display = document.getElementById("session-title-display");
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById("session-title-input"));
  if (!display || !input) return;
  sessionTitleEditing = true;
  display.classList.add("hidden");
  input.classList.remove("hidden");
  input.value = getSessionDisplayTitle(session);
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

/**
 * @param {import('./db.js').Session} session
 */
function syncSessionTitleHeader(session) {
  const block = document.getElementById("session-title-block");
  const display = document.getElementById("session-title-display");
  if (!block || !display) return;
  block.classList.remove("hidden");
  renderSyncStatusIndicator();
  if (sessionTitleEditing) return;
  display.textContent = getSessionDisplayTitle(session);
}

/**
 * @param {"synced" | "syncing" | "offline" | "error"} next
 */
function setSyncStatus(next) {
  syncStatus = next;
  renderSyncStatusIndicator();
}

function renderSyncStatusIndicator() {
  const el = /** @type {HTMLButtonElement | null} */ (document.getElementById("sync-status-indicator"));
  if (!el) return;
  el.dataset.state = syncStatus;
  let label = "Synced";
  if (syncStatus === "syncing") label = "Syncing";
  if (syncStatus === "offline") label = "Offline";
  if (syncStatus === "error") label = "Error";
  el.title = label;
  el.setAttribute("aria-label", label);
}

function wireSessionTitleEditor() {
  const display = document.getElementById("session-title-display");
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById("session-title-input"));
  if (!display || !input) return;

  display.addEventListener("click", (e) => {
    e.preventDefault();
    void beginSessionTitleEdit();
  });
  display.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void beginSessionTitleEdit();
    }
  });

  input.addEventListener("input", () => {
    if (sessionTitleDebounceTimer) clearTimeout(sessionTitleDebounceTimer);
    sessionTitleDebounceTimer = setTimeout(() => {
      sessionTitleDebounceTimer = null;
      void flushSessionTitleSave();
    }, 400);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
  });

  input.addEventListener("blur", () => {
    if (sessionTitleDebounceTimer) {
      clearTimeout(sessionTitleDebounceTimer);
      sessionTitleDebounceTimer = null;
    }
    void exitSessionTitleEdit();
  });
}

/**
 * @type {{
 *   step: number,
 *   anglerId: string | null,
 *   species: string | null,
 *   lengthStr: string,
 *   weightStr: string,
 *   depthStr: string,
 *   waterTempStr: string,
 *   notes: string,
 *   editingCatchId: string | null,
 * }}
 */
let fishState = freshFishState();

/** Home screen: anglers block (list + session roster) expanded. Persists across re-renders. */
let homeAnglersExpanded = false;

/** Active Supabase `sessions.id` after a successful cloud insert when starting a session; cleared when the session ends. Also restored from IndexedDB on load (see `rehydrateSupabaseSessionContext`). */
let activeSupabaseSessionId = null;

/** True while session title is shown as an input (inline edit). */
let sessionTitleEditing = false;

/** @type {ReturnType<typeof setTimeout> | null} */
let sessionTitleDebounceTimer = null;

/** True if local title may not be synced to Supabase yet (offline or failed push). */
let sessionTitleNeedsCloudSync = false;

/** @type {"synced" | "syncing" | "offline" | "error"} */
let syncStatus = navigator.onLine ? "synced" : "offline";

/** @type {ReturnType<typeof setInterval> | null} */
let participantSessionPollIntervalId = null;

function clearParticipantSessionPoll() {
  if (participantSessionPollIntervalId !== null) {
    clearInterval(participantSessionPollIntervalId);
    participantSessionPollIntervalId = null;
  }
}

/**
 * Merges `session_anglers` + `catches` from Supabase into IndexedDB for the active session.
 * Runs for **both** host and participants: the host’s second device has no local roster/catches
 * until this runs (we must not skip when `sessions.user_id === auth.uid()`).
 */
async function syncParticipantSessionFromCloudIfNeeded() {
  if (!navigator.onLine || !getLastParticipantRehydrateOk()) return;
  const uid = await getAuthUserId();
  if (!uid) return;
  const session = await getActiveSessionForParticipantUi();
  if (!session || session.endTime != null) return;
  const cloudSid =
    typeof session.supabaseSessionId === "string" && session.supabaseSessionId
      ? session.supabaseSessionId
      : null;
  if (!cloudSid) return;
  const res = await pullSessionRosterAndCatchesFromCloud(session.id, cloudSid);
  if (!res.ok) {
    console.warn("[participantSync] pull failed:", res.error);
  }
}

async function maybeStartParticipantSessionPoll(localSessionId) {
  clearParticipantSessionPoll();
  if (!navigator.onLine || !getLastParticipantRehydrateOk()) return;
  const uid = await getAuthUserId();
  if (!uid) return;
  const sessRow = await getSessionById(localSessionId);
  const cloudSid =
    sessRow && typeof sessRow.supabaseSessionId === "string" && sessRow.supabaseSessionId
      ? sessRow.supabaseSessionId
      : null;
  if (!cloudSid) return;

  participantSessionPollIntervalId = setInterval(async () => {
    try {
      await syncParticipantSessionFromCloudIfNeeded();
      const s = await getActiveSessionForParticipantUi();
      if (!s || s.endTime != null || s.id !== localSessionId) {
        clearParticipantSessionPoll();
        return;
      }
      await rehydrateSupabaseSessionContext();
      await renderSessionLiveView(s.id);
      await refreshCatchesTableIfOpen();
    } catch (e) {
      console.warn("[participantSync] poll:", e);
    }
  }, 12000);
}

/** Rows returned from the last successful `session_anglers` batch for the active session (optional; cleared when the session ends). */
let activeSupabaseAnglerRows = null;

/** Local participant id (`profiles.id`) → `{ id: public.anglers.id }` (session-scoped row) for `catches.angler_id` sync. */
const supabaseAnglerRowByLocalId = new Map();

/** @type {ReturnType<typeof setInterval> | null} */
let sessionTimerIntervalId = null;

/** Start time (ms) for the currently running session timer, if any. */
let sessionTimerForStartMs = null;

/**
 * @param {number} startTimeMs
 */
function formatElapsedSince(startTimeMs) {
  const ms = Math.max(0, Date.now() - startTimeMs);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * @param {number} startTimeMs
 */
function updateSessionTimerDisplay(startTimeMs) {
  const el = document.getElementById("session-timer");
  if (!el) return;
  el.textContent = `Kesto: ${formatElapsedSince(startTimeMs)}`;
}

function stopSessionTimer() {
  if (sessionTimerIntervalId !== null) {
    clearInterval(sessionTimerIntervalId);
    sessionTimerIntervalId = null;
  }
  sessionTimerForStartMs = null;
  const el = document.getElementById("session-timer");
  if (el) el.textContent = "";
}

/**
 * @param {number} startTimeMs
 */
function startSessionTimer(startTimeMs) {
  if (sessionTimerIntervalId !== null && sessionTimerForStartMs === startTimeMs) {
    updateSessionTimerDisplay(startTimeMs);
    return;
  }
  if (sessionTimerIntervalId !== null) {
    clearInterval(sessionTimerIntervalId);
    sessionTimerIntervalId = null;
  }
  sessionTimerForStartMs = startTimeMs;
  updateSessionTimerDisplay(startTimeMs);
  sessionTimerIntervalId = setInterval(() => {
    updateSessionTimerDisplay(startTimeMs);
  }, 1000);
}

function freshFishState() {
  return {
    step: 1,
    anglerId: null,
    species: null,
    lengthStr: "",
    weightStr: "",
    depthStr: "",
    waterTempStr: "",
    notes: "",
    editingCatchId: null,
  };
}

/**
 * Keep measurement inputs and fishState in sync (length: digits; weight: raw, no auto-format).
 */
function syncFishStateFromMeasurementInputs() {
  const len = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-length"));
  const w = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-weight"));
  const depth = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-depth"));
  const wt = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-water-temp"));
  if (len) {
    const v = (len.value || "").replace(/\D/g, "").slice(0, 6);
    if (len.value !== v) len.value = v;
    fishState.lengthStr = v;
  }
  if (w) {
    fishState.weightStr = w.value ?? "";
  }
  if (depth) {
    let v = (depth.value || "").replace(/,/g, ".");
    v = v.replace(/[^\d.]/g, "");
    const dot = v.indexOf(".");
    if (dot !== -1) {
      v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
    }
    v = v.slice(0, 12);
    if (depth.value !== v) depth.value = v;
    fishState.depthStr = v;
  }
  if (wt) {
    let v = (wt.value || "").replace(/,/g, ".");
    v = v.replace(/[^\d.-]/g, "");
    if (v.length > 1 && v.startsWith("-")) {
      const rest = v.slice(1).replace(/-/g, "");
      const parts = rest.split(".");
      const norm =
        parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : rest;
      v = "-" + norm.slice(0, 12);
    } else {
      const parts = v.split(".");
      v = parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : v;
      v = v.slice(0, 12);
    }
    if (wt.value !== v) wt.value = v;
    fishState.waterTempStr = v;
  }
}

function clearFishMeasurementInputs() {
  const len = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-length"));
  const w = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-weight"));
  const depth = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-depth"));
  const wt = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-water-temp"));
  if (len) len.value = "";
  if (w) w.value = "";
  if (depth) depth.value = "";
  if (wt) wt.value = "";
}

/**
 * @param {string} msg
 */
function showError(msg) {
  const el = document.getElementById("error-toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("is-visible");
  setTimeout(() => el.classList.remove("is-visible"), 4200);
}

/**
 * @param {string} msg
 */
function showSuccess(msg) {
  const el = document.getElementById("success-toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("is-visible");
  setTimeout(() => el.classList.remove("is-visible"), 4200);
}

function closeCatchesOverlay() {
  document.getElementById("catches-overlay")?.classList.add("hidden");
}

/**
 * Leaves session detail (catches overlay) and related UI; use after deleting a session so the user is on home / history list, not a stale detail view.
 */
function navigateHomeFromSessionDetail() {
  const catchesOv = document.getElementById("catches-overlay");
  if (catchesOv) {
    catchesOv.classList.add("hidden");
    delete catchesOv.dataset.viewSessionId;
  }
  catchesSessionMenuSessionId = null;
  catchesSessionMenuOpen = false;
  syncCatchesSessionMenuUi();
  closeSessionSummaryOverlay();
  closeSessionEndOverlay();
  document.getElementById("fish-overlay")?.classList.add("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * @param {import('./catchService.js').DeviceLocation} loc
 * @param {import('./db.js').CatchRecord} saved
 */
/**
 * Builds and downloads CSV for an ended session; marks session as CSV-exported locally.
 * @param {string} sessionId
 */
async function handleExportEndedSessionCsv(sessionId) {
  const session = await getSessionById(sessionId);
  if (!session || session.endTime == null) {
    showError("CSV voidaan viedä vain päättyneelle sessiolle.");
    return;
  }
  try {
    const catches = await getCatchesForSession(sessionId);
    const csv = buildSessionCatchesCsv(catches);
    triggerCsvDownload(defaultFishLogFilename(), csv);
    const r = await markSessionCsvExportedById(sessionId);
    if (!r.ok) {
      showError(r.reason);
      return;
    }
    await refreshCatchesTableIfOpen();
    await renderHome();
    showSuccess("CSV tallennettu");
  } catch {
    showError("CSV-tallennus epäonnistui.");
  }
}

function formatSaveSuccessSummary(loc, saved) {
  const parts = [];
  if (loc.lat != null && loc.lng != null) {
    const acc =
      typeof loc.accuracyM === "number" ? ` (±${Math.round(loc.accuracyM)} m)` : "";
    parts.push(`Sijainti: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${acc}.`);
  } else {
    parts.push("Sijaintia ei tallennettu.");
  }
  if (saved.weather_summary != null && typeof saved.air_temp_c === "number") {
    parts.push(`Sää: ${saved.weather_summary}, ilma ${saved.air_temp_c.toFixed(1)} °C.`);
  } else if (loc.lat != null && loc.lng != null) {
    parts.push("Säätietoja ei saatu.");
  }
  return parts.join(" ");
}

/**
 * @param {string} sessionId
 */
function formatSessionStripLabel(sessionId) {
  if (!sessionId) return "";
  const short = sessionId.length > 14 ? `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}` : sessionId;
  return `Sessio · ${short}`;
}

/**
 * 24-hour clock with colon (not locale-dependent dot).
 * @param {number} ts
 */
function formatClock24(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Session “day” label from start timestamp (local).
 * @param {number} ts
 */
function formatSessionDateLabel(ts) {
  return new Date(ts).toLocaleDateString("fi-FI", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

/**
 * @param {number} startMs
 * @param {number} endMs
 * @returns {string | null}
 */
function formatSessionDuration(startMs, endMs) {
  const ms = endMs - startMs;
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

/**
 * @param {import('./db.js').CatchRecord[]} catches
 * @returns {number | null}
 */
function averageWaterTempC(catches) {
  const vals = catches
    .map((c) => c.water_temp_c)
    .filter((t) => t != null && typeof t === "number" && Number.isFinite(t));
  if (vals.length === 0) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  return sum / vals.length;
}

/**
 * Single-line display for the winning catch: both length and weight, "-" when missing.
 * @param {import('./db.js').CatchRecord} c
 */
function formatBiggestFishDisplayLine(c) {
  const lenPart =
    c.length != null && typeof c.length === "number" && c.length >= 1
      ? `${c.length} cm`
      : "-";
  const wtPart =
    c.weight_kg != null && typeof c.weight_kg === "number" && Number.isFinite(c.weight_kg)
      ? `${c.weight_kg.toLocaleString("fi-FI", { maximumFractionDigits: 2 })} kg`
      : "-";
  return `Pituus: ${lenPart} | Paino: ${wtPart}`;
}

/**
 * Prefer max weight; if no weights, max length.
 * @param {import('./db.js').CatchRecord[]} catches
 * @param {Record<string, string>} nameById
 * @returns {{ display: string, anglerName: string } | null}
 */
function biggestFishSummary(catches, nameById) {
  const w = catches.filter(
    (c) => c.weight_kg != null && typeof c.weight_kg === "number" && Number.isFinite(c.weight_kg)
  );
  if (w.length > 0) {
    let best = w[0];
    for (let i = 1; i < w.length; i++) {
      if (/** @type {number} */ (w[i].weight_kg) > /** @type {number} */ (best.weight_kg)) best = w[i];
    }
    return {
      display: formatBiggestFishDisplayLine(best),
      anglerName: nameById[best.anglerId] || best.anglerId,
    };
  }
  const len = catches.filter((c) => c.length != null && typeof c.length === "number" && c.length >= 1);
  if (len.length > 0) {
    let best = len[0];
    for (let i = 1; i < len.length; i++) {
      if (/** @type {number} */ (len[i].length) > /** @type {number} */ (best.length)) best = len[i];
    }
    return {
      display: formatBiggestFishDisplayLine(best),
      anglerName: nameById[best.anglerId] || best.anglerId,
    };
  }
  return null;
}

/**
 * @param {number} ts
 * @param {boolean} activeSession — if true, HH:MM only (24h, colon); if false, date + 24h time with colon
 */
function formatCatchListTime(ts, activeSession) {
  const d = new Date(ts);
  if (activeSession) {
    return formatClock24(ts);
  }
  const datePart = d.toLocaleDateString("fi-FI", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
  return `${datePart} · ${formatClock24(ts)}`;
}

/**
 * @param {HTMLDListElement} dl
 * @param {string} label
 * @param {string} value
 */
function appendDashDlRow(dl, label, value) {
  const dt = document.createElement("dt");
  dt.className = "dash-dt";
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.className = "dash-dd";
  dd.textContent = value;
  dl.append(dt, dd);
}

/**
 * @param {import('./db.js').Session} session
 * @param {import('./db.js').SessionAngler[]} sessionAnglers
 * @param {import('./db.js').CatchRecord[]} catches
 * @param {Record<string, string>} nameById
 * @param {{
 *   summaryDl: HTMLDListElement,
 *   byAnglerUl: HTMLUListElement,
 *   bySpeciesUl: HTMLUListElement,
 * }} els
 */
function fillEndedSessionDashboardPanels(session, sessionAnglers, catches, nameById, els) {
  const { summaryDl, byAnglerUl, bySpeciesUl } = els;
  summaryDl.innerHTML = "";
  byAnglerUl.innerHTML = "";
  bySpeciesUl.innerHTML = "";

  const dateLabel = formatSessionDateLabel(session.startTime);
  const startClock = formatClock24(session.startTime);
  const endClock = session.endTime != null ? formatClock24(session.endTime) : "—";
  const duration =
    session.endTime != null ? formatSessionDuration(session.startTime, session.endTime) : null;

  const anglerIds = [...new Set(sessionAnglers.map((sa) => sa.anglerId))];
  const anglerNames = anglerIds.length
    ? anglerIds.map((id) => nameById[id] || id).join(", ")
    : "—";

  appendDashDlRow(summaryDl, "Päivä", dateLabel);
  appendDashDlRow(summaryDl, "Alkoi", startClock);
  appendDashDlRow(summaryDl, "Päättyi", endClock);
  if (duration) appendDashDlRow(summaryDl, "Kesto", duration);
  appendDashDlRow(summaryDl, "Kalastajat", anglerNames);
  appendDashDlRow(summaryDl, "Saaliit yhteensä", String(catches.length));

  const avgW = averageWaterTempC(catches);
  if (avgW != null) {
    appendDashDlRow(
      summaryDl,
      "Keskim. veden lämpö",
      `${avgW.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} °C`
    );
  }

  const big = biggestFishSummary(catches, nameById);
  if (big) {
    appendDashDlRow(summaryDl, "Isoin kala", big.display);
    appendDashDlRow(summaryDl, "Kalastaja (isoin)", big.anglerName);
  }

  /** @type {Map<string, number>} */
  const countByAngler = new Map();
  for (const c of catches) {
    countByAngler.set(c.anglerId, (countByAngler.get(c.anglerId) || 0) + 1);
  }
  const uniqueAnglerIds = [...new Set(sessionAnglers.map((sa) => sa.anglerId))];
  const anglerRows = uniqueAnglerIds
    .map((id) => ({
      name: nameById[id] || id,
      count: countByAngler.get(id) || 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "fi"));

  if (anglerRows.length === 0) {
    const li = document.createElement("li");
    li.className = "meta";
    li.textContent = "Ei kalastajia sessiossa.";
    byAnglerUl.appendChild(li);
  } else {
    for (const row of anglerRows) {
      const li = document.createElement("li");
      li.textContent = `${row.name}: ${row.count}`;
      byAnglerUl.appendChild(li);
    }
  }

  /** @type {Map<string, number>} */
  const countBySpecies = new Map();
  for (const c of catches) {
    countBySpecies.set(c.species, (countBySpecies.get(c.species) || 0) + 1);
  }
  const speciesKeys = [...countBySpecies.keys()].sort(
    (a, b) => SPECIES_OPTIONS.indexOf(a) - SPECIES_OPTIONS.indexOf(b)
  );
  if (speciesKeys.length === 0) {
    const li = document.createElement("li");
    li.className = "meta";
    li.textContent = "Ei kirjattuja saaliita.";
    bySpeciesUl.appendChild(li);
  } else {
    for (const key of speciesKeys) {
      const label = SPECIES_LABELS[key] || key;
      const li = document.createElement("li");
      li.textContent = `${label}: ${countBySpecies.get(key)}`;
      bySpeciesUl.appendChild(li);
    }
  }
}

/**
 * @param {string} text
 */
function appendSplitItem(row, text) {
  const el = document.createElement("div");
  el.className = "catch-card-split-item";
  el.textContent = text;
  row.appendChild(el);
}

/**
 * @param {import('./db.js').CatchRecord} c
 * @param {Record<string, string>} nameById
 * @param {{ activeSession?: boolean, allowEditDelete?: boolean }} opts
 */
function buildCatchCardEl(c, nameById, opts = {}) {
  const activeSession = opts.activeSession === true;
  const allowEditDelete = opts.allowEditDelete === true;

  const article = document.createElement("article");
  article.className = "catch-card";
  article.setAttribute("role", "listitem");

  const anglerName = nameById[c.anglerId] || c.anglerId;
  const speciesLabel = SPECIES_LABELS[c.species] || c.species;
  const timeStr = formatCatchListTime(c.timestamp, activeSession);

  const rowHead = document.createElement("div");
  rowHead.className = "catch-card-row-head";
  const anglerStrong = document.createElement("strong");
  anglerStrong.className = "catch-card-angler-name";
  anglerStrong.textContent = anglerName;
  rowHead.appendChild(anglerStrong);
  rowHead.appendChild(document.createTextNode(` | ${speciesLabel} | ${timeStr}`));
  article.appendChild(rowHead);

  const hasLen = c.length != null && typeof c.length === "number" && c.length >= 1;
  const hasWt =
    c.weight_kg != null && typeof c.weight_kg === "number" && Number.isFinite(c.weight_kg);
  const hasDepth = c.depth_m != null && typeof c.depth_m === "number" && Number.isFinite(c.depth_m);
  const hasWtemp =
    c.water_temp_c != null && typeof c.water_temp_c === "number" && Number.isFinite(c.water_temp_c);
  const hasMetrics = hasLen || hasWt || hasDepth || hasWtemp;

  const metricsStack = document.createElement("div");
  metricsStack.className = "catch-card-metrics-stack";

  if (hasLen || hasWt) {
    const row = document.createElement("div");
    row.className = "catch-card-row-split";
    if (hasLen) {
      appendSplitItem(row, `Pituus: ${c.length} cm`);
    }
    if (hasWt) {
      const w = c.weight_kg.toLocaleString("fi-FI", { maximumFractionDigits: 2 });
      appendSplitItem(row, `Paino: ${w} kg`);
    }
    metricsStack.appendChild(row);
  }

  if (hasDepth || hasWtemp) {
    const row = document.createElement("div");
    row.className = "catch-card-row-split catch-card-row-split--telemetry";
    if (hasDepth) {
      const dm = c.depth_m.toLocaleString("fi-FI", { maximumFractionDigits: 2 });
      appendSplitItem(row, `Syvyys: ${dm} m`);
    }
    if (hasWtemp) {
      const wt = c.water_temp_c.toLocaleString("fi-FI", { maximumFractionDigits: 1 });
      appendSplitItem(row, `Veden lämpö: ${wt} °C`);
    }
    metricsStack.appendChild(row);
  }

  let actions = null;
  if (allowEditDelete) {
    actions = document.createElement("div");
    actions.className = "catch-card-actions";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "btn catch-card-menu-trigger";
    trigger.setAttribute("aria-label", "Toiminnot");
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
    trigger.textContent = "⋯";

    const menu = document.createElement("div");
    menu.className = "catch-card-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "catch-card-menu-item";
    editBtn.setAttribute("role", "menuitem");
    editBtn.textContent = "Muokkaa";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      void openFishOverlayForEdit(c);
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "catch-card-menu-item catch-card-menu-item--danger";
    delBtn.setAttribute("role", "menuitem");
    delBtn.textContent = "Poista";
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      menu.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (!confirm("Poistetaanko saalis?")) return;
      try {
        const okCloud = await deleteCatchFromSupabaseBestEffort(c);
        if (!okCloud) return;
        await deleteCatch(c.id);
        await refreshCatchesTableIfOpen();
        await renderHome();
      } catch {
        showError("Poisto epäonnistui.");
      }
    });

    menu.append(editBtn, delBtn);

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const opening = menu.hidden;
      document.querySelectorAll(".catch-card-menu").forEach((m) => {
        m.hidden = true;
        const t = m.previousElementSibling;
        if (t?.classList.contains("catch-card-menu-trigger")) {
          t.setAttribute("aria-expanded", "false");
        }
      });
      if (opening) {
        menu.hidden = false;
        trigger.setAttribute("aria-expanded", "true");
      }
    });

    actions.append(trigger, menu);
  }

  if (hasMetrics || allowEditDelete) {
    const metricsWrap = document.createElement("div");
    metricsWrap.className = "catch-card-metrics-wrap";
    if (!hasMetrics && allowEditDelete) {
      metricsWrap.classList.add("catch-card-metrics-wrap--empty");
    }
    metricsWrap.appendChild(metricsStack);
    if (actions) {
      metricsWrap.appendChild(actions);
    }
    article.appendChild(metricsWrap);
  }

  const notes = (c.notes || "").trim();
  if (notes) {
    const notesEl = document.createElement("div");
    notesEl.className = "catch-card-notes";
    notesEl.textContent = notes;
    article.appendChild(notesEl);
  }

  return article;
}

/**
 * @param {HTMLElement | null} container
 * @param {string} sessionId
 * @param {boolean} emptyPlaceholderRow
 * @param {{ activeSession?: boolean, allowEditDelete?: boolean, sortNewestFirst?: boolean }} [listOptions] — activeSession true: catch time HH:MM only; false: date + time; sortNewestFirst false = oldest-first (history)
 * @returns {Promise<number>} number of catches rendered
 */
async function renderCatchList(container, sessionId, emptyPlaceholderRow, listOptions = {}) {
  if (!container) return 0;
  const activeSession = listOptions.activeSession === true;
  const allowEditDelete = listOptions.allowEditDelete === true;
  const catches = await getCatchesForSession(sessionId);
  const anglerIds = [...new Set(catches.map((c) => c.anglerId))];
  const nameById = await fetchProfileDisplayNames(anglerIds);
  const newestFirst = listOptions.sortNewestFirst !== false;
  const sorted = [...catches].sort((a, b) =>
    newestFirst ? b.timestamp - a.timestamp : a.timestamp - b.timestamp
  );
  container.innerHTML = "";
  if (sorted.length === 0) {
    if (emptyPlaceholderRow) {
      const p = document.createElement("p");
      p.className = "meta catch-list-empty";
      p.textContent = "Ei kirjattuja saaliita.";
      container.appendChild(p);
    }
    return 0;
  }
  for (const c of sorted) {
    container.appendChild(buildCatchCardEl(c, nameById, { activeSession, allowEditDelete }));
  }
  return sorted.length;
}

/**
 * Fills the session catches table from IndexedDB.
 * @param {string | undefined} sessionIdOverride - if set, load this session (e.g. just ended).
 */
async function populateCatchesTable(sessionIdOverride) {
  const catchesOv = document.getElementById("catches-overlay");
  if (catchesOv) {
    if (sessionIdOverride) {
      catchesOv.dataset.viewSessionId = sessionIdOverride;
    } else {
      delete catchesOv.dataset.viewSessionId;
    }
  }

  const titleEl = document.getElementById("catches-overlay-title");
  const detailMenuBtn = document.getElementById("catches-session-menu-btn");
  const listEl = document.getElementById("catches-table-body");
  const stripEl = document.getElementById("catches-session-strip");
  const emptyEl = document.getElementById("catches-empty");
  const wrap = document.getElementById("catches-table-wrap");
  const dashEl = document.getElementById("catches-ended-dashboard");
  if (!listEl) return;

  let sessionId = sessionIdOverride;
  let overlayTitle = "Saaliit tässä sessiossa";
  let emptyMsg = "Ei saaliita tässä sessiossa.";

  if (!sessionId) {
    detailMenuBtn?.classList.add("hidden");
    catchesSessionMenuOpen = false;
    catchesSessionMenuSessionId = null;
    syncCatchesSessionMenuUi();
    dashEl?.classList.add("hidden");
    const session = await getActiveSessionForParticipantUi();
    if (!session) {
      listEl.innerHTML = "";
      if (stripEl) {
        stripEl.setAttribute("hidden", "");
        stripEl.textContent = "";
      }
      emptyEl?.classList.remove("hidden");
      wrap?.classList.add("hidden");
      if (titleEl) titleEl.textContent = "Saaliit tässä sessiossa";
      if (emptyEl) emptyEl.textContent = "Ei aktiivista sessiota.";
      listEl.setAttribute("aria-label", "Saaliit tässä sessiossa");
      return;
    }
    sessionId = session.id;
    detailMenuBtn?.classList.add("hidden");
    catchesSessionMenuSessionId = null;
    catchesSessionMenuOpen = false;
    syncCatchesSessionMenuUi();
    if (titleEl) titleEl.textContent = overlayTitle;
    listEl.setAttribute("aria-label", overlayTitle);
  } else {
    overlayTitle = "Päättynyt sessio";
    emptyMsg = "Ei kirjattuja saaliita tässä sessiossa.";
    if (titleEl) titleEl.textContent = overlayTitle;
    listEl.setAttribute("aria-label", overlayTitle);

    const session = await getSessionById(sessionIdOverride);
    if (session && session.endTime != null && navigator.onLine && session.supabaseSessionId) {
      const uid = await getAuthUserId();
      if (uid) {
        const pr = await pullSessionRosterAndCatchesFromCloud(session.id, session.supabaseSessionId);
        if (!pr.ok) {
          console.warn("[participantSync] ended session pull:", pr.error);
        }
      }
    }
    const isEndedSession = session != null && session.endTime != null;
    if (isEndedSession) {
      detailMenuBtn?.classList.remove("hidden");
      catchesSessionMenuSessionId = sessionIdOverride;
    } else {
      detailMenuBtn?.classList.add("hidden");
      catchesSessionMenuSessionId = null;
    }
    catchesSessionMenuOpen = false;
    syncCatchesSessionMenuUi();
    const summaryDl = document.getElementById("ended-dash-summary-dl");
    const byAnglerUl = document.getElementById("ended-dash-by-angler");
    const bySpeciesUl = document.getElementById("ended-dash-by-species");
    if (session && summaryDl && byAnglerUl && bySpeciesUl) {
      const [sessionAnglers, catches] = await Promise.all([
        getSessionAnglersForSession(sessionIdOverride),
        getCatchesForSession(sessionIdOverride),
      ]);
      const anglerIds = [
        ...new Set([...sessionAnglers.map((sa) => sa.anglerId), ...catches.map((c) => c.anglerId)]),
      ];
      const nameById = await fetchProfileDisplayNames(anglerIds);
      fillEndedSessionDashboardPanels(session, sessionAnglers, catches, nameById, {
        summaryDl,
        byAnglerUl,
        bySpeciesUl,
      });
      dashEl?.classList.remove("hidden");
    } else {
      dashEl?.classList.add("hidden");
    }
    if (stripEl) {
      stripEl.setAttribute("hidden", "");
      stripEl.textContent = "";
    }
  }

  if (stripEl && sessionId && !sessionIdOverride) {
    stripEl.textContent = formatSessionStripLabel(sessionId);
    stripEl.removeAttribute("hidden");
  }

  const active = await getActiveSessionForParticipantUi();
  const allowEditDelete = !!active && active.id === sessionId;

  const count = await renderCatchList(listEl, sessionId, false, {
    activeSession: sessionIdOverride == null,
    allowEditDelete,
    sortNewestFirst: !sessionIdOverride,
  });
  if (count === 0) {
    if (emptyEl) emptyEl.textContent = emptyMsg;
    emptyEl?.classList.remove("hidden");
    if (!sessionIdOverride) {
      wrap?.classList.add("hidden");
    } else {
      wrap?.classList.remove("hidden");
    }
    return;
  }

  emptyEl?.classList.add("hidden");
  wrap?.classList.remove("hidden");
}

async function populateSessionEndCatchesTable() {
  const session = await getActiveSessionForParticipantUi();
  const listEl = document.getElementById("session-end-table-body");
  const wrap = document.getElementById("session-end-table-wrap");
  const stripEl = document.getElementById("session-end-session-strip");
  if (!session || !listEl) return;
  if (stripEl) {
    stripEl.textContent = formatSessionStripLabel(session.id);
    stripEl.removeAttribute("hidden");
  }
  await renderCatchList(listEl, session.id, true, { activeSession: true, allowEditDelete: true });
  wrap?.classList.remove("hidden");
}

async function openSessionEndOverlay() {
  const session = await getActiveSessionForParticipantUi();
  if (!session) return;
  closeCatchesOverlay();
  await populateSessionEndCatchesTable();
  document.getElementById("session-end-overlay")?.classList.remove("hidden");
}

function closeSessionEndOverlay() {
  document.getElementById("session-end-overlay")?.classList.add("hidden");
}

/**
 * Fills session summary from `getCatchesForSession` + session roster + angler names (no DB schema changes).
 * @param {string} sessionId
 */
async function populateSessionSummaryOverlay(sessionId) {
  const session = await getSessionById(sessionId);
  const summaryDl = document.getElementById("session-summary-dash-dl");
  const byAnglerUl = document.getElementById("session-summary-dash-by-angler");
  const bySpeciesUl = document.getElementById("session-summary-dash-by-species");
  if (!session || !summaryDl || !byAnglerUl || !bySpeciesUl) return;

  const [sessionAnglers, catches] = await Promise.all([
    getSessionAnglersForSession(sessionId),
    getCatchesForSession(sessionId),
  ]);
  const anglerIds = [
    ...new Set([...sessionAnglers.map((sa) => sa.anglerId), ...catches.map((c) => c.anglerId)]),
  ];
  const nameById = await fetchProfileDisplayNames(anglerIds);
  fillEndedSessionDashboardPanels(session, sessionAnglers, catches, nameById, {
    summaryDl,
    byAnglerUl,
    bySpeciesUl,
  });
}

/**
 * @param {string} sessionId
 */
async function openSessionSummaryOverlay(sessionId) {
  await populateSessionSummaryOverlay(sessionId);
  document.getElementById("session-summary-overlay")?.classList.remove("hidden");
}

function closeSessionSummaryOverlay() {
  document.getElementById("session-summary-overlay")?.classList.add("hidden");
}

async function refreshCatchesTableIfOpen() {
  const ov = document.getElementById("catches-overlay");
  if (ov && !ov.classList.contains("hidden")) {
    const sid = ov.dataset.viewSessionId;
    await populateCatchesTable(sid || undefined);
  }
  const se = document.getElementById("session-end-overlay");
  if (se && !se.classList.contains("hidden")) {
    await populateSessionEndCatchesTable();
  }
}

async function openCatchesOverlay() {
  await populateCatchesTable();
  document.getElementById("catches-overlay")?.classList.remove("hidden");
}

/**
 * Live stats for the active session: per angler total, then per-species count and longest (cm).
 * @param {string} sessionId
 */
async function renderSessionLiveView(sessionId) {
  const wrap = document.getElementById("session-live-view");
  if (!wrap) return;

  const [sas, catches] = await Promise.all([
    getSessionAnglersForSession(sessionId),
    getCatchesForSession(sessionId),
  ]);
  const anglerIds = [
    ...new Set([...sas.map((sa) => sa.anglerId), ...catches.map((c) => c.anglerId)]),
  ];
  const nameById = await fetchProfileDisplayNames(anglerIds);

  /** @type {Map<string, number>} */
  const totalByAngler = new Map();
  /** @type {Map<string, Map<string, { count: number, longest: number | null }>>} */
  const byAnglerSpecies = new Map();

  for (const c of catches) {
    totalByAngler.set(c.anglerId, (totalByAngler.get(c.anglerId) || 0) + 1);
    let spMap = byAnglerSpecies.get(c.anglerId);
    if (!spMap) {
      spMap = new Map();
      byAnglerSpecies.set(c.anglerId, spMap);
    }
    let g = spMap.get(c.species);
    if (!g) {
      g = { count: 0, longest: null };
      spMap.set(c.species, g);
    }
    g.count += 1;
    if (c.length != null && c.length >= 1) {
      if (g.longest == null || c.length > g.longest) g.longest = c.length;
    }
  }

  wrap.innerHTML = "";
  for (const sa of sas) {
    const name = nameById[sa.anglerId] || sa.anglerId;
    const total = totalByAngler.get(sa.anglerId) || 0;
    const spMap = byAnglerSpecies.get(sa.anglerId);

    const card = document.createElement("div");
    card.className = "session-live-card";

    const head = document.createElement("div");
    head.className = "session-live-angler-head";
    const nameEl = document.createElement("span");
    nameEl.className = "session-live-name";
    nameEl.textContent = name;
    const totalEl = document.createElement("span");
    totalEl.className = "session-live-total";
    totalEl.textContent = `${total} kpl`;
    head.append(nameEl, totalEl);
    card.appendChild(head);

    if (total === 0) {
      const dash = document.createElement("p");
      dash.className = "session-live-dash";
      dash.textContent = "-";
      card.appendChild(dash);
    } else if (spMap && spMap.size > 0) {
      const speciesBox = document.createElement("div");
      speciesBox.className = "session-live-species";
      const keys = [...spMap.keys()].sort((a, b) => SPECIES_OPTIONS.indexOf(a) - SPECIES_OPTIONS.indexOf(b));
      for (const speciesKey of keys) {
        const g = spMap.get(speciesKey);
        if (!g) continue;
        const label = SPECIES_LABELS[speciesKey] || speciesKey;
        const longestStr = g.longest != null ? `${g.longest} cm` : "-";
        const line = document.createElement("p");
        line.className = "session-live-species-line";
        line.textContent = `${label} kpl ${g.count}, isoin ${longestStr}`;
        speciesBox.appendChild(line);
      }
      card.appendChild(speciesBox);
    }

    wrap.appendChild(card);
  }
}

function syncHomeAnglersToggleUi() {
  const panel = document.getElementById("angler-edit-panel");
  const btn = document.getElementById("btn-toggle-anglers");
  panel?.classList.toggle("hidden", !homeAnglersExpanded);
  btn?.setAttribute("aria-expanded", homeAnglersExpanded ? "true" : "false");
  btn?.classList.toggle("is-active", homeAnglersExpanded);
  if (btn) btn.textContent = homeAnglersExpanded ? "Piilota osallistujat" : "Näytä osallistujat";
}

/**
 * Upserts local angler row id = auth user id (display name from profile).
 * @param {{ id: string, user_metadata?: Record<string, unknown> } | null | undefined} user
 * @returns {Promise<string | null>}
 */
async function ensureLoggedInUserAnglerWithUser(user) {
  if (!user?.id) return null;
  const displayName = getDisplayNameFromUser(user);
  const name = displayName.trim() || "User";
  await putAngler({ id: user.id, displayName: name });
  return user.id;
}

/**
 * @returns {Promise<string | null>}
 */
async function ensureLoggedInUserAngler() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return ensureLoggedInUserAnglerWithUser(user);
}

/**
 * @param {{ id: string, title: string | null, ended_at: string | null, created_at: string | null }} cloud
 */
async function upsertLocalSessionFromCloudRow(cloud) {
  const existing = await getSessionBySupabaseCloudId(cloud.id);
  const endMs = cloud.ended_at ? new Date(cloud.ended_at).getTime() : null;
  const startMs = cloud.created_at ? new Date(cloud.created_at).getTime() : Date.now();
  if (existing) {
    await putSession({
      ...existing,
      supabaseSessionId: cloud.id,
      title: cloud.title ?? existing.title,
      endTime: endMs,
    });
  } else {
    await putSession({
      id: newId(),
      startTime: startMs,
      endTime: endMs,
      initialLocationLat: null,
      initialLocationLng: null,
      initialLocationAccuracyM: null,
      initialLocationTimestamp: null,
      csv_exported: false,
      csv_exported_at: null,
      title: cloud.title ?? null,
      supabaseSessionId: cloud.id,
    });
  }
}

async function rehydrateSupabaseParticipantSessions() {
  const uid = await getAuthUserId();
  console.log("[participantSessions] currentUserId", uid || "(none)");
  setParticipantSessionFetchResult(false, [], []);
  if (!uid) {
    return;
  }
  if (!navigator.onLine) {
    console.log("[participantSessions] offline — skipping cloud fetch (history/active use local fallback)");
    return;
  }
  const res = await fetchParticipantSessionsForUser(uid);
  if (!res.ok) {
    console.warn("[participantSessions] fetch failed:", res.error);
    return;
  }
  setParticipantSessionFetchResult(true, res.active, res.ended);
  console.log(
    "[participantSessions] active (participant-based) count:",
    res.active.length,
    "ids:",
    res.active.map((s) => s.id)
  );
  console.log(
    "[participantSessions] ended (participant-based) count:",
    res.ended.length,
    "ids:",
    res.ended.map((s) => s.id)
  );
  const merged = [...res.active, ...res.ended];
  for (const cloud of merged) {
    await upsertLocalSessionFromCloudRow(cloud);
  }
}

async function renderHome() {
  clearParticipantSessionPoll();
  await rehydrateSupabaseParticipantSessions();
  await syncParticipantSessionFromCloudIfNeeded();
  await rehydrateSupabaseSessionContext();
  const session = await getActiveSessionForParticipantUi();
  const meta = document.getElementById("session-meta");
  const noS = document.getElementById("block-no-session");
  const act = document.getElementById("block-active-session");
  const roster = document.getElementById("session-roster");

  if (!meta || !noS || !act || !roster) return;

  if (!session) {
    stopSessionTimer();
    document.getElementById("session-title-block")?.classList.add("hidden");
    sessionTitleEditing = false;
    const titleInp = /** @type {HTMLInputElement | null} */ (document.getElementById("session-title-input"));
    const titleDisp = document.getElementById("session-title-display");
    titleInp?.classList.add("hidden");
    titleDisp?.classList.remove("hidden");
    renderSyncStatusIndicator();
    meta.textContent = "Ei aktiivista kalastussessiota. Aloita sessio ennen saaliin kirjausta.";
    noS.classList.remove("hidden");
    act.classList.add("hidden");
    roster.classList.add("hidden");
  } else {
    const start = new Date(session.startTime);
    let line = `Sessio käynnissä (alkoi ${start.toLocaleString("fi-FI")}).`;
    if (
      typeof session.initialLocationLat === "number" &&
      typeof session.initialLocationLng === "number"
    ) {
      const acc =
        typeof session.initialLocationAccuracyM === "number"
          ? ` ±${Math.round(session.initialLocationAccuracyM)} m`
          : "";
      line += ` Alkupiste: ${session.initialLocationLat.toFixed(4)}, ${session.initialLocationLng.toFixed(4)}${acc}.`;
    }
    meta.textContent = line;
    noS.classList.add("hidden");
    act.classList.remove("hidden");
    roster.classList.remove("hidden");
    startSessionTimer(session.startTime);
    syncSessionTitleHeader(session);
    await renderSessionLiveView(session.id);
    await maybeStartParticipantSessionPoll(session.id);
  }

  syncHomeAnglersToggleUi();

  if (session) {
    const sas = await getSessionAnglersForSession(session.id);
    const nameById = await fetchProfileDisplayNames(sas.map((sa) => sa.anglerId));
    const rows = document.getElementById("session-angler-rows");
    if (rows) {
      rows.innerHTML = "";
      for (const sa of sas) {
        const row = document.createElement("div");
        row.className = "angler-item";
        const name = nameById[sa.anglerId] || sa.anglerId;
        const status = sa.isActive ? "aktiivinen" : "poistunut";
        row.innerHTML = `<span>${escapeHtml(name)} <span class="meta">(${status})</span></span>`;
        if (sa.isActive) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn small-btn";
          b.textContent = "Merkitse poistuneeksi";
          b.dataset.sessionId = session.id;
          b.dataset.anglerId = sa.anglerId;
          b.addEventListener("click", async () => {
            const r = await markAnglerInactive(session.id, sa.anglerId);
            if (!r.ok) showError(r.reason);
            await renderHome();
          });
          row.appendChild(b);
        }
        rows.appendChild(row);
      }
    }
  }

  await renderHistorySection();
}

/**
 * Opens read-only catches for a past session (newest-first sort off; no edit/delete).
 * @param {string} sessionId
 */
async function openHistorySessionCatches(sessionId) {
  document.getElementById("fish-overlay")?.classList.add("hidden");
  closeSessionEndOverlay();
  closeSessionSummaryOverlay();
  await populateCatchesTable(sessionId);
  document.getElementById("catches-overlay")?.classList.remove("hidden");
}

/**
 * Lists ended sessions (newest end time first); tap opens read-only catch list.
 */
async function renderHistorySection() {
  const listEl = document.getElementById("history-session-list");
  const emptyEl = document.getElementById("history-empty");
  if (!listEl || !emptyEl) return;

  /** @type {import('./db.js').Session[]} */
  let sessions;
  if (navigator.onLine && getLastParticipantRehydrateOk()) {
    sessions = [];
    for (const cloud of getParticipantEndedCloudRows()) {
      const local = await getSessionBySupabaseCloudId(cloud.id);
      if (local) {
        sessions.push(local);
      }
    }
    sessions.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
  } else {
    sessions = await getAllEndedSessions();
  }

  listEl.innerHTML = "";

  if (sessions.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  const rows = await Promise.all(
    sessions.map(async (s) => {
      const [sas, catches] = await Promise.all([
        getSessionAnglersForSession(s.id),
        getCatchesForSession(s.id),
      ]);
      return { session: s, sas, catchCount: catches.length };
    })
  );

  const allAnglerIds = [];
  for (const { sas } of rows) {
    for (const sa of sas) {
      allAnglerIds.push(sa.anglerId);
    }
  }
  const nameById = await fetchProfileDisplayNames(allAnglerIds);

  for (const { session: s, sas, catchCount } of rows) {
    const dateStr = formatSessionDateLabel(s.startTime);
    const startClock = formatClock24(s.startTime);
    const endClock = s.endTime != null ? formatClock24(s.endTime) : "—";

    const anglerIds = [...new Set(sas.map((sa) => sa.anglerId))];
    const anglerLabel = anglerIds.length
      ? anglerIds.map((id) => nameById[id] || id).join(", ")
      : "—";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "history-session-row";
    btn.setAttribute(
      "aria-label",
      `Sessio ${dateStr}, ${startClock}–${endClock}, ${catchCount} ${catchCount === 1 ? "saalis" : "saalista"}`
    );

    const line1 = document.createElement("div");
    line1.className = "history-session-line1";
    line1.textContent = `${dateStr} · ${startClock}–${endClock}`;

    const line2 = document.createElement("div");
    line2.className = "history-session-line2 meta";
    line2.textContent = anglerLabel;

    const line3 = document.createElement("div");
    line3.className = "history-session-line3";
    line3.textContent = catchCount === 1 ? "1 saalis" : `${catchCount} saalista`;

    btn.append(line1, line2, line3);
    btn.addEventListener("click", async () => {
      await openHistorySessionCatches(s.id);
    });
    listEl.appendChild(btn);
  }
}

/**
 * Session start: owner + profile search only (no guest/local anglers).
 * @param {string | null} selfAnglerId
 * @param {string} selfDisplayName
 */
function buildStartSessionParticipantPicker(selfAnglerId, selfDisplayName) {
  const box = document.getElementById("start-angler-picks");
  const confirm = document.getElementById("start-confirm");
  if (!box || !confirm) return;

  /** @type {Set<string>} */
  const selected = new Set();
  /** @type {Map<string, string>} */
  const labelById = new Map();

  /** @type {ReturnType<typeof setTimeout> | null} */
  let searchTimer = null;

  function hideResults() {
    const r = box.querySelector("#start-search-results");
    if (r) {
      r.innerHTML = "";
      r.classList.add("hidden");
    }
  }

  function renderSelectedChips() {
    const wrap = box.querySelector("#start-selected-wrap");
    if (!wrap) return;
    wrap.innerHTML = "";
    for (const id of selected) {
      if (id === selfAnglerId) continue;
      const chip = document.createElement("div");
      chip.className = "participant-chip";
      const label = document.createElement("span");
      label.textContent = labelById.get(id) || id;
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn btn-ghost participant-chip-remove";
      rm.setAttribute("aria-label", "Poista osallistuja");
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        selected.delete(id);
        labelById.delete(id);
        renderSelectedChips();
      });
      chip.append(label, rm);
      wrap.appendChild(chip);
    }
  }

  /**
   * @param {string} q
   */
  function runSearch(q) {
    const hint = box.querySelector("#start-search-hint");
    const resultsEl = box.querySelector("#start-search-results");
    if (!resultsEl) return;
    if (!navigator.onLine) {
      if (hint) hint.textContent = "Käyttäjähaku vaatii verkkoyhteyden.";
      hideResults();
      return;
    }
    if (hint) hint.textContent = "";
    const trimmed = q.trim();
    if (trimmed.length < 1) {
      if (hint) hint.textContent = "";
      hideResults();
      return;
    }
    void (async () => {
      try {
      const { profiles, error } = await searchProfiles(trimmed, 15);
      if (error) {
        if (hint) hint.textContent = error;
        hideResults();
        return;
      }
      const filtered = profiles.filter((p) => p.id !== selfAnglerId && !selected.has(p.id));
      resultsEl.innerHTML = "";
      if (filtered.length === 0) {
        resultsEl.classList.add("hidden");
        if (hint) {
          if (profiles.length === 0) {
            hint.textContent = "Ei hakutuloksia. Tarkista että RLS sallii profiilien lukemisen (docs: profiles_select_authenticated).";
          } else {
            hint.textContent =
              "Ei lisättäviä tuloksia (vain oma profiili osuu hakuun tai kaikki jo valittu).";
          }
        }
        return;
      }
      if (hint) hint.textContent = "";
      resultsEl.classList.remove("hidden");
      for (const p of filtered) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn start-search-result-btn";
        const title = profileDisplayLabel(p, p.id);
        const un = (p.username || "").trim();
        btn.textContent = un ? `${title} (@${un})` : title;
        btn.addEventListener("click", () => {
          if (selected.has(p.id)) return;
          selected.add(p.id);
          labelById.set(p.id, title);
          const inp = /** @type {HTMLInputElement | null} */ (box.querySelector("#start-profile-search"));
          if (inp) inp.value = "";
          hideResults();
          renderSelectedChips();
        });
        resultsEl.appendChild(btn);
      }
      } catch (e) {
        console.error("[start session search]", e);
        if (hint) {
          hint.textContent = e instanceof Error ? e.message : "Haku epäonnistui.";
        }
        hideResults();
      }
    })();
  }

  box.innerHTML = "";
  if (!selfAnglerId) {
    box.innerHTML = '<p class="meta">Kirjautuminen puuttuu.</p>';
    confirm.disabled = true;
    return;
  }

  selected.add(selfAnglerId);

  const selfRow = document.createElement("p");
  selfRow.className = "meta start-self-line";
  selfRow.textContent = `Sinä: ${selfDisplayName || "Käyttäjä"} (aina mukana)`;

  const selWrap = document.createElement("div");
  selWrap.id = "start-selected-wrap";
  selWrap.className = "start-selected-chips";

  const searchWrap = document.createElement("div");
  searchWrap.className = "stack start-search-block";
  const searchLabel = document.createElement("div");
  searchLabel.className = "field-label";
  searchLabel.textContent = "Lisää osallistuja (haku)";
  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.inputMode = "search";
  searchInput.id = "start-profile-search";
  searchInput.autocomplete = "off";
  searchInput.placeholder = "Käyttäjätunnus tai näyttönimi";
  searchInput.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    const v = searchInput.value;
    searchTimer = setTimeout(() => {
      searchTimer = null;
      runSearch(v);
    }, 300);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = null;
      runSearch(searchInput.value);
    }
  });

  const searchResults = document.createElement("div");
  searchResults.id = "start-search-results";
  searchResults.className = "start-search-results hidden";

  const hint = document.createElement("p");
  hint.id = "start-search-hint";
  hint.className = "meta";

  searchWrap.append(searchLabel, searchInput, searchResults, hint);
  box.append(selfRow, selWrap, searchWrap);

  renderSelectedChips();
  confirm.disabled = false;

  confirm.onclick = async () => {
    selected.add(selfAnglerId);
    const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById("start-confirm"));
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Haetaan sijaintia…";
    }
    const loc = await fetchDeviceLocationBestEffort();
    const initialLocation =
      loc.lat != null && loc.lng != null
        ? {
            lat: loc.lat,
            lng: loc.lng,
            accuracyM: loc.accuracyM,
            timestamp: loc.timestamp ?? Date.now(),
          }
        : null;
    const r = await startSession([...selected], initialLocation);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Aloita";
    }
    if (!r.ok) {
      showError(r.reason);
      return;
    }

    if (!navigator.onLine) {
      setSyncStatus("offline");
    } else {
      setSyncStatus("syncing");
    }
    const authUserId = await getAuthUserId();
    if (!authUserId) {
      showError("Kirjautuminen puuttuu. Kirjaudu uudelleen.");
      activeSupabaseSessionId = null;
      setSyncStatus("error");
    } else {
    const { data, error } = await supabase
      .from("sessions")
      .insert([
        {
          title: r.title,
          notes: null,
          user_id: authUserId,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("[Supabase] sessions insert failed:", error.message, error);
      showError("Supabase-sessiota ei voitu tallentaa. Katso konsoli.");
      activeSupabaseSessionId = null;
      setSyncStatus(navigator.onLine ? "error" : "offline");
    } else if (data?.id) {
      activeSupabaseSessionId = data.id;
      setSyncStatus("synced");
      const localS = await getSessionById(r.sessionId);
      if (localS) {
        await putSession({ ...localS, supabaseSessionId: data.id });
      }
    } else {
      console.error("[Supabase] sessions insert: no row id returned", data);
      showError("Supabase-sessiota ei voitu tallentaa. Katso konsoli.");
      activeSupabaseSessionId = null;
      setSyncStatus(navigator.onLine ? "error" : "offline");
    }
    }

    activeSupabaseAnglerRows = null;
    supabaseAnglerRowByLocalId.clear();
    if (activeSupabaseSessionId && authUserId) {
      const selectedIds = [...selected];
      const nameById = await fetchProfileDisplayNames(selectedIds);
      const anglerEntries = selectedIds.map((uid) => {
        const label = nameById[uid];
        const name =
          typeof label === "string" && label.trim() ? label.trim() : "Kalastaja";
        return { user_id: uid, name };
      });

      const angIns = await insertSessionScopedAnglers(activeSupabaseSessionId, anglerEntries);
      if (!angIns.ok) {
        console.error("[Supabase] anglers (session-scoped):", angIns.error);
        showError(`Kalastajien tallennus pilveen epäonnistui: ${angIns.error}`);
        setSyncStatus(navigator.onLine ? "error" : "offline");
      } else {
        const rosterRes = await insertSessionAnglersForSelectedProfiles(
          activeSupabaseSessionId,
          selectedIds
        );
        if (!rosterRes.ok) {
          console.error("[Supabase] session_anglers:", rosterRes.error);
          showError("Supabase-sessioon ei voitu tallentaa kalastajalistaa. Katso konsoli.");
          setSyncStatus(navigator.onLine ? "error" : "offline");
        } else {
          const rosterSet = new Set(rosterRes.profileIds);
          activeSupabaseAnglerRows = rosterRes.profileIds.map((user_id) => ({
            session_id: activeSupabaseSessionId,
            user_id,
          }));
          let rosterOk = true;
          for (const localId of selectedIds) {
            if (!rosterSet.has(localId)) continue;
            const anglersRowId = angIns.idByUserId.get(localId);
            if (!anglersRowId) {
              rosterOk = false;
              showError("Kalastajan anglers-id puuttui pilvistä. Yritä uudelleen.");
              setSyncStatus("error");
              break;
            }
            supabaseAnglerRowByLocalId.set(localId, { id: anglersRowId });
            const sa = await findSessionAngler(r.sessionId, localId);
            if (sa) {
              await putSessionAngler({ ...sa, supabaseAnglerId: anglersRowId });
            }
          }
          if (rosterOk) {
            setSyncStatus("synced");
          }
        }
      }
    }

    document.getElementById("start-overlay")?.classList.add("hidden");
    selected.clear();
    closeCatchesOverlay();
    closeSessionEndOverlay();
    await renderHome();
  };
}

/**
 * @param {string} s
 */
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function wireSpeciesButtons() {
  const box = document.getElementById("species-buttons");
  if (!box) return;
  box.innerHTML = "";
  for (const key of SPECIES_OPTIONS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.dataset.species = key;
    b.textContent = SPECIES_LABELS[key] || key;
    b.addEventListener("click", () => {
      fishState.species = key;
      box.querySelectorAll("button").forEach((el) => {
        el.classList.toggle("btn-selected", el.dataset.species === key);
      });
      const next = document.getElementById("fish-next-2");
      if (next) next.disabled = false;
    });
    box.appendChild(b);
  }
}

function wireFishMeasurementInputs() {
  const len = document.getElementById("fish-input-length");
  const w = document.getElementById("fish-input-weight");
  const depth = document.getElementById("fish-input-depth");
  const wt = document.getElementById("fish-input-water-temp");
  len?.addEventListener("input", () => syncFishStateFromMeasurementInputs());
  w?.addEventListener("input", () => syncFishStateFromMeasurementInputs());
  depth?.addEventListener("input", () => syncFishStateFromMeasurementInputs());
  wt?.addEventListener("input", () => syncFishStateFromMeasurementInputs());
}

/**
 * Prefill depth and water temperature from the most recent catch in the active session.
 */
async function prefillTelemetryFromLastCatch() {
  const depthEl = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-depth"));
  const tempEl = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-water-temp"));
  if (!depthEl || !tempEl) return;
  depthEl.value = "";
  tempEl.value = "";
  fishState.depthStr = "";
  fishState.waterTempStr = "";
  const session = await getActiveSessionForParticipantUi();
  if (!session) return;
  const catches = await getCatchesForSession(session.id);
  const last = catches[0];
  if (!last) return;
  const d = last.depth_m;
  const t = last.water_temp_c;
  if (d != null && Number.isFinite(d)) {
    depthEl.value = String(d);
    fishState.depthStr = depthEl.value;
  }
  if (t != null && Number.isFinite(t)) {
    tempEl.value = String(t);
    fishState.waterTempStr = tempEl.value;
  }
}

function showFishStep(n) {
  fishState.step = n;
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`fish-step-${i}`);
    if (el) el.classList.toggle("hidden", i !== n);
  }
}

/**
 * @param {import('./db.js').CatchRecord} record
 */
async function openFishOverlayForEdit(record) {
  closeCatchesOverlay();
  closeSessionEndOverlay();
  fishState = freshFishState();
  fishState.editingCatchId = record.id;
  fishState.anglerId = record.anglerId;
  fishState.species = record.species;
  fishState.notes = (record.notes || "").trim();
  fishState.lengthStr =
    record.length != null && typeof record.length === "number" && record.length >= 1
      ? String(record.length)
      : "";
  fishState.weightStr = "";
  if (record.weight_kg != null && typeof record.weight_kg === "number" && Number.isFinite(record.weight_kg)) {
    fishState.weightStr = String(record.weight_kg);
  }
  fishState.depthStr = "";
  if (record.depth_m != null && typeof record.depth_m === "number" && Number.isFinite(record.depth_m)) {
    fishState.depthStr = String(record.depth_m);
  }
  fishState.waterTempStr = "";
  if (
    record.water_temp_c != null &&
    typeof record.water_temp_c === "number" &&
    Number.isFinite(record.water_temp_c)
  ) {
    fishState.waterTempStr = String(record.water_temp_c);
  }

  const next2 = document.getElementById("fish-next-2");
  if (next2) next2.disabled = !fishState.species;

  const sumEl = document.getElementById("fish-save-summary");
  if (sumEl) sumEl.textContent = "";

  wireSpeciesButtons();
  if (fishState.species) {
    const sbox = document.getElementById("species-buttons");
    sbox?.querySelectorAll("button").forEach((el) => {
      const key = el.dataset.species;
      el.classList.toggle("btn-selected", key === fishState.species);
    });
  }

  clearFishMeasurementInputs();
  const len = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-length"));
  const w = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-weight"));
  const depth = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-depth"));
  const wt = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-water-temp"));
  const notes = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("fish-notes"));
  if (len) len.value = fishState.lengthStr;
  if (w) w.value = fishState.weightStr;
  if (depth) depth.value = fishState.depthStr;
  if (wt) wt.value = fishState.waterTempStr;
  if (notes) notes.value = fishState.notes;
  syncFishStateFromMeasurementInputs();

  await populateFishAnglers();
  const abox = document.getElementById("fish-angler-buttons");
  abox?.querySelectorAll("button").forEach((el) => {
    const aid = el.dataset.anglerId;
    if (aid === record.anglerId) {
      el.classList.add("btn-selected");
    }
  });

  showFishStep(2);
  document.getElementById("fish-overlay")?.classList.remove("hidden");
}

async function openFishOverlay() {
  fishState = freshFishState();
  const next2 = document.getElementById("fish-next-2");
  if (next2) next2.disabled = true;
  const box = document.getElementById("species-buttons");
  box?.querySelectorAll("button").forEach((el) => el.classList.remove("btn-selected"));
  const notes = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("fish-notes"));
  if (notes) notes.value = "";
  clearFishMeasurementInputs();
  fishState.lengthStr = "";
  fishState.weightStr = "";
  fishState.depthStr = "";
  fishState.waterTempStr = "";
  const sumEl = document.getElementById("fish-save-summary");
  if (sumEl) sumEl.textContent = "";
  wireSpeciesButtons();
  await populateFishAnglers();
  await prefillTelemetryFromLastCatch();
  showFishStep(1);
  document.getElementById("fish-overlay")?.classList.remove("hidden");
}

async function populateFishAnglers() {
  const session = await getActiveSessionForParticipantUi();
  const box = document.getElementById("fish-angler-buttons");
  if (!box || !session) return;
  const sas = await getSessionAnglersForSession(session.id);
  const active = sas.filter((x) => x.isActive);
  const nameById = await fetchProfileDisplayNames(active.map((sa) => sa.anglerId));
  box.innerHTML = "";
  if (active.length === 0) {
    box.innerHTML = '<p class="meta">Ei aktiivisia kalastajia sessiossa.</p>';
    return;
  }
  for (const sa of active) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.dataset.anglerId = sa.anglerId;
    b.textContent = nameById[sa.anglerId] || sa.anglerId;
    b.addEventListener("click", () => {
      fishState.anglerId = sa.anglerId;
      box.querySelectorAll("button").forEach((el) => el.classList.remove("btn-selected"));
      b.classList.add("btn-selected");
      showFishStep(2);
    });
    box.appendChild(b);
  }
}

/** True after main app listeners are wired (once). */
let mainAppStarted = false;
/** History session detail menu open state (3-dot). */
let catchesSessionMenuOpen = false;
/** Session id currently attached to history detail menu actions. */
let catchesSessionMenuSessionId = /** @type {string | null} */ (null);

function showAuthGate() {
  document.getElementById("auth-gate")?.classList.remove("hidden");
  document.getElementById("app")?.classList.add("hidden");
}

function showMainApp() {
  document.getElementById("auth-gate")?.classList.add("hidden");
  document.getElementById("app")?.classList.remove("hidden");
}

function syncCatchesSessionMenuUi() {
  const btn = document.getElementById("catches-session-menu-btn");
  const menu = document.getElementById("catches-session-menu");
  if (!btn || !menu) return;
  btn.setAttribute("aria-expanded", catchesSessionMenuOpen ? "true" : "false");
  menu.classList.toggle("hidden", !catchesSessionMenuOpen);
}

/**
 * @param {{ user_metadata?: Record<string, unknown> } | null} user
 */
function updateUserDisplayName(user) {
  const el = document.getElementById("user-display-name");
  if (!el) return;
  el.textContent = user ? getDisplayNameFromUser(user) : "";
}

function setAuthMessage(msg) {
  const p = document.getElementById("auth-message");
  if (!p) return;
  if (!msg) {
    p.hidden = true;
    p.textContent = "";
    return;
  }
  p.hidden = false;
  p.textContent = msg;
}

/** Last user id used for IndexedDB scope; detects account switch without full reload. */
let lastIndexedDbUserId = /** @type {string | null} */ (null);

/** True while user must set a new password (email recovery link). Blocks normal SIGNED_IN activation. */
let passwordRecoveryPending = false;

const AUTH_PANEL_IDS = ["auth-login", "auth-signup", "auth-forgot", "auth-reset-password"];

/**
 * @param {"auth-login" | "auth-signup" | "auth-forgot" | "auth-reset-password"} panelId
 */
function showAuthPanel(panelId) {
  for (const id of AUTH_PANEL_IDS) {
    document.getElementById(id)?.classList.toggle("hidden", id !== panelId);
  }
}

function showAuthLoginPanel() {
  showAuthPanel("auth-login");
}

/**
 * Recovery sessions carry `amr` with method `recovery` in the access token (implicit + PKCE).
 * @param {import("@supabase/supabase-js").Session | null} session
 * @returns {boolean}
 */
function sessionIsPasswordRecovery(session) {
  if (!session?.access_token) return false;
  try {
    const part = session.access_token.split(".")[1];
    if (!part) return false;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = /** @type {Record<string, unknown>} */ (JSON.parse(json));
    const amr = payload.amr;
    if (Array.isArray(amr)) {
      const hit = amr.some((entry) => {
        if (entry === "recovery") return true;
        if (entry && typeof entry === "object" && "method" in entry) {
          return /** @type {{ method?: string }} */ (entry).method === "recovery";
        }
        return false;
      });
      if (hit) return true;
    }
    return payload.role === "recovery";
  } catch {
    return false;
  }
}

function showPasswordRecoveryUi() {
  passwordRecoveryPending = true;
  showAuthGate();
  showAuthPanel("auth-reset-password");
  setAuthMessage("");
}

/** Supabase puts auth errors in the URL hash (e.g. expired reset link). */
function consumeAuthHashErrors() {
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const err = params.get("error");
  const code = params.get("error_code");
  if (!err && !code) return;
  let msg = "Linkki ei toimi tai se on vanhentunut.";
  if (code === "otp_expired") {
    msg = "Salasanan palautuslinkki on vanhentunut. Pyydä uusi linkki (Unohtuiko salasana?).";
  } else {
    const desc = params.get("error_description");
    if (desc) {
      try {
        msg = decodeURIComponent(desc.replace(/\+/g, " "));
      } catch {
        msg = desc;
      }
    }
  }
  setAuthMessage(msg);
  try {
    const path = window.location.pathname + (window.location.search || "");
    history.replaceState(null, "", path || "/");
  } catch {
    /* ignore */
  }
}
let authDebugVisible = false;
let authDebugLastStep = "idle";
let authDebugLastError = "";

function onAuthSignedOut() {
  activeSupabaseSessionId = null;
  activeSupabaseAnglerRows = null;
  supabaseAnglerRowByLocalId.clear();
  setParticipantSessionFetchResult(false, [], []);
  clearParticipantSessionPoll();
  sessionTitleNeedsCloudSync = false;
  stopSessionTimer();
  fishState.editingCatchId = null;
  homeAnglersExpanded = false;
  closeProfileOverlay();
  document.getElementById("fish-overlay")?.classList.add("hidden");
  document.getElementById("catches-overlay")?.classList.add("hidden");
  document.getElementById("start-overlay")?.classList.add("hidden");
  document.getElementById("session-end-overlay")?.classList.add("hidden");
  document.getElementById("session-summary-overlay")?.classList.add("hidden");
  setIndexedDbUserId(null);
  lastIndexedDbUserId = null;
}

/** Remove old shared localStorage keys once. */
function purgeLegacyLocalStorageKeysOnce() {
  try {
    const marker = "fishlogger_local_user_scope_migrated_v1";
    if (localStorage.getItem(marker) === "1") return;
    localStorage.removeItem("sessions");
    localStorage.removeItem("catches");
    localStorage.removeItem("anglers");
    localStorage.removeItem("active_session");
    localStorage.setItem(marker, "1");
  } catch (err) {
    console.warn("[Auth] localStorage migration skipped:", err);
  }
}

function setAuthDebugStep(step) {
  authDebugLastStep = step;
}

function setAuthDebugError(msg) {
  authDebugLastError = msg || "";
}

async function refreshAuthDebugOutput() {
  const out = document.getElementById("auth-debug-output");
  if (!out) return;
  const online = navigator.onLine ? "online" : "offline";
  const hasMain = !document.getElementById("app")?.classList.contains("hidden");
  const authMessage = document.getElementById("auth-message")?.textContent?.trim() || "";
  let sessionUid = "";
  let sessionEmail = "";
  try {
    const maybe = await withTimeout(supabase.auth.getSession(), 1200);
    if (maybe && !(typeof maybe === "object" && "timedOut" in maybe)) {
      sessionUid = maybe?.data?.session?.user?.id || "";
      sessionEmail = maybe?.data?.session?.user?.email || "";
    }
  } catch {
    /* ignore diagnostics read failures */
  }
  out.textContent = [
    `time: ${new Date().toISOString()}`,
    `step: ${authDebugLastStep}`,
    `last_error: ${authDebugLastError || "-"}`,
    `online: ${online}`,
    `app_visible: ${hasMain ? "yes" : "no"}`,
    `auth_message: ${authMessage || "-"}`,
    `scoped_user_id: ${lastIndexedDbUserId || "-"}`,
    `session_user_id: ${sessionUid || "-"}`,
    `session_email: ${sessionEmail || "-"}`,
  ].join("\n");
}

function toggleAuthDebugPanel(force) {
  const panel = document.getElementById("auth-debug-panel");
  if (!panel) return;
  authDebugVisible = typeof force === "boolean" ? force : !authDebugVisible;
  panel.classList.toggle("hidden", !authDebugVisible);
  if (authDebugVisible) void refreshAuthDebugOutput();
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T | { timedOut: true }>}
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve({ timedOut: true }), ms);
    }),
  ]);
}

/**
 * Non-throwing best-effort session activation.
 * @returns {Promise<boolean>}
 */
async function tryActivateExistingSession() {
  try {
    const maybeSession = await withTimeout(supabase.auth.getSession(), 1500);
    if (!maybeSession || (typeof maybeSession === "object" && "timedOut" in maybeSession)) {
      return false;
    }
    const session = maybeSession?.data?.session;
    if (!session?.user) return false;
    await activateSignedInUser(session.user);
    return true;
  } catch {
    return false;
  }
}

/**
 * Activates app state for a signed-in user.
 * @param {{ id: string, user_metadata?: Record<string, unknown> }} user
 */
async function activateSignedInUser(user) {
  const uid = user.id;
  if (lastIndexedDbUserId && lastIndexedDbUserId !== uid) {
    activeSupabaseSessionId = null;
    activeSupabaseAnglerRows = null;
    supabaseAnglerRowByLocalId.clear();
    sessionTitleNeedsCloudSync = false;
  }
  lastIndexedDbUserId = uid;
  setIndexedDbUserId(uid);
  try {
    await purgeLegacyFishLoggerDatabase();
  } catch (err) {
    console.warn("[Auth] legacy IndexedDB purge skipped:", err);
  }
  try {
    if (navigator.onLine) {
      const pr = await upsertProfileForUser(user);
      if (!pr.ok) console.warn("[Auth] profile upsert:", pr.error);
    }
  } catch (err) {
    console.warn("[Auth] profile upsert failed:", err);
  }
  try {
    await ensureLoggedInUserAnglerWithUser(user);
  } catch (err) {
    console.warn("[Auth] ensureLoggedInUserAngler:", err);
  }
  showMainApp();
  updateUserDisplayName(user);
  if (!mainAppStarted) {
    mainAppInit();
    mainAppStarted = true;
  } else {
    await renderHome();
  }
}

function wireAuthUi() {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      toggleAuthDebugPanel();
    }
  });
  document.getElementById("auth-debug-refresh")?.addEventListener("click", () => {
    void refreshAuthDebugOutput();
  });

  document.getElementById("auth-go-signup")?.addEventListener("click", () => {
    showAuthPanel("auth-signup");
    setAuthMessage("");
  });
  document.getElementById("auth-go-login")?.addEventListener("click", () => {
    showAuthLoginPanel();
    setAuthMessage("");
  });
  document.getElementById("auth-go-forgot")?.addEventListener("click", () => {
    showAuthPanel("auth-forgot");
    setAuthMessage("");
  });
  document.getElementById("auth-forgot-back")?.addEventListener("click", () => {
    showAuthLoginPanel();
    setAuthMessage("");
  });
  document.getElementById("auth-forgot-submit")?.addEventListener("click", async () => {
    const emailEl = /** @type {HTMLInputElement | null} */ (document.getElementById("auth-forgot-email"));
    const email = emailEl?.value?.trim() ?? "";
    setAuthMessage("");
    if (!email) {
      setAuthMessage("Anna sähköposti.");
      return;
    }
    const { error } = await sendPasswordResetEmail(email);
    if (error) {
      setAuthMessage(formatAuthErrorForUi(error));
      return;
    }
    setAuthMessage(
      "Tarkista sähköposti: lähetimme linkin salasanan vaihtoon. Jos et näe viestiä, tarkista roskaposti."
    );
    showAuthLoginPanel();
  });
  document.getElementById("auth-reset-submit")?.addEventListener("click", async () => {
    const p1 = /** @type {HTMLInputElement | null} */ (document.getElementById("auth-reset-pass"));
    const p2 = /** @type {HTMLInputElement | null} */ (document.getElementById("auth-reset-pass2"));
    const a = p1?.value ?? "";
    const b = p2?.value ?? "";
    setAuthMessage("");
    if (a.length < 6) {
      setAuthMessage("Salasanan on oltava vähintään 6 merkkiä.");
      return;
    }
    if (a !== b) {
      setAuthMessage("Salasanat eivät täsmää.");
      return;
    }
    const { error } = await updatePassword(a);
    if (error) {
      setAuthMessage(formatAuthErrorForUi(error));
      return;
    }
    passwordRecoveryPending = false;
    if (p1) p1.value = "";
    if (p2) p2.value = "";
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      setAuthMessage("");
      await activateSignedInUser(user);
    }
  });

  document.getElementById("auth-login-submit")?.addEventListener("click", async () => {
    const submitBtn = /** @type {HTMLButtonElement | null} */ (
      document.getElementById("auth-login-submit")
    );
    const emailEl = /** @type {HTMLInputElement | null} */ (document.getElementById("auth-login-email"));
    const passEl = /** @type {HTMLInputElement | null} */ (document.getElementById("auth-login-password"));
    const email = emailEl?.value?.trim() ?? "";
    const password = passEl?.value ?? "";
    setAuthMessage("");
    if (!email || !password) {
      setAuthMessage("Anna sähköposti ja salasana.");
      return;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Kirjaudutaan…";
    }
    let requestSettled = false;
    const loginWatchdogId = setTimeout(() => {
      if (requestSettled) return;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Kirjaudu";
      }
      setAuthMessage("Kirjautuminen aikakatkaistiin. Tarkista yhteys ja yritä uudelleen.");
      // Non-blocking recovery probe in case sign-in actually completed server-side.
      void tryActivateExistingSession().then((ok) => {
        if (ok) setAuthMessage("");
      });
    }, 12000);
    try {
      setAuthDebugStep("sign_in_start");
      setAuthMessage("Kirjaudutaan…");
      const res = await signInWithEmail(email, password);
      const { data, error } = res;
      if (error) {
        setAuthDebugStep("sign_in_error");
        setAuthDebugError(error.message || "unknown");
        if (error.message.toLowerCase().includes("invalid login credentials")) {
          setAuthMessage("Virheellinen sähköposti tai salasana.");
        } else if (error.message.toLowerCase().includes("email not confirmed")) {
          setAuthMessage("Sähköpostia ei ole vahvistettu.");
        } else {
          setAuthMessage(formatAuthErrorForUi(error));
        }
        return;
      }
      // Some clients/environments may not immediately deliver SIGNED_IN callback.
      if (data?.user) {
        setAuthDebugStep("sign_in_user_payload");
        setAuthDebugError("");
        await activateSignedInUser(data.user);
        setAuthMessage("");
      } else {
        setAuthDebugStep("sign_in_no_user_payload");
        const ok = await tryActivateExistingSession();
        if (ok) {
          setAuthDebugStep("sign_in_recovered_from_session");
          setAuthDebugError("");
          setAuthMessage("");
        } else {
          setAuthDebugStep("sign_in_unresolved_no_session");
          setAuthDebugError("no user payload and no session");
          setAuthMessage("Kirjautuminen ei valmistunut. Yritä uudelleen.");
        }
      }
    } catch (err) {
      setAuthDebugStep("sign_in_exception");
      setAuthDebugError(String(err));
      setAuthMessage("Kirjautuminen epäonnistui. Yritä uudelleen.");
      console.error("[Auth] sign-in failed:", err);
    } finally {
      requestSettled = true;
      clearTimeout(loginWatchdogId);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Kirjaudu";
      }
      if (authDebugVisible) void refreshAuthDebugOutput();
    }
  });

  document.getElementById("auth-signup-submit")?.addEventListener("click", async () => {
    const fnEl = /** @type {HTMLInputElement | null} */ (document.getElementById("auth-signup-first"));
    const lnEl = /** @type {HTMLInputElement | null} */ (document.getElementById("auth-signup-last"));
    const unEl = /** @type {HTMLInputElement | null} */ (document.getElementById("auth-signup-username"));
    const emailEl = /** @type {HTMLInputElement | null} */ (document.getElementById("auth-signup-email"));
    const passEl = /** @type {HTMLInputElement | null} */ (document.getElementById("auth-signup-password"));
    const pass2El = /** @type {HTMLInputElement | null} */ (document.getElementById("auth-signup-password2"));
    const fn = fnEl?.value?.trim() ?? "";
    const ln = lnEl?.value?.trim() ?? "";
    const usernameRaw = unEl?.value?.trim() ?? "";
    const email = emailEl?.value?.trim() ?? "";
    const password = passEl?.value ?? "";
    const password2 = pass2El?.value ?? "";
    setAuthMessage("");
    if (!fn || !ln) {
      setAuthMessage("Anna etunimi ja sukunimi.");
      return;
    }
    if (!email || !password) {
      setAuthMessage("Anna sähköposti ja salasana.");
      return;
    }
    if (password.length < 6) {
      setAuthMessage("Salasanan on oltava vähintään 6 merkkiä.");
      return;
    }
    if (password !== password2) {
      setAuthMessage("Salasanat eivät täsmää.");
      return;
    }
    const { data, error } = await signUpWithProfile(email, password, fn, ln, usernameRaw);
    if (error) {
      setAuthMessage(formatAuthErrorForUi(error));
      return;
    }
    if (data?.user && !data.session) {
      setAuthMessage("Tarkista sähköposti ja vahvista tili, jos vahvistus on käytössä.");
    }
  });

}

async function bootstrap() {
  setAuthDebugStep("bootstrap_start");
  purgeLegacyLocalStorageKeysOnce();
  const initialHash = window.location.hash || "";
  const initialSearch = window.location.search || "";
  const looksLikeRecovery =
    /type=recovery|type%3Drecovery/i.test(initialHash) ||
    /type=recovery|type%3Drecovery/i.test(initialSearch);
  if (looksLikeRecovery) {
    passwordRecoveryPending = true;
  }

  consumeAuthHashErrors();

  wireAuthUi();

  supabase.auth.onAuthStateChange((event, session) => {
    void handleAuthStateChange(event, session);
  });

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.user) {
    setAuthDebugStep("bootstrap_session_found");
    if (passwordRecoveryPending || sessionIsPasswordRecovery(session)) {
      showPasswordRecoveryUi();
    } else {
      await activateSignedInUser(session.user);
    }
  } else {
    setAuthDebugStep("bootstrap_no_session");
    showAuthGate();
    if (passwordRecoveryPending) {
      showAuthPanel("auth-reset-password");
      setAuthMessage("");
    }
  }
}

/**
 * @param {import("@supabase/supabase-js").AuthChangeEvent} event
 * @param {import("@supabase/supabase-js").Session | null} session
 */
async function handleAuthStateChange(event, session) {
  if (event === "INITIAL_SESSION") {
    if (session && sessionIsPasswordRecovery(session)) {
      showPasswordRecoveryUi();
    }
    return;
  }
  if (event === "PASSWORD_RECOVERY") {
    showPasswordRecoveryUi();
    return;
  }
  if (event === "SIGNED_IN" && session?.user) {
    if (passwordRecoveryPending || sessionIsPasswordRecovery(session)) {
      showPasswordRecoveryUi();
      return;
    }
    await activateSignedInUser(session.user);
  }
  if (event === "SIGNED_OUT") {
    passwordRecoveryPending = false;
    showAuthGate();
    showAuthLoginPanel();
    updateUserDisplayName(null);
    if (mainAppStarted) onAuthSignedOut();
  }
}

function mainAppInit() {
  wireProfileUi({
    onError: showError,
    onOpen: () => {
      void renderHome();
    },
  });
  wireFishMeasurementInputs();
  wireSessionTitleEditor();
  renderSyncStatusIndicator();
  window.addEventListener("online", () => {
    setSyncStatus("syncing");
    void syncPendingSessionTitleToCloud();
    if (!sessionTitleNeedsCloudSync) setSyncStatus("synced");
  });
  window.addEventListener("offline", () => {
    setSyncStatus("offline");
  });

  document.getElementById("btn-open-start")?.addEventListener("click", async () => {
    closeCatchesOverlay();
    closeSessionEndOverlay();
    closeSessionSummaryOverlay();
    const selfId = await ensureLoggedInUserAngler();
    if (!selfId) {
      showError("Kirjautuminen puuttuu.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const selfName = user ? getDisplayNameFromUser(user) : "";
    buildStartSessionParticipantPicker(selfId, selfName);
    document.getElementById("start-overlay")?.classList.remove("hidden");
  });

  document.getElementById("start-cancel")?.addEventListener("click", () => {
    document.getElementById("start-overlay")?.classList.add("hidden");
  });

  document.getElementById("btn-end-session")?.addEventListener("click", () => {
    openSessionEndOverlay();
  });

  document.getElementById("session-end-cancel")?.addEventListener("click", () => {
    closeSessionEndOverlay();
  });

  document.getElementById("session-end-final")?.addEventListener("click", async () => {
    const activeBefore = await getActiveSessionForParticipantUi();
    if (!activeBefore) return;
    const endedSessionId = activeBefore.id;
    const cloudSidForEnd = activeSupabaseSessionId;
    closeSessionEndOverlay();
    const r = await endActiveSession();
    if (!r.ok) {
      showError(r.reason);
      return;
    }
    if (cloudSidForEnd && navigator.onLine) {
      const { error: endedErr } = await supabase
        .from("sessions")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", cloudSidForEnd);
      if (endedErr) {
        console.warn("[Session] ended_at update:", endedErr.message);
      }
    }
    activeSupabaseSessionId = null;
    activeSupabaseAnglerRows = null;
    supabaseAnglerRowByLocalId.clear();
    await renderHome();
    showSuccess("Sessio päättyi");
    await openSessionSummaryOverlay(endedSessionId);
  });

  document.getElementById("btn-toggle-anglers")?.addEventListener("click", () => {
    homeAnglersExpanded = !homeAnglersExpanded;
    syncHomeAnglersToggleUi();
  });

  document.getElementById("btn-show-catches")?.addEventListener("click", () => {
    closeSessionEndOverlay();
    closeSessionSummaryOverlay();
    openCatchesOverlay();
  });

  document.getElementById("catches-close")?.addEventListener("click", () => {
    catchesSessionMenuOpen = false;
    syncCatchesSessionMenuUi();
    closeCatchesOverlay();
  });
  document.getElementById("catches-session-menu-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    catchesSessionMenuOpen = !catchesSessionMenuOpen;
    syncCatchesSessionMenuUi();
  });
  document.getElementById("catches-session-menu-export-csv")?.addEventListener("click", (e) => {
    e.stopPropagation();
    catchesSessionMenuOpen = false;
    syncCatchesSessionMenuUi();
    const sessionId = catchesSessionMenuSessionId;
    if (!sessionId) return;
    void handleExportEndedSessionCsv(sessionId);
  });
  document.getElementById("catches-session-menu-delete")?.addEventListener("click", () => {
    catchesSessionMenuOpen = false;
    syncCatchesSessionMenuUi();
    const sessionId = catchesSessionMenuSessionId;
    if (!sessionId) return;
    const confirmed = window.confirm("Delete this session?");
    if (!confirmed) return;
    void (async () => {
      try {
        const ok = await deleteSessionCloudThenLocal(sessionId);
        if (!ok) return;
        navigateHomeFromSessionDetail();
        await renderHome();
        showSuccess("Sessio poistettu");
      } catch (err) {
        console.error("[Session] delete failed:", err);
        alert("Failed to delete session");
      }
    })();
  });

  document.getElementById("btn-log-catch")?.addEventListener("click", () => {
    closeCatchesOverlay();
    closeSessionEndOverlay();
    closeSessionSummaryOverlay();
    void openFishOverlay();
  });

  document.getElementById("session-summary-close")?.addEventListener("click", () => {
    closeSessionSummaryOverlay();
  });

  document.getElementById("fish-close")?.addEventListener("click", () => {
    fishState.editingCatchId = null;
    document.getElementById("fish-overlay")?.classList.add("hidden");
  });

  document.getElementById("fish-back-2")?.addEventListener("click", () => showFishStep(1));
  document.getElementById("fish-next-2")?.addEventListener("click", () => {
    if (!fishState.species) return;
    syncFishStateFromMeasurementInputs();
    showFishStep(3);
  });
  document.getElementById("fish-back-3")?.addEventListener("click", () => showFishStep(2));

  document.getElementById("fish-save")?.addEventListener("click", async () => {
    syncFishStateFromMeasurementInputs();
    const notesEl = /** @type {HTMLTextAreaElement | null} */ (document.getElementById("fish-notes"));
    fishState.notes = notesEl?.value || "";
    if (!fishState.anglerId) {
      alert("Valitse kalastaja.");
      return;
    }
    const lenP = parseOptionalLengthCm(fishState.lengthStr);
    if (!lenP.ok) {
      alert(lenP.reason);
      return;
    }
    const weightP = parseOptionalWeightKg(fishState.weightStr);
    if (!weightP.ok) {
      alert(weightP.reason);
      return;
    }
    const depthP = parseOptionalDepthM(fishState.depthStr);
    if (!depthP.ok) {
      alert(depthP.reason);
      return;
    }
    const wtP = parseOptionalWaterTempC(fishState.waterTempStr);
    if (!wtP.ok) {
      alert(wtP.reason);
      return;
    }
    const btn = /** @type {HTMLButtonElement | null} */ (document.getElementById("fish-save"));
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Tallennetaan…";
    }
    let loc = {
      lat: /** @type {number | null} */ (null),
      lng: /** @type {number | null} */ (null),
      accuracyM: /** @type {number | null} */ (null),
      timestamp: /** @type {number | null} */ (null),
      source: /** @type {string | null} */ (null),
    };
    try {
      loc = await fetchDeviceLocationBestEffort();
    } catch {
      /* save without location */
    }

    const inputPayload = {
      anglerId: fishState.anglerId,
      species: fishState.species || "",
      length: lenP.value,
      weight_kg: weightP.value,
      notes: fishState.notes,
      depth_m: depthP.value,
      water_temp_c: wtP.value,
    };

    if (fishState.editingCatchId) {
      const existing = await getCatchById(fishState.editingCatchId);
      if (!existing) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Tallenna";
        }
        showError("Saalista ei löytynyt.");
        return;
      }
      const result = await updateCatch(inputPayload, loc, existing);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Tallenna";
      }
      if (!result.ok) {
        showError(result.reason);
        return;
      }
      const syncUp = await syncCatchUpdateToSupabase(result.record);
      if (syncUp && !syncUp.ok) {
        setSyncStatus(navigator.onLine ? "error" : "offline");
        showError(`Supabase synkronointi epäonnistui: ${syncUp.error}`);
      } else if (syncUp && syncUp.ok) {
        setSyncStatus("synced");
      }
      fishState.editingCatchId = null;
      document.getElementById("fish-overlay")?.classList.add("hidden");
      showSuccess("Muutokset tallennettu");
      await refreshCatchesTableIfOpen();
      await renderHome();
      return;
    }

    const result = await saveCatch(inputPayload, loc);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Tallenna";
    }
    if (!result.ok) {
      showError(result.reason);
      return;
    }
    const summaryEl = document.getElementById("fish-save-summary");
    if (summaryEl) {
      summaryEl.textContent = formatSaveSuccessSummary(loc, result.record);
    }

    const savedCatch = result.record;
    const syncCreate = await syncCatchCreateToSupabase(savedCatch);
    if (syncCreate && !syncCreate.ok) {
      console.error("[Supabase] catches insert failed:", syncCreate.error);
      setSyncStatus(navigator.onLine ? "error" : "offline");
      showError(`Supabase-tallennus epäonnistui: ${syncCreate.error}`);
    } else if (syncCreate && syncCreate.ok) {
      setSyncStatus("synced");
    }

    showFishStep(4);
    await refreshCatchesTableIfOpen();
    await renderHome();
  });

  document.getElementById("fish-add-another")?.addEventListener("click", () => {
    closeCatchesOverlay();
    void openFishOverlay();
  });

  document.getElementById("fish-back-home")?.addEventListener("click", () => {
    fishState.editingCatchId = null;
    document.getElementById("fish-overlay")?.classList.add("hidden");
  });

  document.addEventListener("click", (e) => {
    document.querySelectorAll(".catch-card-menu").forEach((m) => {
      if (!m.hidden) {
        m.hidden = true;
        const t = m.previousElementSibling;
        if (t?.classList.contains("catch-card-menu-trigger")) {
          t.setAttribute("aria-expanded", "false");
        }
      }
    });
    if (!catchesSessionMenuOpen) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest(".catches-session-menu-wrap")) return;
    catchesSessionMenuOpen = false;
    syncCatchesSessionMenuUi();
  });

  renderHome();
}

void bootstrap();
