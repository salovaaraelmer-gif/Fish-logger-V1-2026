/**
 * Fish Logger V1 — UI and wiring.
 */

import {
  getAllAnglers,
  putAngler,
  getSessionAnglersForSession,
  getActiveSession,
  getCatchesForSession,
} from "./db.js";
import {
  startSession,
  endActiveSession,
  addAnglerToSession,
  markAnglerInactive,
  newId,
} from "./sessionService.js";
import {
  SPECIES_OPTIONS,
  saveCatch,
  fetchGpsBestEffort,
  parseOptionalPositiveInt,
} from "./catchService.js";

/** @type {Record<string, string>} */
const SPECIES_LABELS = {
  pike: "Hauki",
  perch: "Ahven",
  zander: "Kuha",
  trout: "Taimen",
  other: "Muu",
};

/** @type {{ step: number, anglerId: string | null, species: string | null, lengthStr: string, weightStr: string, notes: string }} */
let fishState = freshFishState();

/** When a session is active, angler list / roster is hidden until user opens this panel. */
let anglerEditPanelOpen = false;

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
    notes: "",
  };
}

/**
 * Keep measurement inputs and fishState in sync (digits only, max 6).
 */
function syncFishStateFromMeasurementInputs() {
  const len = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-length"));
  const w = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-weight"));
  if (len) {
    const v = (len.value || "").replace(/\D/g, "").slice(0, 6);
    if (len.value !== v) len.value = v;
    fishState.lengthStr = v;
  }
  if (w) {
    const v = (w.value || "").replace(/\D/g, "").slice(0, 6);
    if (w.value !== v) w.value = v;
    fishState.weightStr = v;
  }
}

function clearFishMeasurementInputs() {
  const len = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-length"));
  const w = /** @type {HTMLInputElement | null} */ (document.getElementById("fish-input-weight"));
  if (len) len.value = "";
  if (w) w.value = "";
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

function closeCatchesOverlay() {
  document.getElementById("catches-overlay")?.classList.add("hidden");
}

/**
 * Fills the session catches table from IndexedDB.
 * @param {string | undefined} sessionIdOverride - if set, load this session (e.g. just ended).
 */
async function populateCatchesTable(sessionIdOverride) {
  const titleEl = document.getElementById("catches-overlay-title");
  const tableEl = document.getElementById("catches-table");
  const tbody = document.getElementById("catches-table-body");
  const emptyEl = document.getElementById("catches-empty");
  const wrap = document.getElementById("catches-table-wrap");
  if (!tbody) return;

  let sessionId = sessionIdOverride;
  let overlayTitle = "Saaliit tässä sessiossa";
  let emptyMsg = "Ei saaliita tässä sessiossa.";

  if (!sessionId) {
    const session = await getActiveSession();
    if (!session) {
      tbody.innerHTML = "";
      emptyEl?.classList.remove("hidden");
      wrap?.classList.add("hidden");
      if (titleEl) titleEl.textContent = "Saaliit tässä sessiossa";
      if (emptyEl) emptyEl.textContent = "Ei aktiivista sessiota.";
      if (tableEl) tableEl.setAttribute("aria-label", "Saaliit tässä sessiossa");
      return;
    }
    sessionId = session.id;
    if (titleEl) titleEl.textContent = overlayTitle;
    if (tableEl) tableEl.setAttribute("aria-label", overlayTitle);
  } else {
    overlayTitle = "Päättyneen session saaliit";
    emptyMsg = "Ei kirjattuja saaliita tähän sessioon.";
    if (titleEl) titleEl.textContent = overlayTitle;
    if (tableEl) tableEl.setAttribute("aria-label", overlayTitle);
  }

  const [catches, anglers] = await Promise.all([getCatchesForSession(sessionId), getAllAnglers()]);
  const nameById = Object.fromEntries(anglers.map((a) => [a.id, a.displayName]));

  tbody.innerHTML = "";
  if (catches.length === 0) {
    if (emptyEl) emptyEl.textContent = emptyMsg;
    emptyEl?.classList.remove("hidden");
    wrap?.classList.add("hidden");
    return;
  }

  emptyEl?.classList.add("hidden");
  wrap?.classList.remove("hidden");

  for (const c of catches) {
    const tr = document.createElement("tr");
    const tdTime = document.createElement("td");
    tdTime.textContent = new Date(c.timestamp).toLocaleString("fi-FI");
    const tdAngler = document.createElement("td");
    tdAngler.textContent = nameById[c.anglerId] || c.anglerId;
    const tdSpecies = document.createElement("td");
    tdSpecies.textContent = SPECIES_LABELS[c.species] || c.species;
    const tdLen = document.createElement("td");
    tdLen.textContent = c.length != null ? String(c.length) : "—";
    const tdWeight = document.createElement("td");
    tdWeight.textContent = c.weight != null ? String(c.weight) : "—";
    const tdNotes = document.createElement("td");
    tdNotes.textContent = (c.notes || "").trim() || "—";
    tdNotes.className = "catches-notes-cell";
    tr.append(tdTime, tdAngler, tdSpecies, tdLen, tdWeight, tdNotes);
    tbody.appendChild(tr);
  }
}

async function refreshCatchesTableIfOpen() {
  const ov = document.getElementById("catches-overlay");
  if (!ov || ov.classList.contains("hidden")) return;
  await populateCatchesTable();
}

async function openCatchesOverlay() {
  await populateCatchesTable();
  document.getElementById("catches-overlay")?.classList.remove("hidden");
}

async function renderHome() {
  const session = await getActiveSession();
  const meta = document.getElementById("session-meta");
  const noS = document.getElementById("block-no-session");
  const act = document.getElementById("block-active-session");
  const roster = document.getElementById("session-roster");
  const anglerPanel = document.getElementById("angler-edit-panel");
  const btnEditAnglers = document.getElementById("btn-edit-anglers");

  if (!meta || !noS || !act || !roster) return;

  if (!session) {
    stopSessionTimer();
    meta.textContent = "Ei aktiivista kalastussessiota. Aloita sessio ennen saaliin kirjausta.";
    noS.classList.remove("hidden");
    act.classList.add("hidden");
    roster.classList.add("hidden");
    anglerPanel?.classList.remove("hidden");
    anglerEditPanelOpen = false;
    btnEditAnglers?.setAttribute("aria-expanded", "false");
    btnEditAnglers?.classList.remove("is-active");
  } else {
    const start = new Date(session.startTime);
    meta.textContent = `Sessio käynnissä (alkoi ${start.toLocaleString("fi-FI")}).`;
    noS.classList.add("hidden");
    act.classList.remove("hidden");
    roster.classList.remove("hidden");
    anglerPanel?.classList.toggle("hidden", !anglerEditPanelOpen);
    btnEditAnglers?.setAttribute("aria-expanded", anglerEditPanelOpen ? "true" : "false");
    btnEditAnglers?.classList.toggle("is-active", anglerEditPanelOpen);
    startSessionTimer(session.startTime);
  }

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
    const r = await startSession([...selected]);
    if (!r.ok) {
      showError(r.reason);
      return;
    }
    document.getElementById("start-overlay")?.classList.add("hidden");
    selected.clear();
    anglerEditPanelOpen = false;
    closeCatchesOverlay();
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
  len?.addEventListener("input", () => syncFishStateFromMeasurementInputs());
  w?.addEventListener("input", () => syncFishStateFromMeasurementInputs());
}

function showFishStep(n) {
  fishState.step = n;
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`fish-step-${i}`);
    if (el) el.classList.toggle("hidden", i !== n);
  }
}

