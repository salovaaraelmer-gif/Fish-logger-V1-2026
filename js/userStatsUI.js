/**
 * Profile Stats preview and dedicated Stats page.
 * @module userStatsUI
 */

import {
  ALL_SPECIES_ICON_SRC,
  SPECIES_LABELS,
  SPECIES_OPTIONS,
  colorForSpecies,
  speciesIconSrc,
} from "./catchSpecies.js";
import {
  MONTH_LABELS,
  STATS_ALL_TIME,
  computeUserPeriodStats,
  formatTop5SummaryLine,
  monthlyCatchCounts,
  speciesStatsLabel,
  statsForUserSpecies,
  yearlyCatchCounts,
} from "./userStatsCalc.js";
import { loadUserStatsBundle } from "./userStatsService.js";

/** @type {import('./userStatsService.js').UserStatsBundle | null} */
let bundle = null;
/** @type {number | typeof STATS_ALL_TIME} */
let selectedYear = new Date().getFullYear();
/** @type {string} */
let selectedSpecies = SPECIES_OPTIONS[0];
/** @type {string | typeof STATS_ALL_TIME} */
let monthSpecies = STATS_ALL_TIME;

/**
 * @returns {Promise<void>}
 */
export async function refreshProfileStatsPreview() {
  bundle = await loadUserStatsBundle();
  const year = new Date().getFullYear();
  const period = bundle
    ? computeUserPeriodStats(bundle.sessions, bundle.catches, year)
    : { sessionCount: 0, fishCount: 0 };
  setCardValue("profile-stat-sessions-value", period.sessionCount);
  setCardValue("profile-stat-fish-value", period.fishCount);
}

/** Reload preview cards and the open Stats page from local data. */
export async function reloadOpenStatsFromLocal() {
  await refreshProfileStatsPreview();
  const ov = document.getElementById("stats-overlay");
  if (ov && !ov.classList.contains("hidden")) {
    paintStatsPage();
  }
}

/**
 * @param {{ onOpen?: () => void, onClose?: () => void }} [options]
 */
export function wireUserStatsUi(options = {}) {
  document.getElementById("profile-stats-open")?.addEventListener("click", () => {
    if (typeof options.onOpen === "function") {
      options.onOpen();
      return;
    }
    void openStatsPage();
  });
  document.getElementById("stats-back")?.addEventListener("click", () => {
    if (typeof options.onClose === "function") {
      options.onClose();
      return;
    }
    closeStatsPage();
  });
  document.getElementById("stats-year")?.addEventListener("change", (event) => {
    const el = /** @type {HTMLSelectElement} */ (event.target);
    selectedYear = el.value === STATS_ALL_TIME ? STATS_ALL_TIME : Number(el.value);
    paintStatsPage();
  });
  document.getElementById("stats-species-picker")?.addEventListener("click", (event) => {
    const key = speciesKeyFromEvent(event);
    if (!key || key === STATS_ALL_TIME || !bundle) return;
    selectedSpecies = key;
    markPickerSelection("stats-species-picker", key);
    setSelectedName("stats-species-selected-name", key);
    paintSpeciesData(periodCatches(), bundle.userId);
  });
  document.getElementById("stats-month-picker")?.addEventListener("click", (event) => {
    const key = speciesKeyFromEvent(event);
    if (!key || !bundle) return;
    monthSpecies = key;
    markPickerSelection("stats-month-picker", key);
    setSelectedName("stats-month-selected-name", key);
    fillChart(periodCatches(), selectedYear, monthSpecies);
  });
}

export function closeStatsPage() {
  document.getElementById("stats-overlay")?.classList.add("hidden");
}

export function openStatsPageWithBundle(nextBundle) {
  selectedYear = new Date().getFullYear();
  monthSpecies = STATS_ALL_TIME;
  selectedSpecies = SPECIES_OPTIONS[0];
  bundle = nextBundle;
  document.getElementById("stats-overlay")?.classList.remove("hidden");
  paintStatsPage();
}

