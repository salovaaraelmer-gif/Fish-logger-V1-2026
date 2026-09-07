/**
 * Personal catch map (own GPS catches only) plus in-view filters.
 * @module personalCatchMap
 */

import L from "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/+esm";
import { navigateApp } from "./appRouter.js";
import { pathForSessionDetail } from "./appRoutes.js";
import { getAuthUserId } from "./auth.js";
import { SPECIES_LABELS, SPECIES_OPTIONS, ALL_SPECIES_ICON_SRC, colorForSpecies, speciesIconSrc } from "./catchSpecies.js";
import { getAllCatches, getSessionById } from "./db.js";
import { placeMapCallout } from "./mapCallout.js";
import {
  applyMapCatchFilters,
  catchHasValidGps,
  defaultMapCatchFilters,
  endOfLocalDayMs,
  formatLengthRangeLabel,
  isAllSpeciesFilter,
  MAP_FILTER_ALL_SPECIES,
  MAP_LENGTH_MAX_CM,
  MAP_LENGTH_MIN_CM,
  MAP_LENGTH_STEP_CM,
  normalizeLengthRange,
  startOfLocalDayMs,
  toggleMapSpecies,
} from "./mapCatchFilters.js";
import { bindDualRangeSlider } from "./mapLengthSlider.js";
import { formatKalapaivaDate } from "./sessionTitle.js";

const ESRI_SATELLITE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const MARKER_BASE = { radius: 9, color: "#ffffff", weight: 2, opacity: 1, fillOpacity: 0.92 };
const MARKER_SELECTED = { radius: 12, color: "#ffffff", weight: 3, opacity: 1, fillOpacity: 1 };

/** @type {import('./mapCatchFilters.js').MapCatchFilters} */
let filters = defaultMapCatchFilters();
/** @type {import('./db.js').CatchRecord[]} */
let sourceCatches = [];
/** @type {unknown} */
let map = null;
/** @type {unknown} */
let markerLayer = null;
let wired = false;
/** @type {string | null} */
let previewCatchId = null;
/** @type {{ lat: number, lng: number } | null} */
let previewLatLng = null;
/** @type {unknown} */
let selectedMarker = null;
/** @type {{ setValue: (next: { min: number, max: number }) => void } | null} */
let lengthSlider = null;

export function resetMapFilters() {
  filters = defaultMapCatchFilters();
  previewCatchId = null;
  previewLatLng = null;
  syncLengthSlider();
}

export function destroyPersonalCatchMap() {
  hidePreview();
  if (map) {
    try {
      map.remove();
    } catch {
      /* ignore */
    }
  }
  map = null;
  markerLayer = null;
  selectedMarker = null;
}

export function invalidatePersonalCatchMap() {
  if (!map) return;
  requestAnimationFrame(() => {
    try {
      map.invalidateSize();
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => {
      try {
        map.invalidateSize();
      } catch {
        /* ignore */
      }
      positionOpenPreview();
    });
  });
}

/**
 * @param {{ onError?: (msg: string) => void }} [options]
 */
export function wirePersonalCatchMap(options = {}) {
  if (wired) return;
  wired = true;
  document.getElementById("map-filters-open")?.addEventListener("click", () => {
    openFilters();
  });
  document.getElementById("map-filters-back")?.addEventListener("click", () => {
    closeFilters();
  });
  document.getElementById("map-preview-close")?.addEventListener("click", (event) => {
    event.stopPropagation();
    hidePreview();
  });
  document.getElementById("map-preview-session")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const id = document.getElementById("map-catch-preview")?.dataset.sessionId;
    if (id) navigateApp(pathForSessionDetail(id));
  });
  document.getElementById("map-filter-species")?.addEventListener("click", (event) => {
    const btn = event.target instanceof Element ? event.target.closest("[data-species]") : null;
    if (!btn) return;
    const key = btn.getAttribute("data-species") || MAP_FILTER_ALL_SPECIES;
    filters.species = toggleMapSpecies(filters.species, key);
    markSpecies();
    void refreshMarkers({ keepView: true });
  });
  document.getElementById("map-filter-species-clear")?.addEventListener("click", () => {
    filters.species = [];
    markSpecies();
    void refreshMarkers({ keepView: true });
  });
  document.getElementById("map-filter-date-mode")?.addEventListener("change", (event) => {
    const el = /** @type {HTMLSelectElement} */ (event.target);
    filters.dateMode = /** @type {import('./mapCatchFilters.js').MapDateMode} */ (el.value);
    syncDateModeUi();
    void refreshMarkers({ keepView: true });
  });
  document.getElementById("map-filter-year")?.addEventListener("change", (event) => {
    const el = /** @type {HTMLSelectElement} */ (event.target);
    filters.year = el.value === "all" ? "all" : Number(el.value);
    void refreshMarkers({ keepView: true });
  });
  document.getElementById("map-filter-from")?.addEventListener("change", (event) => {
    const el = /** @type {HTMLInputElement} */ (event.target);
    filters.fromMs = el.value ? startOfLocalDayMs(new Date(el.value).getTime()) : null;
    void refreshMarkers({ keepView: true });
  });
  document.getElementById("map-filter-to")?.addEventListener("change", (event) => {
    const el = /** @type {HTMLInputElement} */ (event.target);
    filters.toMs = el.value ? endOfLocalDayMs(new Date(el.value).getTime()) : null;
    void refreshMarkers({ keepView: true });
  });
  const sliderRoot = document.getElementById("map-filter-length-slider");
  if (sliderRoot) {
    lengthSlider = bindDualRangeSlider(sliderRoot, {
      minBound: MAP_LENGTH_MIN_CM,
      maxBound: MAP_LENGTH_MAX_CM,
      step: MAP_LENGTH_STEP_CM,
      value: { min: filters.minLengthCm, max: filters.maxLengthCm },
      onChange: ({ min, max }) => {
        const range = normalizeLengthRange(min, max);
        filters.minLengthCm = range.minLengthCm;
        filters.maxLengthCm = range.maxLengthCm;
        updateLengthLabel();
        void refreshMarkers({ keepView: true });
      },
    });
  }
  updateLengthLabel();
  void options;
}