function openFishOverlay() {
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
  wireSpeciesButtons();
  populateFishAnglers();
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
    document.getElementById("end-session-overlay")?.classList.remove("hidden");
  });

  document.getElementById("end-session-cancel")?.addEventListener("click", () => {
    document.getElementById("end-session-overlay")?.classList.add("hidden");
  });

  document.getElementById("end-session-confirm")?.addEventListener("click", async () => {
    document.getElementById("end-session-overlay")?.classList.add("hidden");
    const activeBefore = await getActiveSession();
    const endedSessionId = activeBefore?.id;
    const r = await endActiveSession();
    if (!r.ok) showError(r.reason);
    anglerEditPanelOpen = false;
    await renderHome();
    if (r.ok && endedSessionId) {
      await populateCatchesTable(endedSessionId);
      document.getElementById("catches-overlay")?.classList.remove("hidden");
    }
  });

  document.getElementById("btn-edit-anglers")?.addEventListener("click", () => {
    anglerEditPanelOpen = !anglerEditPanelOpen;
    const panel = document.getElementById("angler-edit-panel");
    const btn = document.getElementById("btn-edit-anglers");
    panel?.classList.toggle("hidden", !anglerEditPanelOpen);
    btn?.setAttribute("aria-expanded", anglerEditPanelOpen ? "true" : "false");
    btn?.classList.toggle("is-active", anglerEditPanelOpen);
  });

  document.getElementById("btn-show-catches")?.addEventListener("click", () => {
    openCatchesOverlay();
  });

  document.getElementById("catches-close")?.addEventListener("click", () => {
    closeCatchesOverlay();
  });

  document.getElementById("btn-log-catch")?.addEventListener("click", () => {
    closeCatchesOverlay();
    openFishOverlay();
  });

  document.getElementById("fish-close")?.addEventListener("click", () => {
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
    const gps = await fetchGpsBestEffort();
    const len = parseOptionalPositiveInt(fishState.lengthStr);
    const w = parseOptionalPositiveInt(fishState.weightStr);
    if (!fishState.anglerId) {
      showError("Valitse kalastaja.");
      return;
    }
    const result = await saveCatch(
      {
        anglerId: fishState.anglerId,
        species: fishState.species || "",
        length: len,
        weight: w,
        notes: fishState.notes,
      },
      gps,
      { depth: null, waterTemp: null }
    );
    if (!result.ok) {
      showError(result.reason);
      return;
    }
    showFishStep(4);
    await refreshCatchesTableIfOpen();
  });

  document.getElementById("fish-add-another")?.addEventListener("click", () => {
    closeCatchesOverlay();
    openFishOverlay();
  });

  document.getElementById("fish-back-home")?.addEventListener("click", () => {
    document.getElementById("fish-overlay")?.classList.add("hidden");
  });

  renderHome();
}

init();
