/**
 * Reusable species comparison dashboard (active and ended sessions).
 * @module speciesDashboard
 */

import { SPECIES_LABELS, colorForSpecies } from "./catchSpecies.js";
import {
  colorForAnglerIndex,
  defaultSelectedSpecies,
  formatMeasuredCatchLine,
  listDashboardSpecies,
  rankAnglersForDashboard,
  sessionTop5ForSpecies,
  statsForAnglerSpecies,
} from "./speciesDashboardStats.js";

const STATE = new WeakMap();

const AVATAR_SVG = `<svg viewBox="0 0 24 24" class="species-dash-avatar-icon" aria-hidden="true">
  <circle cx="12" cy="8.5" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7" />
  <path d="M5.6 19.2c1-3.1 3.2-4.7 6.4-4.7s5.4 1.6 6.4 4.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
</svg>`;

/**
 * @typedef {{ id: string, name?: string | null, avatarUrl?: string | null }} DashAngler
 * @typedef {{
 *   anglers: DashAngler[],
 *   catches: { anglerId: string, species: string, length?: number | null, weight_kg?: number | null }[],
 *   targetSpeciesKeys: string[],
 * }} DashModel
 */

/**
 * @param {HTMLElement} container
 * @param {DashModel} model
 */
export function mountSpeciesDashboard(container, model) {
  const speciesList = listDashboardSpecies(model.targetSpeciesKeys, model.catches);
  const prev = STATE.get(container) || {};
  let selected =
    typeof prev.selectedSpecies === "string" && speciesList.includes(prev.selectedSpecies)
      ? prev.selectedSpecies
      : defaultSelectedSpecies(model.targetSpeciesKeys, speciesList);
  let mode = prev.mode === "top5" ? "top5" : "catches";
  if (!prev.wiredTips) {
    document.addEventListener("click", (event) => {
      if (!container.contains(/** @type {Node} */ (event.target))) {
        closeNameTips(container);
      }
    });
  }

  function paint() {
    STATE.set(container, { selectedSpecies: selected, mode, wiredTips: true });
    container.className = "species-dash";
    container.innerHTML = "";
    if (model.anglers.length === 0 || !selected) {
      const empty = document.createElement("p");
      empty.className = "meta";
      empty.textContent = "No species to compare yet.";
      container.appendChild(empty);
      return;
    }

    container.appendChild(buildModeRow(mode, (next) => {
      mode = next;
      paint();
    }));
    if (mode === "top5") {
      container.appendChild(buildSessionTop5Section(model, selected));
      const personalHead = document.createElement("h3");
      personalHead.className = "species-dash-section-title";
      personalHead.textContent = "By angler";
      container.appendChild(personalHead);
    }
    container.appendChild(buildGrid(model, selected, mode));
    container.appendChild(buildSpeciesRow(speciesList, selected, (key) => {
      selected = key;
      paint();
    }));
  }

  paint();
}

/**
 * @param {string[]} speciesList
 * @param {string} selected
 * @param {(key: string) => void} onPick
 */
function buildSpeciesRow(speciesList, selected, onPick) {
  const row = document.createElement("div");
  row.className = "species-dash-species";
  row.setAttribute("role", "tablist");
  row.setAttribute("aria-label", "Species");
  for (const key of speciesList) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn species-dash-chip";
    btn.style.setProperty("--species-color", colorForSpecies(key));
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", key === selected ? "true" : "false");
    btn.textContent = SPECIES_LABELS[key] || key;
    btn.addEventListener("click", () => onPick(key));
    row.appendChild(btn);
  }
  return row;
}

/**
 * @param {"catches" | "top5"} mode
 * @param {(mode: "catches" | "top5") => void} onPick
 */
function buildModeRow(mode, onPick) {
  const row = document.createElement("div");
  row.className = "species-dash-modes";
  row.setAttribute("role", "tablist");
  row.setAttribute("aria-label", "Dashboard mode");
  row.append(
    modeBtn("Catches", mode === "catches", () => onPick("catches")),
    modeBtn("Top 5", mode === "top5", () => onPick("top5"))
  );
  return row;
}

/**
 * @param {string} label
 * @param {boolean} active
 * @param {() => void} onClick
 */
