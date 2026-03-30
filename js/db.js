/**
 * IndexedDB persistence for Fish Logger V1.
 * @module db
 */

const DB_NAME = "FishLoggerV1";
const DB_VERSION = 4;

/** @typedef {{ id: string, displayName: string }} Angler */
/**
 * @typedef {{
 *   id: string,
 *   startTime: number,
 *   endTime: number | null,
 *   initialLocationLat?: number | null,
 *   initialLocationLng?: number | null,
 *   initialLocationAccuracyM?: number | null,
 *   initialLocationTimestamp?: number | null,
 *   csv_exported?: boolean,
 *   csv_exported_at?: string | null,
 * }} Session
 */
/** @typedef {{ id: string, sessionId: string, anglerId: string, isActive: boolean, joinedAt: number, leftAt: number | null }} SessionAngler */
/**
 * Local catch row: `sessionId` is the active session when saved; `anglerId` is who caught the fish.
 * @typedef {{
 *   id: string,
 *   sessionId: string | null,
 *   anglerId: string,
 *   timestamp: number,
 *   species: string,
 *   length: number | null,
 *   weight_kg: number | null, // kilograms only; no grams field
 *   notes: string,
 *   depth_m: number | null,
 *   water_temp_c: number | null,
 *   location_lat: number | null,
 *   location_lng: number | null,
 *   location_accuracy_m: number | null,
 *   location_timestamp: number | null,
 *   depth_source: string | null,
 *   water_temp_source: string | null,
 *   location_source: string | null,
 *   weather_summary: string | null,
 *   air_temp_c: number | null,
 *   wind_speed_ms: number | null,
 *   wind_direction_deg: number | null,
 *   supabase_id: string | null,
 * }} CatchRecord
 */

/**
 * @param {any} c
 * @returns {CatchRecord}
 */
function migrateCatchV1ToV2(c) {
  if (c && typeof c.depth_m !== "undefined") {
    const raw = /** @type {Record<string, unknown>} */ (c);
    // Drop legacy keys; persisted catches use `weight_kg` (kg) only.
    const { weight: _legacyWeight, weight_g: _legacyWeightG, ...rest } = raw;
    return /** @type {CatchRecord} */ ({
      ...rest,
      weight_kg: typeof raw.weight_kg === "number" ? raw.weight_kg : null,
      supabase_id: typeof raw.supabase_id === "string" && raw.supabase_id ? raw.supabase_id : null,
    });
  }
  const lat = c.gps?.lat ?? null;
  const lon = c.gps?.lon ?? null;
  const hasGps = typeof lat === "number" && typeof lon === "number";
  const depth = c.telemetry?.depth ?? null;
  const wtemp = c.telemetry?.waterTemp ?? null;
  return {
    id: c.id,
    sessionId: c.sessionId,
    anglerId: c.anglerId,
    timestamp: c.timestamp,
    species: c.species,
    length: c.length ?? null,
    weight_kg: null,
    notes: c.notes ?? "",
    depth_m: typeof depth === "number" ? depth : null,
    water_temp_c: typeof wtemp === "number" ? wtemp : null,
    location_lat: hasGps ? lat : null,
    location_lng: hasGps ? lon : null,
    location_accuracy_m: null,
    location_timestamp: hasGps ? c.timestamp : null,
    depth_source: typeof depth === "number" ? "manual" : null,
    water_temp_source: typeof wtemp === "number" ? "manual" : null,
    location_source: hasGps ? "device" : null,
    weather_summary: null,
    air_temp_c: null,
    wind_speed_ms: null,
    wind_direction_deg: null,
    supabase_id: null,
  };
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = /** @type {IDBDatabase} */ (e.target.result);
      const oldVersion = e.oldVersion;

      if (!db.objectStoreNames.contains("anglers")) {
        db.createObjectStore("anglers", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sessionAnglers")) {
        const sa = db.createObjectStore("sessionAnglers", { keyPath: "id" });
        sa.createIndex("bySession", "sessionId", { unique: false });
        sa.createIndex("byAngler", "anglerId", { unique: false });
      }
      if (!db.objectStoreNames.contains("catches")) {
        const c = db.createObjectStore("catches", { keyPath: "id" });
        c.createIndex("bySession", "sessionId", { unique: false });
      }

      if (oldVersion < 2 && db.objectStoreNames.contains("catches")) {
        const tx = /** @type {IDBTransaction} */ (e.target.transaction);
        const store = tx.objectStore("catches");
        const curReq = store.openCursor();
        curReq.onsuccess = (ev) => {
          const cursor = /** @type {IDBCursorWithValue | null} */ (ev.target.result);
          if (!cursor) return;
          const migrated = migrateCatchV1ToV2(cursor.value);
          cursor.update(migrated);
          cursor.continue();
        };
      }

      if (oldVersion < 3 && db.objectStoreNames.contains("sessions")) {
        const tx = /** @type {IDBTransaction} */ (e.target.transaction);
        const store = tx.objectStore("sessions");
        const curReq = store.openCursor();
        curReq.onsuccess = (ev) => {
          const cursor = /** @type {IDBCursorWithValue | null} */ (ev.target.result);
          if (!cursor) return;
          const s = /** @type {Record<string, unknown>} */ (cursor.value);
          if (typeof s.csv_exported === "undefined") {
            s.csv_exported = false;
            s.csv_exported_at = null;
            cursor.update(s);
          }
          cursor.continue();
        };
      }

      if (oldVersion < 4 && db.objectStoreNames.contains("catches")) {
        const tx = /** @type {IDBTransaction} */ (e.target.transaction);
        const store = tx.objectStore("catches");
        const curReq = store.openCursor();
        curReq.onsuccess = (ev) => {
          const cursor = /** @type {IDBCursorWithValue | null} */ (ev.target.result);
          if (!cursor) return;
          const row = /** @type {Record<string, unknown>} */ (cursor.value);
          if (typeof row.supabase_id === "undefined") {
            row.supabase_id = null;
            cursor.update(row);
          }
          cursor.continue();
        };
      }
    };
  });
}

