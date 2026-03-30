/**
 * Session catch CSV export (comma-separated, dot decimals).
 * @module csvExport
 */

/** @type {readonly string[]} */
const HEADERS = [
  "timestamp",
  "session_id",
  "angler_id",
  "species",
  "length_cm",
  "weight_kg",
  "depth_m",
  "water_temp_c",
  "location_lat",
  "location_lng",
  "location_accuracy_m",
  "weather_summary",
  "air_temp_c",
  "wind_speed_ms",
  "wind_direction_deg",
];

/**
 * @param {string} s
 */
function escapeField(s) {
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param {number | null | undefined} n
 */
function numField(n) {
  if (n === null || n === undefined) return "";
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  return String(n);
}

/**
 * @param {import('./db.js').CatchRecord[]} catches
 * @returns {string}
 */
export function buildSessionCatchesCsv(catches) {
  const lines = [HEADERS.join(",")];
  const sorted = [...catches].sort((a, b) => a.timestamp - b.timestamp);
  for (const c of sorted) {
    const row = [
      escapeField(new Date(c.timestamp).toISOString()),
      escapeField(c.sessionId ?? ""),
      escapeField(c.anglerId ?? ""),
      escapeField(c.species ?? ""),
      numField(c.length),
      numField(c.weight_kg),
      numField(c.depth_m),
      numField(c.water_temp_c),
      numField(c.location_lat),
      numField(c.location_lng),
      numField(c.location_accuracy_m),
      escapeField(c.weather_summary ?? ""),
      numField(c.air_temp_c),
      numField(c.wind_speed_ms),
      numField(c.wind_direction_deg),
    ];
    lines.push(row.join(","));
  }
  return lines.join("\r\n");
}

/**
 * @returns {string} fish-log-YYYY-MM-DD.csv (local calendar date)
 */
export function defaultFishLogFilename() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `fish-log-${y}-${m}-${day}.csv`;
}

/**
 * @param {string} filename
 * @param {string} csvText
 */
export function triggerCsvDownload(filename, csvText) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