function modeBtn(label, active, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn species-dash-mode-btn";
  btn.setAttribute("aria-selected", active ? "true" : "false");
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

/**
 * @param {DashModel} model
 * @param {string} selected
 */
function buildSessionTop5Section(model, selected) {
  const section = document.createElement("section");
  section.className = "species-dash-session-top5";
  const label = SPECIES_LABELS[selected] || selected;
  section.setAttribute("aria-label", `Session Top 5 ${label}`);
  const title = document.createElement("h3");
  title.className = "species-dash-section-title";
  title.textContent = `Session Top 5 — ${label}`;
  section.appendChild(title);

  const { fish, total } = sessionTop5ForSpecies(model.catches, selected);
  if (fish.length === 0) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "No measured catches yet.";
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement("ol");
  list.className = "species-dash-session-top5-list";
  const names = new Map(model.anglers.map((a) => [a.id, (a.name && a.name.trim()) || "Angler"]));
  for (const row of fish) {
    const item = document.createElement("li");
    const anglerName = (row.anglerId && names.get(row.anglerId)) || "Angler";
    item.textContent = `${formatMeasuredCatchLine(row)} — ${anglerName}`;
    list.appendChild(item);
  }
  section.appendChild(list);
  const totalEl = document.createElement("p");
  totalEl.className = "species-dash-session-top5-total";
  totalEl.textContent = `Total: ${total} cm`;
  section.appendChild(totalEl);
  return section;
}

/**
 * @param {DashModel} model
 * @param {string} selected
 * @param {"catches" | "top5"} mode
 */
function buildGrid(model, selected, mode) {
  const wrap = document.createElement("div");
  wrap.className = "species-dash-grid";
  if (mode === "top5") wrap.classList.add("is-top5-mode");
  wrap.style.setProperty("--dash-cols", String(model.anglers.length));
  wrap.setAttribute(
    "aria-label",
    mode === "top5"
      ? `Top 5 ${SPECIES_LABELS[selected] || selected} by angler`
      : `Catches of ${SPECIES_LABELS[selected] || selected} by angler`
  );

  const ranked = rankAnglersForDashboard(
    model.anglers.map((angler, rosterIndex) => ({
      angler,
      rosterIndex,
      stats: statsForAnglerSpecies(model.catches, angler.id, selected),
    })),
    mode
  );
  const maxCount = Math.max(0, ...ranked.map((row) => row.stats.catchCount));

  ranked.forEach((row, displayIndex) => {
    const color = colorForAnglerIndex(row.rosterIndex);
    wrap.appendChild(buildAvatarCell(wrap, row.angler, color, displayIndex));
    wrap.appendChild(
      mode === "top5"
        ? buildTop5Cell(row.stats, color, displayIndex)
        : buildBarCell(row.stats.catchCount, maxCount, color, displayIndex)
    );
  });
  return wrap;
}

/**
 * @param {HTMLElement} root
 */
function closeNameTips(root) {
  root.querySelectorAll(".species-dash-avatar-cell.is-name-open").forEach((el) => {
    el.classList.remove("is-name-open");
  });
}

/**
 * @param {HTMLElement} grid
 * @param {DashAngler} angler
 * @param {string} color
 * @param {number} index
 */
function buildAvatarCell(grid, angler, color, index) {
  const name = (typeof angler.name === "string" && angler.name.trim()) || "Angler";
  const cell = document.createElement("div");
  cell.className = "species-dash-avatar-cell";
  cell.style.setProperty("--dash-color", color);
  cell.style.gridColumn = String(index + 1);
  const face = document.createElement("button");
  face.type = "button";
  face.className = "species-dash-avatar";
  face.setAttribute("aria-label", name);
  const url = typeof angler.avatarUrl === "string" ? angler.avatarUrl.trim() : "";
  if (url) {
    const img = document.createElement("img");
    img.className = "species-dash-avatar-img";
    img.alt = "";
    img.src = url;
    face.appendChild(img);
  } else {
    face.innerHTML = AVATAR_SVG;
  }
  const tip = document.createElement("span");
  tip.className = "species-dash-avatar-name";
  tip.textContent = name;
  cell.append(face, tip);
  face.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = cell.classList.contains("is-name-open");
    closeNameTips(grid);
    if (!open) cell.classList.add("is-name-open");
  });
  return cell;
}

/**
 * @param {number} count
 * @param {number} maxCount
 * @param {string} color
 * @param {number} index
 */
function buildBarCell(count, maxCount, color, index) {
  const cell = document.createElement("div");
  cell.className = "species-dash-body species-dash-bars";
  cell.style.setProperty("--dash-color", color);
  cell.style.gridColumn = String(index + 1);
  const track = document.createElement("div");
  track.className = "species-dash-bar-track";
  const bar = document.createElement("div");
  bar.className = "species-dash-bar";
  const pct = maxCount > 0 ? Math.max(0, (count / maxCount) * 100) : 0;
  bar.style.height = `${pct}%`;
  track.appendChild(bar);
  const n = document.createElement("div");
  n.className = "species-dash-count";
  n.textContent = String(count);
  cell.append(track, n);
  return cell;
}

/**
 * @param {{ top5Fish: { length: number, weightKg: number | null }[], top5Total: number }} stats
 * @param {string} color
 * @param {number} index
 */
function buildTop5Cell(stats, color, index) {
  const cell = document.createElement("div");
  cell.className = "species-dash-body species-dash-top5";
  cell.style.setProperty("--dash-color", color);
  cell.style.gridColumn = String(index + 1);
  const stack = document.createElement("div");
  stack.className = "species-dash-top5-stack";
  for (const fish of stats.top5Fish) {
    const line = document.createElement("div");
    line.className = "species-dash-len";
    line.textContent = formatMeasuredCatchLine(fish);
    stack.appendChild(line);
  }
  const rule = document.createElement("div");
  rule.className = "species-dash-total-rule";
  const total = document.createElement("div");
  total.className = "species-dash-total";
  total.textContent = `${stats.top5Total} cm`;
  stack.append(rule, total);
  cell.appendChild(stack);
  return cell;
}
