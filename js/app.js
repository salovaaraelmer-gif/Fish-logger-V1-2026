/**
 * Fish Logger V1 — UI and wiring.
 */

import {
  getAllAnglers,
  putAngler,
  getSessionAnglersForSession,
  getActiveSession,
  getCatchesForSession,
  getCatchById,
  deleteCatch,
} from "./db.js";
import {
  startSession,
  endActiveSession,
  addAnglerToSession,
  markAnglerInactive,
  markActiveSessionCsvExported,
  newId,
} from "./sessionService.js";
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

/** @type {Record<string, string>} */
const SPECIES_LABELS = {
  pike: "Hauki",
  perch: "Ahven",
  zander: "Kuha",
  trout: "Taimen",
  other: "Muu",
};

/** App species key → Supabase `catches.species` (pike, perch, zander, trout, …). */
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

/** Active Supabase `sessions.id` after a successful cloud insert when starting a session; cleared when the session ends. */
let activeSupabaseSessionId = null;

/** Rows returned from the Supabase `anglers` insert for the active session; cleared when the session ends or on insert failure. */
let activeSupabaseAnglerRows = null;

/** Local angler id → Supabase angler row (includes `id`) for the active session. */
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
 * @param {import('./catchService.js').DeviceLocation} loc
 * @param {import('./db.js').CatchRecord} saved
 */
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
 * @param {number} ts
 * @param {boolean} activeSession — if true, HH:MM only (24h, colon); if false, date + time (fi-FI)
 */
