/**
 * Draggable marker on satellite map for editing a catch location (fish overlay step 3).
 * @module fishEditLocationMap
 */

import L from "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/+esm";
import { SPECIES_MARKER_COLORS } from "./catchesMap.js";

const ESRI_SATELLITE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community";

/** Default view when catch has no coordinates (Finland). */
const DEFAULT_LAT = 62.5;
const DEFAULT_LNG = 25.5;

/** @type {unknown} */
let fishEditMapInstance = null;

/**
 * @param {unknown} v
 * @returns {v is number}
 */
function isFiniteNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * @param {HTMLElement | null} container
 */
export function destroyFishEditLocationMap(container) {
  if (fishEditMapInstance) {
    try {
      fishEditMapInstance.remove();
    } catch {
      /* ignore */
    }
    fishEditMapInstance = null;
  }
  if (container) {
    container.innerHTML = "";
  }
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   initialLat: number | null,
 *   initialLng: number | null,
 *   species: string,
 *   onMove: (lat: number, lng: number) => void,
 * }} opts
 */
export function mountFishEditLocationMap(container, opts) {
  destroyFishEditLocationMap(container);

  const hasCoords = isFiniteNum(opts.initialLat) && isFiniteNum(opts.initialLng);
  const lat = hasCoords ? /** @type {number} */ (opts.initialLat) : DEFAULT_LAT;
  const lng = hasCoords ? /** @type {number} */ (opts.initialLng) : DEFAULT_LNG;

  const map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
  });
  fishEditMapInstance = map;

  L.tileLayer(ESRI_SATELLITE, {
    attribution: ESRI_ATTRIBUTION,
    maxZoom: 19,
  }).addTo(map);

  const color = SPECIES_MARKER_COLORS[opts.species] || "#546e7a";
  const icon = L.divIcon({
    className: "fish-edit-marker-leaflet",
    html: `<div class="fish-edit-marker-dot" style="background:${color}"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

  const marker = L.marker([lat, lng], { draggable: true, icon });
  marker.addTo(map);

  marker.on("dragend", () => {
    const ll = marker.getLatLng();
    opts.onMove(ll.lat, ll.lng);
  });

  if (hasCoords) {
    map.setView([lat, lng], 16);
  } else {
    map.setView([lat, lng], 6);
  }

  return map;
}

export function invalidateFishEditMapSize() {
  if (fishEditMapInstance) {
    requestAnimationFrame(() => {
      try {
        fishEditMapInstance.invalidateSize();
      } catch {
        /* ignore */
      }
    });
  }
}