/**
 * @returns {Promise<void>}
 */
export async function openStatsPage() {
  selectedYear = new Date().getFullYear();
  monthSpecies = STATS_ALL_TIME;
  selectedSpecies = SPECIES_OPTIONS[0];
  bundle = await loadUserStatsBundle();
  document.getElementById("stats-overlay")?.classList.remove("hidden");
  paintStatsPage();
}

function paintStatsPage() {
  if (!bundle) return;
  const period = computeUserPeriodStats(
    bundle.sessions,
    bundle.catches,
    selectedYear
  );
  fillYearSelect(bundle.years, selectedYear);
  setCardValue("stats-overview-sessions-value", period.sessionCount);
  setCardValue("stats-overview-fish-value", period.fishCount);

  fillSpeciesPicker("stats-species-picker", selectedSpecies, false);
  setSelectedName("stats-species-selected-name", selectedSpecies);
  paintSpeciesData(period.catches, bundle.userId);

  fillSpeciesPicker("stats-month-picker", monthSpecies, true);
  setSelectedName("stats-month-selected-name", monthSpecies);
  fillChart(period.catches, selectedYear, monthSpecies);
  const monthHeading = document.getElementById("stats-month-heading");
  if (monthHeading) {
    monthHeading.textContent = selectedYear === STATS_ALL_TIME ? "Yearly catches" : "Monthly catches";
  }

  const totalEl = document.getElementById("stats-time-total");
  const avgEl = document.getElementById("stats-time-average");
  if (totalEl) totalEl.textContent = period.time.totalLabel;
  if (avgEl) avgEl.textContent = period.time.averageLabel;
}

function periodCatches() {
  if (!bundle) return [];
  return computeUserPeriodStats(bundle.sessions, bundle.catches, selectedYear).catches;
}

/**
 * @param {Event} event
 * @returns {string | null}
 */
function speciesKeyFromEvent(event) {
  const t = event.target;
  if (!(t instanceof Element)) return null;
  const btn = t.closest(".stats-species-btn");
  if (!btn) return null;
  const key = btn.getAttribute("data-species");
  return key || null;
}

/**
 * @param {string} containerId
 * @param {string} selected
 */
function markPickerSelection(containerId, selected) {
  const row = document.getElementById(containerId);
  if (!row) return;
  row.querySelectorAll(".stats-species-btn").forEach((btn) => {
    btn.setAttribute("aria-selected", btn.getAttribute("data-species") === selected ? "true" : "false");
  });
}

/**
 * @param {import('./db.js').CatchRecord[]} catches
 * @param {string} userId
 */
function paintSpeciesData(catches, userId) {
  const speciesBlock = document.getElementById("stats-species-data");
  if (!speciesBlock) return;
  const stats = statsForUserSpecies(catches, userId, selectedSpecies);
  speciesBlock.innerHTML = "";
  speciesBlock.append(
    statLine("Caught", String(stats.catchCount)),
    statLine("Top 5", formatTop5SummaryLine(stats.top5Fish))
  );
}

/**
 * @param {string} id
 * @param {string | typeof STATS_ALL_TIME} speciesKey
 */
function setSelectedName(id, speciesKey) {
  const el = document.getElementById(id);
  if (el) el.textContent = speciesStatsLabel(speciesKey);
}

/**
 * @param {string} id
 * @param {number} value
 */
function setCardValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

/**
 * @param {number[]} years
 * @param {number | typeof STATS_ALL_TIME} selected
 */
function fillYearSelect(years, selected) {
  const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById("stats-year"));
  if (!sel) return;
  sel.innerHTML = "";
  for (const y of years) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    sel.appendChild(opt);
  }
  const all = document.createElement("option");
  all.value = STATS_ALL_TIME;
  all.textContent = "All time";
  sel.appendChild(all);
  sel.value = String(selected);
}

