/**
 * Session catch CSV export (comma-separated, dot decimals).
 * @module csvExport
 */

/** @type {readonly string[]} */
const HEADERS = [
  "caught_at",
  "local_time",
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
  "source",
  "device_id",
  "client_event_id",
];

/**
 * Same instant as caught_at (UTC ISO), formatted for Europe/Helsinki (e.g. 31.03.2026 14.30.45).
 * @param {number} timestampMs
 */
function formatLocalTimeHelsinki(timestampMs) {
  return new Date(timestampMs).toLocaleString("en-GB", {
    timeZone: "Europe/Helsinki",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

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
 * @param {{ locationNames?: string[], targetNames?: string[] }} [meta]
 * @returns {string}
 */
export function buildSessionCatchesCsv(catches, meta = {}) {
  const lines = [];
  const locs = meta.locationNames?.length ? meta.locationNames.join(", ") : "";
  const targets = meta.targetNames?.length ? meta.targetNames.join(", ") : "";
  if (locs) lines.push(`# session_locations,${escapeField(locs)}`);
  if (targets) lines.push(`# session_target_species,${escapeField(targets)}`);
  lines.push(HEADERS.join(","));
  const sorted = [...catches].sort((a, b) => a.timestamp - b.timestamp);
  for (const c of sorted) {
    const caughtAtUtc = new Date(c.timestamp).toISOString();
    const localTime = formatLocalTimeHelsinki(c.timestamp);
    const row = [
      escapeField(caughtAtUtc),
      escapeField(localTime),
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
      escapeField(c.source ?? ""),
      escapeField(c.device_id ?? ""),
      escapeField(c.client_event_id ?? ""),
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
