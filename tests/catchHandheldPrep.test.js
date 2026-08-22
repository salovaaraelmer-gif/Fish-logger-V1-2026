/**
 * Unit tests for catch origin, species, handheld mapping, and idempotent insert handling.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SPECIES_OPTIONS,
  SPECIES_COLORS,
  colorForSpecies,
  isAllowedSpecies,
  mapSpeciesFromDb,
  speciesWithCatches,
} from "../js/catchSpecies.js";
import {
  CATCH_SOURCE_HANDHELD,
  CATCH_SOURCE_PHONE,
  catchRecordToSupabasePayload,
  cloudCatchRowToLocal,
  ensureClientEventId,
  handheldPayloadToCatchRecord,
  isClientEventIdConflict,
  isUuid,
  MAX_CATCH_PHOTOS,
  normalizeDeviceId,
  normalizePhotoUrls,
  parseCaughtAtMs,
} from "../js/catchRecordMap.js";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const ANGLER_ID = "33333333-3333-4333-8333-333333333333";
const LOCAL_CATCH_ID = "44444444-4444-4444-8444-444444444444";
const AUTH_USER_ID = "55555555-5555-4555-8555-555555555555";
const CLOUD_ANGLER_ID = "66666666-6666-4666-8666-666666666666";
const CAUGHT_AT = "2026-08-20T12:34:56.000Z";
const CAUGHT_MS = Date.parse(CAUGHT_AT);

function handheldPayload(overrides = {}) {
  return {
    session_id: SESSION_ID,
    angler_id: ANGLER_ID,
    species: "salmon",
    length_cm: 72.5,
    weight_kg: 3.25,
    depth_m: 4.2,
    depth_source: "sonar",
    water_temp_c: 16.8,
    water_temp_source: "sensor",
    caught_at: CAUGHT_AT,
    location_lat: 60.1699,
    location_lng: 24.9384,
    location_source: "handheld",
    location_timestamp: 1724157296000,
    device_id: "HH-TEST-001",
    client_event_id: EVENT_ID,
    source: CATCH_SOURCE_HANDHELD,
    ...overrides,
  };
}

function phoneRecord(overrides = {}) {
  return {
    id: LOCAL_CATCH_ID,
    sessionId: "local-session",
    anglerId: AUTH_USER_ID,
    timestamp: CAUGHT_MS,
    species: "pike",
    length: 64,
    weight_kg: 2.1,
    notes: "",
    depth_m: 3,
    water_temp_c: 14,
    location_lat: 60.1,
    location_lng: 24.9,
    location_accuracy_m: 8,
    location_timestamp: CAUGHT_MS,
    depth_source: "manual",
    water_temp_source: "manual",
    location_source: "device",
    weather_summary: "Cloudy",
    air_temp_c: 12,
    wind_speed_ms: 4,
    wind_direction_deg: 180,
    supabase_id: null,
    source: CATCH_SOURCE_PHONE,
    device_id: null,
    client_event_id: EVENT_ID,
    photo_urls: [],
    ...overrides,
  };
}

describe("species list", () => {
  it("is identical for UI/local/sync and includes salmon", () => {
    assert.deepEqual([...SPECIES_OPTIONS], [
      "pike",
      "perch",
      "zander",
      "trout",
      "salmon",
      "other",
    ]);
    assert.equal(isAllowedSpecies("salmon"), true);
  });

  it("does not convert salmon to other", () => {
    assert.equal(mapSpeciesFromDb("salmon"), "salmon");
    assert.equal(mapSpeciesFromDb(" pike "), "pike");
  });

  it("uses one shared color mapping", () => {
    assert.equal(SPECIES_COLORS.pike, "#1B5E20");
    assert.equal(SPECIES_COLORS.perch, "#F57F17");
    assert.equal(SPECIES_COLORS.zander, "#0D47A1");
    assert.equal(SPECIES_COLORS.trout, "#616161");
    assert.equal(SPECIES_COLORS.salmon, "#D81B60");
    assert.equal(SPECIES_COLORS.other, "#4A148C");
    assert.equal(colorForSpecies("pike"), "#1B5E20");
  });

  it("lists only species that have catches, in app order", () => {
    assert.deepEqual(
      speciesWithCatches([{ species: "zander" }, { species: "pike" }, { species: "zander" }]),
      ["pike", "zander"]
    );
  });
});

describe("client_event_id", () => {
  it("reuses an existing UUID and never replaces it", () => {
    assert.equal(ensureClientEventId(EVENT_ID), EVENT_ID);
    const generated = ensureClientEventId(null);
    assert.equal(isUuid(generated), true);
    assert.notEqual(generated, EVENT_ID);
    assert.equal(ensureClientEventId(generated), generated);
  });
});

describe("phone catch mapping", () => {
  it("sends source=phone and device_id=null", () => {
    const payload = catchRecordToSupabasePayload(
      phoneRecord(),
      SESSION_ID,
      CLOUD_ANGLER_ID,
      "pike",
      AUTH_USER_ID
    );
    assert.equal(payload.source, "phone");
    assert.equal(payload.device_id, null);
    assert.equal(payload.client_event_id, EVENT_ID);
    assert.equal(payload.species, "pike");
    assert.equal(payload.user_id, AUTH_USER_ID);
    assert.equal(payload.angler_id, CLOUD_ANGLER_ID);
    assert.deepEqual(payload.photo_urls, []);
  });

  it("sends at most two photo URLs", () => {
    const payload = catchRecordToSupabasePayload(
      phoneRecord({
        photo_urls: ["https://example.com/a.jpg", "https://example.com/b.jpg", "https://example.com/c.jpg"],
      }),
      SESSION_ID,
      CLOUD_ANGLER_ID,
      "pike",
      AUTH_USER_ID
    );
    assert.deepEqual(payload.photo_urls, [
      "https://example.com/a.jpg",
      "https://example.com/b.jpg",
    ]);
  });

  it("strips a device_id on phone-originated catches", () => {
    assert.equal(normalizeDeviceId("phone", "HH-SHOULD-NOT-KEEP"), null);
    const payload = catchRecordToSupabasePayload(
      phoneRecord({ device_id: "HH-SHOULD-NOT-KEEP" }),
      SESSION_ID,
      CLOUD_ANGLER_ID,
      "pike",
      AUTH_USER_ID
    );
    assert.equal(payload.device_id, null);
  });
});

describe("handheld catch mapping", () => {
  it("preserves timestamp and source metadata exactly", () => {
    const mapped = handheldPayloadToCatchRecord(handheldPayload(), {
      localSessionId: "local-session",
      localAnglerId: AUTH_USER_ID,
      localCatchId: LOCAL_CATCH_ID,
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const rec = mapped.record;
    assert.equal(rec.timestamp, CAUGHT_MS);
    assert.equal(rec.source, "handheld");
    assert.equal(rec.device_id, "HH-TEST-001");
    assert.equal(rec.client_event_id, EVENT_ID);
    assert.equal(rec.species, "salmon");
    assert.equal(rec.length, 72.5);
    assert.equal(rec.weight_kg, 3.25);
    assert.equal(rec.depth_m, 4.2);
    assert.equal(rec.depth_source, "sonar");
    assert.equal(rec.water_temp_c, 16.8);
    assert.equal(rec.water_temp_source, "sensor");
    assert.equal(rec.location_lat, 60.1699);
    assert.equal(rec.location_lng, 24.9384);
    assert.equal(rec.location_source, "handheld");
    assert.equal(rec.location_timestamp, 1724157296000);
    assert.equal(rec.depth_source !== "manual", true);
    assert.equal(rec.water_temp_source !== "manual", true);
    assert.deepEqual(rec.photo_urls, []);
  });

  it("never copies photo URLs from a handheld payload", () => {
    const mapped = handheldPayloadToCatchRecord(
      handheldPayload({ photo_urls: ["https://example.com/should-not-keep.jpg"] }),
      {
        localSessionId: "local-session",
        localAnglerId: AUTH_USER_ID,
        localCatchId: LOCAL_CATCH_ID,
      }
    );
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.deepEqual(mapped.record.photo_urls, []);
  });

  it("does not generate a new client_event_id on a retry with the same payload", () => {
    const first = handheldPayloadToCatchRecord(handheldPayload(), {
      localSessionId: "local-session",
      localAnglerId: AUTH_USER_ID,
      localCatchId: LOCAL_CATCH_ID,
    });
    const second = handheldPayloadToCatchRecord(handheldPayload(), {
      localSessionId: "local-session",
      localAnglerId: AUTH_USER_ID,
      localCatchId: "99999999-9999-4999-8999-999999999999",
    });
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.record.client_event_id, EVENT_ID);
    assert.equal(second.record.client_event_id, first.record.client_event_id);
    assert.equal(first.record.timestamp, second.record.timestamp);
    assert.equal(first.record.depth_source, "sonar");
    assert.equal(second.record.depth_source, "sonar");
  });

  it("rejects a missing client_event_id instead of inventing one", () => {
    const mapped = handheldPayloadToCatchRecord(handheldPayload({ client_event_id: null }), {
      localSessionId: "local-session",
      localAnglerId: AUTH_USER_ID,
      localCatchId: LOCAL_CATCH_ID,
    });
    assert.equal(mapped.ok, false);
  });

  it("maps salmon through to the supabase payload", () => {
    const mapped = handheldPayloadToCatchRecord(handheldPayload(), {
      localSessionId: "local-session",
      localAnglerId: AUTH_USER_ID,
      localCatchId: LOCAL_CATCH_ID,
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const payload = catchRecordToSupabasePayload(
      mapped.record,
      SESSION_ID,
      CLOUD_ANGLER_ID,
      mapped.record.species,
      AUTH_USER_ID
    );
    assert.equal(payload.species, "salmon");
    assert.equal(payload.source, "handheld");
    assert.equal(payload.device_id, "HH-TEST-001");
    assert.equal(payload.client_event_id, EVENT_ID);
    assert.equal(payload.caught_at, CAUGHT_AT);
    assert.equal(payload.depth_source, "sonar");
    assert.equal(payload.angler_id, CLOUD_ANGLER_ID);
    assert.equal(payload.user_id, AUTH_USER_ID);
  });
});

describe("participant pull mapping", () => {
  it("keeps salmon and handheld origin fields", () => {
    const rec = cloudCatchRowToLocal(
      {
        id: "77777777-7777-4777-8777-777777777777",
        species: "salmon",
        length_cm: 80,
        weight_kg: 4,
        depth_m: 5,
        depth_source: "sonar",
        water_temp_c: 15,
        water_temp_source: "sensor",
        caught_at: CAUGHT_AT,
        location_lat: 61,
        location_lng: 25,
        location_source: "handheld",
        location_timestamp: 1,
        source: "handheld",
        device_id: "HH-TEST-001",
        client_event_id: EVENT_ID,
      },
      "local-session",
      AUTH_USER_ID,
      LOCAL_CATCH_ID
    );
    assert.equal(rec.species, "salmon");
    assert.equal(rec.source, "handheld");
    assert.equal(rec.device_id, "HH-TEST-001");
    assert.equal(rec.client_event_id, EVENT_ID);
    assert.equal(rec.timestamp, CAUGHT_MS);
    assert.equal(rec.depth_source, "sonar");
    assert.deepEqual(rec.photo_urls, []);
  });

  it("keeps up to two photo URLs from the cloud row", () => {
    const rec = cloudCatchRowToLocal(
      {
        id: "77777777-7777-4777-8777-777777777777",
        species: "pike",
        length_cm: 50,
        caught_at: CAUGHT_AT,
        source: "phone",
        client_event_id: EVENT_ID,
        photo_urls: ["https://example.com/1.jpg", "https://example.com/2.jpg", "https://example.com/3.jpg"],
      },
      "local-session",
      AUTH_USER_ID,
      LOCAL_CATCH_ID
    );
    assert.deepEqual(rec.photo_urls, ["https://example.com/1.jpg", "https://example.com/2.jpg"]);
  });
});

describe("catch photos", () => {
  it("caps normalized URLs at two", () => {
    assert.equal(MAX_CATCH_PHOTOS, 2);
    assert.deepEqual(normalizePhotoUrls(null), []);
    assert.deepEqual(normalizePhotoUrls(["  ", "https://a", "https://b", "https://c"]), [
      "https://a",
      "https://b",
    ]);
  });
});

describe("idempotent insert conflict", () => {
  it("treats unique client_event_id violations as retries, not new rows", () => {
    assert.equal(isClientEventIdConflict({ code: "23505" }), true);
    assert.equal(
      isClientEventIdConflict({
        code: "23505",
        message: 'duplicate key value violates unique constraint "catches_client_event_id_key"',
      }),
      true
    );
    assert.equal(isClientEventIdConflict({ code: "23503", message: "foreign key" }), false);
  });
});

describe("caught_at parsing", () => {
  it("parses ISO timestamps without substituting Date.now()", () => {
    const parsed = parseCaughtAtMs(CAUGHT_AT);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.ms, CAUGHT_MS);
    const missing = parseCaughtAtMs(null);
    assert.equal(missing.ok, false);
  });
});