/**
 * Every canonical species, including zero-catch ones. All species is monthly-only.
 * @param {string} containerId
 * @param {string | typeof STATS_ALL_TIME} selected
 * @param {boolean} includeAll
 */
function fillSpeciesPicker(containerId, selected, includeAll) {
  const row = document.getElementById(containerId);
  if (!row) return;
  row.innerHTML = "";
  if (includeAll) {
    row.appendChild(
      speciesIconBtn(STATS_ALL_TIME, "All species", ALL_SPECIES_ICON_SRC, "#e6edf3", selected === STATS_ALL_TIME)
    );
  }
  for (const key of SPECIES_OPTIONS) {
    const src = speciesIconSrc(key);
    if (!src) continue;
    row.appendChild(
      speciesIconBtn(key, SPECIES_LABELS[key] || key, src, colorForSpecies(key), selected === key)
    );
  }
}

/**
 * @param {string} key
 * @param {string} label
 * @param {string} src
 * @param {string} color
 * @param {boolean} active
 */
function speciesIconBtn(key, label, src, color, active) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "stats-species-btn";
  btn.setAttribute("data-species", key);
  btn.setAttribute("aria-label", label);
  btn.setAttribute("aria-selected", active ? "true" : "false");
  btn.style.setProperty("--species-color", color);
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  btn.appendChild(img);
  return btn;
}

/**
 * @param {string} label
 * @param {string} value
 */
function statLine(label, value) {
  const wrap = document.createElement("div");
  wrap.className = "stats-line";
  const h = document.createElement("h3");
  h.className = "stats-line-label";
  h.textContent = label;
  const p = document.createElement("p");
  p.className = "stats-line-value";
  p.textContent = value;
  wrap.append(h, p);
  return wrap;
}

/**
 * @param {import('./db.js').CatchRecord[]} catches
 * @param {number | typeof STATS_ALL_TIME} year
 * @param {string | typeof STATS_ALL_TIME} speciesKey
 */
function fillChart(catches, year, speciesKey) {
  const host = document.getElementById("stats-month-chart");
  if (!host) return;
  host.innerHTML = "";
  const name = speciesStatsLabel(speciesKey);
  const kind = year === STATS_ALL_TIME ? "yearly" : "monthly";
  host.setAttribute("aria-label", `${kind} catch counts for ${name}`);
  const barColor = speciesKey === STATS_ALL_TIME ? "" : colorForSpecies(speciesKey);
  if (year === STATS_ALL_TIME) {
    const rows = yearlyCatchCounts(catches, speciesKey);
    const max = Math.max(1, ...rows.map((r) => r.count));
    if (rows.length === 0) {
      host.appendChild(emptyChartNote());
      return;
    }
    for (const row of rows) {
      host.appendChild(chartCol(String(row.year), row.count, max, barColor));
    }
    return;
  }
  const counts = monthlyCatchCounts(catches, speciesKey);
  const max = Math.max(1, ...counts);
  MONTH_LABELS.forEach((label, i) => {
    host.appendChild(chartCol(label, counts[i], max, barColor));
  });
}

function emptyChartNote() {
  const p = document.createElement("p");
  p.className = "meta";
  p.textContent = "No catches in this period.";
  return p;
}

/**
 * @param {string} label
 * @param {number} count
 * @param {number} max
 * @param {string} barColor
 */
function chartCol(label, count, max, barColor) {
  const col = document.createElement("div");
  col.className = "stats-chart-col";
  const n = document.createElement("div");
  n.className = "stats-chart-count";
  n.textContent = String(count);
  const track = document.createElement("div");
  track.className = "stats-chart-track";
  const bar = document.createElement("div");
  bar.className = "stats-chart-bar";
  if (barColor) bar.style.setProperty("--stats-bar-color", barColor);
  bar.style.height = `${max > 0 ? (count / max) * 100 : 0}%`;
  track.appendChild(bar);
  const name = document.createElement("div");
  name.className = "stats-chart-label";
  name.textContent = label;
  col.append(n, track, name);
  return col;
}