export async function showPersonalCatchMap() {
  const uid = await getAuthUserId();
  if (!uid) {
    sourceCatches = [];
  } else {
    const all = await getAllCatches();
    sourceCatches = all.filter((c) => c.anglerId === uid && catchHasValidGps(c));
  }
  fillFilterControls();
  await refreshMarkers({ keepView: Boolean(map) });
  invalidatePersonalCatchMap();
}

function fillFilterControls() {
  fillYearOptions();
  fillSpeciesButtons();
  syncDateModeUi();
  markSpecies();
  syncLengthSlider();
}

function openFilters() {
  hidePreview();
  fillFilterControls();
  const overlay = document.getElementById("map-filters-overlay");
  overlay?.classList.remove("hidden");
  overlay?.scrollTo(0, 0);
}

function closeFilters() {
  document.getElementById("map-filters-overlay")?.classList.add("hidden");
}

function hidePreview() {
  previewCatchId = null;
  previewLatLng = null;
  if (selectedMarker) {
    try {
      selectedMarker.setStyle(MARKER_BASE);
    } catch {
      /* ignore */
    }
  }
  selectedMarker = null;
  const panel = document.getElementById("map-catch-preview");
  panel?.classList.add("hidden");
  if (panel) panel.hidden = true;
}

/**
 * @param {{ keepView?: boolean }} [opts]
 */
async function refreshMarkers(opts = {}) {
  const container = document.getElementById("personal-map-container");
  const empty = document.getElementById("personal-map-empty");
  if (!container) return;
  const visible = applyMapCatchFilters(sourceCatches, filters);
  if (empty) {
    empty.hidden = sourceCatches.length > 0 && visible.length > 0;
    if (sourceCatches.length === 0) {
      empty.textContent = "No catches with GPS yet.";
    } else if (visible.length === 0) {
      empty.textContent = "No catches match these filters.";
    }
  }
  ensureMap(container);
  markerLayer.clearLayers();
  selectedMarker = null;
  for (const c of visible) {
    const m = L.circleMarker([c.location_lat, c.location_lng], {
      ...MARKER_BASE,
      fillColor: colorForSpecies(c.species),
    });
    m.on("click", (event) => {
      L.DomEvent.stopPropagation(event);
      void showPreview(c, m);
    });
    if (c.id === previewCatchId) {
      m.setStyle(MARKER_SELECTED);
      selectedMarker = m;
    }
    markerLayer.addLayer(m);
  }
  if (!opts.keepView && visible.length === 1) {
    map.setView([visible[0].location_lat, visible[0].location_lng], 16);
  } else if (!opts.keepView && visible.length > 1) {
    map.fitBounds(markerLayer.getBounds(), { padding: [40, 48], maxZoom: 17 });
  }
  if (previewCatchId && !visible.some((c) => c.id === previewCatchId)) hidePreview();
  else positionOpenPreview();
}

function ensureMap(container) {
  if (map) return;
  map = L.map(container, { zoomControl: true, attributionControl: false });
  L.tileLayer(ESRI_SATELLITE, { maxZoom: 19 }).addTo(map);
  markerLayer = L.featureGroup().addTo(map);
  map.setView([61.5, 23.8], 6);
  map.on("click", () => hidePreview());
  map.on("move zoom", () => positionOpenPreview());
}

/**
 * @param {import('./db.js').CatchRecord} c
 * @param {unknown} [marker]
 */