/**
 * @returns {Promise<Angler[]>}
 */
export async function getAllAnglers() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("anglers", "readonly").objectStore("anglers").getAll();
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result || []);
  });
}

/**
 * @param {Angler} a
 */
export async function putAngler(a) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("anglers", "readwrite").objectStore("anglers").put(a);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve();
  });
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteAngler(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("anglers", "readwrite").objectStore("anglers").delete(id);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve();
  });
}

/**
 * True if any catch references this angler (any session).
 * @param {string} anglerId
 * @returns {Promise<boolean>}
 */
export async function hasCatchesForAngler(anglerId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("catches", "readonly").objectStore("catches").getAll();
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const list = r.result || [];
      const hit = list.some((raw) => {
        const c = migrateCatchV1ToV2(raw);
        return c.anglerId === anglerId;
      });
      resolve(hit);
    };
  });
}

/**
 * True if this angler appears in any session roster (active or ended).
 * @param {string} anglerId
 * @returns {Promise<boolean>}
 */
export async function hasSessionAnglerRowsForAngler(anglerId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const idx = db.transaction("sessionAnglers", "readonly").objectStore("sessionAnglers").index("byAngler");
    const req = idx.getAll(anglerId);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const list = req.result || [];
      resolve(list.length > 0);
    };
  });
}

/**
 * Cannot delete without breaking foreign-style references to past data.
 * @param {string} anglerId
 * @returns {Promise<boolean>}
 */
export async function isAnglerInUse(anglerId) {
  const [hasCatch, inAnySessionRoster] = await Promise.all([
    hasCatchesForAngler(anglerId),
    hasSessionAnglerRowsForAngler(anglerId),
  ]);
  return hasCatch || inAnySessionRoster;
}

/**
 * @param {Session} s
 */
export async function putSession(s) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("sessions", "readwrite").objectStore("sessions").put(s);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve();
  });
}

/**
 * @param {SessionAngler} sa
 */
export async function putSessionAngler(sa) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("sessionAnglers", "readwrite").objectStore("sessionAnglers").put(sa);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve();
  });
}

/**
 * @param {CatchRecord} c
 */
export async function putCatch(c) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("catches", "readwrite").objectStore("catches").put(c);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve();
  });
}

/**
 * @param {string} id
 * @returns {Promise<CatchRecord | null>}
 */
export async function getCatchById(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("catches", "readonly").objectStore("catches").get(id);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const row = r.result;
      resolve(row ? migrateCatchV1ToV2(row) : null);
    };
  });
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteCatch(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("catches", "readwrite").objectStore("catches").delete(id);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve();
  });
}

/**
 * All catches for a session, newest first.
 * @param {string} sessionId
 * @returns {Promise<CatchRecord[]>}
 */
export async function getCatchesForSession(sessionId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const idx = db.transaction("catches", "readonly").objectStore("catches").index("bySession");
    const r = idx.getAll(sessionId);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const list = /** @type {CatchRecord[]} */ (r.result || []);
      list.sort((a, b) => b.timestamp - a.timestamp);
      resolve(list.map((row) => migrateCatchV1ToV2(row)));
    };
  });
}

/**
 * Active session: endTime === null. At most one should exist.
 * @returns {Promise<Session | null>}
 */
export async function getActiveSession() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("sessions", "readonly").objectStore("sessions").getAll();
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const list = r.result || [];
      const active = list.find((s) => s.endTime === null);
      resolve(active || null);
    };
  });
}

/**
 * @param {string} id
 * @returns {Promise<Session | null>}
 */
export async function getSessionById(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("sessions", "readonly").objectStore("sessions").get(id);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result ?? null);
  });
}

/**
 * Ended sessions only (`endTime != null`), newest by end time first.
 * @returns {Promise<Session[]>}
 */
export async function getAllEndedSessions() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction("sessions", "readonly").objectStore("sessions").getAll();
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const list = /** @type {Session[]} */ (r.result || []).filter((s) => s.endTime != null);
      list.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));
      resolve(list);
    };
  });
}

/**
 * @param {string} sessionId
 * @returns {Promise<SessionAngler[]>}
 */
export async function getSessionAnglersForSession(sessionId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const idx = db.transaction("sessionAnglers", "readonly").objectStore("sessionAnglers").index("bySession");
    const r = idx.getAll(sessionId);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result || []);
  });
}

/**
 * @param {string} anglerId
 * @returns {Promise<boolean>}
 */
export async function isAnglerInAnyActiveSession(anglerId) {
  const active = await getActiveSession();
  if (!active) return false;
  const list = await getSessionAnglersForSession(active.id);
  return list.some((sa) => sa.anglerId === anglerId && sa.isActive);
}

/**
 * @param {string} sessionId
 * @param {string} anglerId
 * @returns {Promise<SessionAngler | undefined>}
 */
export async function findSessionAngler(sessionId, anglerId) {
  const all = await getSessionAnglersForSession(sessionId);
  return all.find((sa) => sa.anglerId === anglerId);
}
