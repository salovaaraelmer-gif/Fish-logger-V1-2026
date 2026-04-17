/**
 * Satellite map of catches (Leaflet + Esri World Imagery).
 * @module catchesMap
 */

import L from "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/+esm";

/** @type {unknown} */
let activeMap = null;

/** Finnish labels for map legend / popups */
export const SPECIES_MAP_LABELS = {
  pike: "Hauki",
  perch: "Ahven",
  zander: "Kuha",
  trout: "Taimen",
  other: "Muu",
};

/** Marker stroke/fill by species key */
export const SPECIES_MARKER_COLORS = {
  pike: "#1b5e20",
  perch: "#f57f17",
  zander: "#0d47a1",
  trout: "#b71c1c",
  other: "#4a148c",
};

const ESRI_SATELLITE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community";

const SESSION_OWNER_SUFFIX = " (session owner)";

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

/**
 * @param {number} ts
 * @param {boolean} activeSession
 */
function formatCatchTime(ts, activeSession) {
  const d = new Date(ts);
  if (activeSession) {
    return d.toLocaleTimeString("fi-FI", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("fi-FI", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * @param {import('./db.js').CatchRecord} c
 * @param {Record<string, string>} nameById
 * @param {string | null} ownerUserId
 * @param {boolean} activeSession
 */
function buildPopupHtml(c, nameById, ownerUserId, activeSession) {
  const rawName = nameById[c.anglerId] || c.anglerId;
  const angler =
    ownerUserId && c.anglerId === ownerUserId
      ? `${rawName}${SESSION_OWNER_SUFFIX}`
      : rawName;
  const spLabel = SPECIES_MAP_LABELS[c.species] || c.species;
  const lines = [
    `<strong>${escapeHtml(spLabel)}</strong>`,
    escapeHtml(formatCatchTime(c.timestamp, activeSession)),
    escapeHtml(angler),
  ];
  if (c.length != null && typeof c.length === "number" && c.length >= 1) {
    lines.push(`Pituus: ${c.length} cm`);
  }
  if (c.weight_kg != null && typeof c.weight_kg === "number" && Number.isFinite(c.weight_kg)) {
    lines.push(`Paino: ${c.weight_kg.toLocaleString("fi-FI", { maximumFractionDigits: 2 })} kg`);
  }
  if (c.depth_m != null && typeof c.depth_m === "number" && Number.isFinite(c.depth_m)) {
    lines.push(`Syvyys: ${c.depth_m.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} m`);
  }
  if (c.water_temp_c != null && typeof c.water_temp_c === "number" && Number.isFinite(c.water_temp_c)) {
    lines.push(`Vesi: ${c.water_temp_c.toLocaleString("fi-FI", { maximumFractionDigits: 1 })} °C`);
  }
  if (
    c.location_accuracy_m != null &&
    typeof c.location_accuracy_m === "number" &&
    Number.isFinite(c.location_accuracy_m)
  ) {
    lines.push(`Sijainnin tarkkuus: ±${Math.round(c.location_accuracy_m)} m`);
  }
  const notes = (c.notes || "").trim();
  if (notes) {
    lines.push(`<span class="catch-map-popup-notes">${escapeHtml(notes)}</span>`);
  }
  return `<div class="catch-map-popup">${lines.map((x) => `<div>${x}</div>`).join("")}</div>`;
}

/**
 * @param {HTMLElement | null} legendEl
 */
export function renderSpeciesLegend(legendEl) {
  if (!legendEl) return;
  legendEl.innerHTML = "";
  const row = document.createElement("div");
  row.className = "catches-map-legend-row";
  for (const [key, label] of Object.entries(SPECIES_MAP_LABELS)) {
    const col = document.createElement("div");
    col.className = "catches-map-legend-item";
    const dot = document.createElement("span");
    dot.className = "catches-map-legend-dot";
    dot.style.background = SPECIES_MARKER_COLORS[key] || "#666";
    col.appendChild(dot);
    col.appendChild(document.createTextNode(label));
    row.appendChild(col);
  }
  legendEl.appendChild(row);
}

/**
 * Removes the active map instance and clears the container.
 * @param {HTMLElement | null} container
 */
export function destroyCatchesMap(container) {
  if (activeMap) {
    try {
      activeMap.remove();
    } catch {
      /* ignore */
    }
    activeMap = null;
  }
  if (container) {
    container.innerHTML = "";
  }
}

/**
 * @typedef {{
 *   catches: import('./db.js').CatchRecord[],
 *   nameById: Record<string, string>,
 *   ownerUserId: string | null,
 *   activeSession: boolean,
 * }} CatchesMapOptions
 */

/**
 * @param {HTMLElement} container
 * @param {CatchesMapOptions} opts
 * @returns {boolean} true if markers were added
 */
export function mountCatchesMap(container, opts) {
  destroyCatchesMap(container);

  const withLoc = opts.catches.filter(
    (c) =>
      typeof c.location_lat === "number" &&
      typeof c.location_lng === "number" &&
      Number.isFinite(c.location_lat) &&
      Number.isFinite(c.location_lng)
  );

  if (withLoc.length === 0) {
    return false;
  }

  const map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
  });
  activeMap = map;

  L.tileLayer(ESRI_SATELLITE, {
    attribution: ESRI_ATTRIBUTION,
    maxZoom: 19,
  }).addTo(map);

  const group = L.featureGroup();
  for (const c of withLoc) {
    const color = SPECIES_MARKER_COLORS[c.species] || "#546e7a";
    const m = L.circleMarker([c.location_lat, c.location_lng], {
      radius: 9,
      color: "#ffffff",
      weight: 2,
      opacity: 1,
      fillColor: color,
      fillOpacity: 0.92,
    });
    m.bindPopup(buildPopupHtml(c, opts.nameById, opts.ownerUserId, opts.activeSession), {
      maxWidth: 280,
      className: "catch-map-popup-wrap",
    });
    group.addLayer(m);
  }
  group.addTo(map);

  if (withLoc.length === 1) {
    map.setView([withLoc[0].location_lat, withLoc[0].location_lng], 16);
  } else {
    map.fitBounds(group.getBounds(), { padding: [40, 48], maxZoom: 17 });
  }

  return true;
}

/**
 * Call after the map container becomes visible (tab switch).
 */
export function invalidateActiveCatchesMapSize() {
  if (activeMap) {
    requestAnimationFrame(() => {
      try {
        activeMap.invalidateSize();
      } catch {
        /* ignore */
      }
    });
  }
}