async function showPreview(c, marker) {
  previewCatchId = c.id;
  previewLatLng = { lat: c.location_lat, lng: c.location_lng };
  if (selectedMarker && selectedMarker !== marker) {
    try {
      selectedMarker.setStyle(MARKER_BASE);
    } catch {
      /* ignore */
    }
  }
  selectedMarker = marker || null;
  if (selectedMarker) {
    try {
      selectedMarker.setStyle(MARKER_SELECTED);
    } catch {
      /* ignore */
    }
  }
  const panel = document.getElementById("map-catch-preview");
  if (!panel) return;
  panel.dataset.sessionId = c.sessionId || "";
  const species = SPECIES_LABELS[c.species] || c.species;
  const when = formatKalapaivaDate(c.timestamp);
  const time = new Date(c.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  setPreviewText("map-preview-species", species);
  const measures = [];
  if (c.length != null) measures.push(`${c.length} cm`);
  if (c.weight_kg != null) {
    measures.push(`${c.weight_kg.toLocaleString("en-GB", { maximumFractionDigits: 2 })} kg`);
  }
  setPreviewText("map-preview-measures", measures.join(" · "));
  setPreviewText("map-preview-when", `${when} · ${time}`);
  let place = "";
  if (c.sessionId) {
    const session = await getSessionById(c.sessionId);
    if (session?.title) place = session.title;
  }
  setPreviewText("map-preview-session-name", place);
  const sessionBtn = document.getElementById("map-preview-session");
  if (sessionBtn) sessionBtn.hidden = !c.sessionId;
  panel.hidden = false;
  panel.classList.remove("hidden");
  positionOpenPreview();
}

function positionOpenPreview() {
  const panel = document.getElementById("map-catch-preview");
  const wrap = document.querySelector(".personal-map-wrap");
  if (!map || !previewLatLng || !panel || panel.classList.contains("hidden") || !wrap) return;
  const point = map.latLngToContainerPoint([previewLatLng.lat, previewLatLng.lng]);
  const box = wrap.getBoundingClientRect();
  const pos = placeMapCallout({
    wrapW: box.width,
    wrapH: box.height,
    x: point.x,
    y: point.y,
    panelW: panel.offsetWidth,
    panelH: panel.offsetHeight,
  });
  panel.style.left = `${pos.left}px`;
  panel.style.top = `${pos.top}px`;
  panel.dataset.placement = pos.placement;
  panel.style.setProperty("--caret-x", `${pos.caretX}px`);
}

/**
 * @param {string} id
 * @param {string} text
 */
function setPreviewText(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
    el.hidden = !text;
  }
}

function fillSpeciesButtons() {
  const host = document.getElementById("map-filter-species");
  if (!host || host.childElementCount > 0) {
    markSpecies();
    return;
  }
  host.appendChild(speciesBtn(MAP_FILTER_ALL_SPECIES, "All species"));
  for (const key of SPECIES_OPTIONS) {
    host.appendChild(speciesBtn(key, SPECIES_LABELS[key] || key));
  }
  markSpecies();
}

/**
 * @param {string} key
 * @param {string} label
 */
function speciesBtn(key, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "map-filter-species-chip";
  if (key === MAP_FILTER_ALL_SPECIES) btn.classList.add("is-all");
  btn.setAttribute("data-species", key);
  btn.setAttribute("aria-pressed", "false");
  const src = key === MAP_FILTER_ALL_SPECIES ? ALL_SPECIES_ICON_SRC : speciesIconSrc(key);
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    btn.appendChild(img);
  }
  const name = document.createElement("span");
  name.textContent = label;
  btn.appendChild(name);
  btn.style.setProperty(
    "--species-color",
    key === MAP_FILTER_ALL_SPECIES ? "var(--accent)" : colorForSpecies(key)
  );
  return btn;
}

function markSpecies() {
  const host = document.getElementById("map-filter-species");
  const allOn = isAllSpeciesFilter(filters.species);
  host?.querySelectorAll("[data-species]").forEach((btn) => {
    const key = btn.getAttribute("data-species");
    const on = key === MAP_FILTER_ALL_SPECIES ? allOn : !allOn && filters.species.includes(key || "");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function updateLengthLabel() {
  const el = document.getElementById("map-filter-length-value");
  if (el) el.textContent = formatLengthRangeLabel(filters.minLengthCm, filters.maxLengthCm);
}

function syncLengthSlider() {
  lengthSlider?.setValue({ min: filters.minLengthCm, max: filters.maxLengthCm });
  updateLengthLabel();
}

function fillYearOptions() {
  const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById("map-filter-year"));
  if (!sel) return;
  const years = [...new Set(sourceCatches.map((c) => new Date(c.timestamp).getFullYear()))].sort((a, b) => b - a);
  const current = filters.year;
  sel.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All years";
  sel.appendChild(all);
  for (const y of years) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    sel.appendChild(opt);
  }
  sel.value = current === "all" ? "all" : String(current);
}

function syncDateModeUi() {
  const mode = /** @type {HTMLSelectElement | null} */ (document.getElementById("map-filter-date-mode"));
  if (mode) mode.value = filters.dateMode;
  document.getElementById("map-filter-year-wrap")?.classList.toggle("hidden", filters.dateMode !== "year");
  document.getElementById("map-filter-range-wrap")?.classList.toggle("hidden", filters.dateMode !== "custom");
}

export { closeFilters as closeMapFilters };