function formatCatchListTime(ts, activeSession) {
  const d = new Date(ts);
  if (activeSession) {
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
  return d.toLocaleString("fi-FI", { dateStyle: "short", timeStyle: "short" });
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
 * @param {{ activeSession?: boolean, allowEditDelete?: boolean }} [listOptions] — activeSession true: catch time HH:MM only; false: date + time
 * @returns {Promise<number>} number of catches rendered
 */
async function renderCatchList(container, sessionId, emptyPlaceholderRow, listOptions = {}) {
  if (!container) return 0;
  const activeSession = listOptions.activeSession === true;
  const allowEditDelete = listOptions.allowEditDelete === true;
  const [catches, anglers] = await Promise.all([getCatchesForSession(sessionId), getAllAnglers()]);
  const nameById = Object.fromEntries(anglers.map((a) => [a.id, a.displayName]));
  const sorted = [...catches].sort((a, b) => b.timestamp - a.timestamp);
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
 * @param {import('./db.js').Session | null | undefined} session
 */
function updateSessionEndCsvStatus(session) {
  const el = document.getElementById("session-end-csv-status");
  if (!el) return;
  if (session && session.csv_exported === true) {
    el.textContent = "CSV saved";
  } else {
    el.textContent = "CSV not saved";
  }
}

/**
 * Fills the session catches table from IndexedDB.
 * @param {string | undefined} sessionIdOverride - if set, load this session (e.g. just ended).
 */
async function populateCatchesTable(sessionIdOverride) {
  const titleEl = document.getElementById("catches-overlay-title");
  const listEl = document.getElementById("catches-table-body");
  const stripEl = document.getElementById("catches-session-strip");
  const emptyEl = document.getElementById("catches-empty");
  const wrap = document.getElementById("catches-table-wrap");
  if (!listEl) return;

  let sessionId = sessionIdOverride;
  let overlayTitle = "Saaliit tässä sessiossa";
  let emptyMsg = "Ei saaliita tässä sessiossa.";

  if (!sessionId) {
    const session = await getActiveSession();
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
    if (titleEl) titleEl.textContent = overlayTitle;
    listEl.setAttribute("aria-label", overlayTitle);
  } else {
    overlayTitle = "Päättyneen session saaliit";
    emptyMsg = "Ei kirjattuja saaliita tähän sessioon.";
    if (titleEl) titleEl.textContent = overlayTitle;
    listEl.setAttribute("aria-label", overlayTitle);
  }

  if (stripEl && sessionId) {
    stripEl.textContent = formatSessionStripLabel(sessionId);
    stripEl.removeAttribute("hidden");
  }

  const active = await getActiveSession();
  const allowEditDelete = !!active && active.id === sessionId;

  const count = await renderCatchList(listEl, sessionId, false, {
    activeSession: sessionIdOverride == null,
    allowEditDelete,
  });
  if (count === 0) {
    if (emptyEl) emptyEl.textContent = emptyMsg;
    emptyEl?.classList.remove("hidden");
    wrap?.classList.add("hidden");
    return;
  }

  emptyEl?.classList.add("hidden");
  wrap?.classList.remove("hidden");
}

async function populateSessionEndCatchesTable() {
  const session = await getActiveSession();
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
  const session = await getActiveSession();
  if (!session) return;
  closeCatchesOverlay();
  await populateSessionEndCatchesTable();
  const s2 = await getActiveSession();
  updateSessionEndCsvStatus(s2);
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
  const totalEl = document.getElementById("session-summary-total");
  const anglerListUl = document.getElementById("session-summary-by-angler");
  const speciesListUl = document.getElementById("session-summary-by-species");
  if (!totalEl || !anglerListUl || !speciesListUl) return;

  const [sessionAnglers, catches, anglers] = await Promise.all([
    getSessionAnglersForSession(sessionId),
    getCatchesForSession(sessionId),
    getAllAnglers(),
  ]);
  const nameById = Object.fromEntries(anglers.map((a) => [a.id, a.displayName]));

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

  totalEl.textContent = String(catches.length);

  anglerListUl.innerHTML = "";
  if (anglerRows.length === 0) {
    const li = document.createElement("li");
    li.className = "meta";
    li.textContent = "Ei kalastajia sessiossa.";
    anglerListUl.appendChild(li);
  } else {
    for (const row of anglerRows) {
      const li = document.createElement("li");
      li.textContent = `${row.name}: ${row.count}`;
      anglerListUl.appendChild(li);
    }
  }

  /** @type {Map<string, number>} */
  const countBySpecies = new Map();
  for (const c of catches) {
    countBySpecies.set(c.species, (countBySpecies.get(c.species) || 0) + 1);
  }
  speciesListUl.innerHTML = "";
  const speciesKeys = [...countBySpecies.keys()].sort(
    (a, b) => SPECIES_OPTIONS.indexOf(a) - SPECIES_OPTIONS.indexOf(b)
  );
  if (speciesKeys.length === 0) {
    const li = document.createElement("li");
    li.className = "meta";
    li.textContent = "Ei kirjattuja saaliita.";
    speciesListUl.appendChild(li);
  } else {
    for (const key of speciesKeys) {
      const label = SPECIES_LABELS[key] || key;
      const li = document.createElement("li");
      li.textContent = `${label}: ${countBySpecies.get(key)}`;
      speciesListUl.appendChild(li);
    }
  }
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
    await populateCatchesTable();
  }
  const se = document.getElementById("session-end-overlay");
  if (se && !se.classList.contains("hidden")) {
    await populateSessionEndCatchesTable();
    const session = await getActiveSession();
    updateSessionEndCsvStatus(session);
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

  const [sas, catches, anglers] = await Promise.all([
    getSessionAnglersForSession(sessionId),
    getCatchesForSession(sessionId),
    getAllAnglers(),
  ]);
  const nameById = Object.fromEntries(anglers.map((a) => [a.id, a.displayName]));

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
  if (btn) btn.textContent = homeAnglersExpanded ? "Piilota kalastajat" : "Näytä kalastajat";
}

async function renderHome() {
  const session = await getActiveSession();
  const meta = document.getElementById("session-meta");
  const noS = document.getElementById("block-no-session");
  const act = document.getElementById("block-active-session");
  const roster = document.getElementById("session-roster");

  if (!meta || !noS || !act || !roster) return;

  if (!session) {
    stopSessionTimer();
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
    await renderSessionLiveView(session.id);
  }

  syncHomeAnglersToggleUi();

  const anglers = await getAllAnglers();
  const listEl = document.getElementById("angler-list");
  if (listEl) {
    listEl.innerHTML = "";
    if (anglers.length === 0) {
      listEl.innerHTML = '<p class="meta">Ei kalastajia — lisää nimi alta.</p>';
    } else {
      for (const a of anglers) {
        const row = document.createElement("div");
        row.className = "angler-item";
        row.innerHTML = `<span>${escapeHtml(a.displayName)}</span>`;
        listEl.appendChild(row);
      }
    }
  }

  if (session) {
    const sas = await getSessionAnglersForSession(session.id);
    const nameById = Object.fromEntries(anglers.map((a) => [a.id, a.displayName]));
    const rows = document.getElementById("session-angler-rows");
    const addBox = document.getElementById("add-to-session");
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
    if (addBox) {
      addBox.innerHTML = "";
      const inSession = new Set(sas.filter((x) => x.isActive).map((x) => x.anglerId));
      const available = anglers.filter((a) => !inSession.has(a.id));
      if (available.length === 0) {
        addBox.innerHTML = '<p class="meta">Kaikki kalastajat ovat jo sessiossa (tai lisää uusi ylhäältä).</p>';
      } else {
        for (const a of available) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn";
          b.textContent = `Lisää: ${a.displayName}`;
          b.addEventListener("click", async () => {
            const r = await addAnglerToSession(session.id, a.id);
            if (!r.ok) showError(r.reason);
            await renderHome();
          });
          addBox.appendChild(b);
        }
      }
    }
  }
}

/**
 * @param {import('./db.js').Angler[]} anglers
 */
function buildStartAnglerPicks(anglers) {
  const box = document.getElementById("start-angler-picks");
  const confirm = document.getElementById("start-confirm");
  if (!box || !confirm) return;

  /** @type {Set<string>} */
  const selected = new Set();

  function sync() {
    confirm.disabled = selected.size === 0;
    box.querySelectorAll("[data-angler-id]").forEach((el) => {
      const id = el.getAttribute("data-angler-id");
      if (!id) return;
      if (selected.has(id)) {
        el.classList.add("btn-selected");
      } else {
        el.classList.remove("btn-selected");
      }
    });
  }

  box.innerHTML = "";
  if (anglers.length === 0) {
    box.innerHTML = '<p class="meta">Lisää ensin vähintään yksi kalastaja.</p>';
    confirm.disabled = true;
    return;
  }

  for (const a of anglers) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.dataset.anglerId = a.id;
    b.textContent = a.displayName;
    b.addEventListener("click", () => {
      if (selected.has(a.id)) selected.delete(a.id);
      else selected.add(a.id);
      sync();
    });
    box.appendChild(b);
  }

  confirm.onclick = async () => {
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

    const sessionTitle = null;
    const { data, error } = await supabase
      .from("sessions")
      .insert([
        {
          title: sessionTitle ?? null,
          notes: null,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("[Supabase] sessions insert failed:", error.message, error);
      showError("Supabase-sessiota ei voitu tallentaa. Katso konsoli.");
      activeSupabaseSessionId = null;
    } else if (data?.id) {
      activeSupabaseSessionId = data.id;
    } else {
      console.error("[Supabase] sessions insert: no row id returned", data);
      showError("Supabase-sessiota ei voitu tallentaa. Katso konsoli.");
      activeSupabaseSessionId = null;
    }

    activeSupabaseAnglerRows = null;
    supabaseAnglerRowByLocalId.clear();
    if (activeSupabaseSessionId) {
      const selectedIds = [...selected];
      const nameByLocalId = new Map(anglers.map((a) => [a.id, a.displayName]));
      const insertRows = selectedIds.map((localId) => ({
        session_id: activeSupabaseSessionId,
        name: nameByLocalId.get(localId) ?? "",
        user_id: null,
      }));

      const {
        data: sbAnglers,
        error: anglersError,
      } = await supabase.from("anglers").insert(insertRows).select();

      if (anglersError) {
        console.error("[Supabase] anglers insert failed:", anglersError.message, anglersError);
        showError("Supabase-kalastajia ei voitu tallentaa. Katso konsoli.");
      } else if (sbAnglers && sbAnglers.length === selectedIds.length) {
        activeSupabaseAnglerRows = sbAnglers;
        selectedIds.forEach((localId, i) => {
          const row = sbAnglers[i];
          if (row) supabaseAnglerRowByLocalId.set(localId, row);
        });
      } else {
        console.error("[Supabase] anglers insert: unexpected response", sbAnglers);
        showError("Supabase-kalastajia ei voitu tallentaa. Katso konsoli.");
      }
    }

    document.getElementById("start-overlay")?.classList.add("hidden");
    selected.clear();
    closeCatchesOverlay();
    closeSessionEndOverlay();
    await renderHome();
  };

  sync();
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
  const session = await getActiveSession();
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
  const session = await getActiveSession();
  const box = document.getElementById("fish-angler-buttons");
  if (!box || !session) return;
  const sas = await getSessionAnglersForSession(session.id);
  const active = sas.filter((x) => x.isActive);
  const anglers = await getAllAnglers();
  const nameById = Object.fromEntries(anglers.map((a) => [a.id, a.displayName]));
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

function init() {
  wireFishMeasurementInputs();

  document.getElementById("btn-open-start")?.addEventListener("click", async () => {
    closeCatchesOverlay();
    closeSessionEndOverlay();
    closeSessionSummaryOverlay();
    const anglers = await getAllAnglers();
    buildStartAnglerPicks(anglers);
    document.getElementById("start-overlay")?.classList.remove("hidden");
  });

  document.getElementById("start-cancel")?.addEventListener("click", () => {
    document.getElementById("start-overlay")?.classList.add("hidden");
  });

  document.getElementById("btn-add-angler")?.addEventListener("click", async () => {
    const inp = /** @type {HTMLInputElement | null} */ (document.getElementById("new-angler-name"));
    const name = (inp?.value || "").trim();
    if (!name) {
      showError("Anna kalastajan nimi.");
      return;
    }
    await putAngler({ id: newId(), displayName: name });
    if (inp) inp.value = "";
    await renderHome();
  });

  document.getElementById("btn-end-session")?.addEventListener("click", () => {
    openSessionEndOverlay();
  });

  document.getElementById("session-end-cancel")?.addEventListener("click", () => {
    closeSessionEndOverlay();
  });

  document.getElementById("session-end-save-csv")?.addEventListener("click", async () => {
    try {
      const session = await getActiveSession();
      if (!session) return;
      const catches = await getCatchesForSession(session.id);
      const csv = buildSessionCatchesCsv(catches);
      triggerCsvDownload(defaultFishLogFilename(), csv);
      const r = await markActiveSessionCsvExported();
      if (!r.ok) {
        showError(r.reason);
        return;
      }
      const s2 = await getActiveSession();
      updateSessionEndCsvStatus(s2);
    } catch {
      showError("CSV-tallennus epäonnistui.");
    }
  });

  document.getElementById("session-end-final")?.addEventListener("click", async () => {
    const activeBefore = await getActiveSession();
    if (!activeBefore) return;
    const csvWasExported = activeBefore.csv_exported === true;
    const endedSessionId = activeBefore.id;
    if (!csvWasExported) {
      if (
        !confirm(
          "CSV file has not been saved yet. Are you sure you want to end the session?"
        )
      ) {
        return;
      }
      if (
        !confirm(
          "You are ending the session without exporting CSV. Are you absolutely sure?"
        )
      ) {
        return;
      }
    }
    closeSessionEndOverlay();
    const r = await endActiveSession();
    if (!r.ok) {
      showError(r.reason);
      return;
    }
    activeSupabaseSessionId = null;
    activeSupabaseAnglerRows = null;
    supabaseAnglerRowByLocalId.clear();
    await renderHome();
    if (csvWasExported) {
      showSuccess("Fish saved and session ended");
    }
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
    closeCatchesOverlay();
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

    const speciesForDb = mapSpeciesKeyToSupabaseSpecies(fishState.species);
    const sbAnglerRow = fishState.anglerId ? supabaseAnglerRowByLocalId.get(fishState.anglerId) : undefined;
    const sbAnglerId = sbAnglerRow?.id ?? null;

    const canInsertSupabaseCatch =
      !!activeSupabaseSessionId && sbAnglerId != null && sbAnglerId !== "" && !!speciesForDb;

    if (canInsertSupabaseCatch) {
      const savedLen = savedCatch.length;
      const savedWtKg = savedCatch.weight_kg;
      const length_cm =
        savedLen != null && typeof savedLen === "number" && Number.isFinite(savedLen) && savedLen > 0
          ? savedLen
          : null;
      const weight_g =
        savedWtKg != null && typeof savedWtKg === "number" && Number.isFinite(savedWtKg) && savedWtKg > 0
          ? Math.round(savedWtKg * 1000)
          : null;

      if (length_cm != null && typeof length_cm === "number" && Number.isFinite(length_cm) && length_cm > 0) {
        const { data: _catchData, error: catchError } = await supabase
          .from("catches")
          .insert([
            {
              session_id: activeSupabaseSessionId,
              angler_id: sbAnglerId,
              species: speciesForDb,
              length_cm,
              weight_g,
            },
          ])
          .select()
          .single();

        if (catchError) {
          console.error("[Supabase] catches insert failed:", catchError.message, catchError);
          showError("Supabase-saalista ei voitu tallentaa. Katso konsoli.");
        }
      }
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

  document.addEventListener("click", () => {
    document.querySelectorAll(".catch-card-menu").forEach((m) => {
      if (!m.hidden) {
        m.hidden = true;
        const t = m.previousElementSibling;
        if (t?.classList.contains("catch-card-menu-trigger")) {
          t.setAttribute("aria-expanded", "false");
        }
      }
    });
  });

  renderHome();
}

init();
