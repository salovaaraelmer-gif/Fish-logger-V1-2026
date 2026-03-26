/**
 * Open-Meteo current weather (optional, non-blocking for catch save).
 * @module weatherService
 */

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

/**
 * @param {number} code WMO weather code
 * @returns {string}
 */
function wmoCodeSummaryFi(code) {
  if (code === 0) return "Selkeää";
  if (code === 1) return "Enimmäkseen selkeää";
  if (code === 2) return "Puolipilvistä";
  if (code === 3) return "Pilvistä";
  if (code === 45 || code === 48) return "Sumua";
  if (code === 51 || code === 53 || code === 55) return "Tihkusadetta";
  if (code === 56 || code === 57) return "Jäätävä tihku";
  if (code === 61 || code === 63 || code === 65) return "Sadetta";
  if (code === 66 || code === 67) return "Jäätävä sadetta";
  if (code === 71 || code === 73 || code === 75) return "Lumisadetta";
  if (code === 77) return "Lumijyviä";
  if (code === 80 || code === 81 || code === 82) return "Kuuroja";
  if (code === 85 || code === 86) return "Lumikuuroja";
  if (code === 95) return "Ukkosta";
  if (code === 96 || code === 99) return "Ukkosta rakeilla";
  return "Sää";
}

/**
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ weather_summary: string, air_temp_c: number, wind_speed_ms: number, wind_direction_deg: number } | null>}
 */
export async function fetchOpenMeteoCurrent(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const u = new URL(OPEN_METEO_BASE);
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lng));
  u.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m");
  u.searchParams.set("wind_speed_unit", "ms");
  u.searchParams.set("timezone", "auto");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(u.toString(), { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    const cur = data?.current;
    if (!cur) return null;
    const temp = cur.temperature_2m;
    const code = cur.weather_code;
    const wspd = cur.wind_speed_10m;
    const wdir = cur.wind_direction_10m;
    if (typeof temp !== "number" || typeof code !== "number") return null;
    if (typeof wspd !== "number" || typeof wdir !== "number") return null;
    return {
      weather_summary: wmoCodeSummaryFi(code),
      air_temp_c: temp,
      wind_speed_ms: wspd,
      wind_direction_deg: wdir,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
