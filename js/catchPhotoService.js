/**
 * Compress and upload catch photos to Supabase Storage (max two per catch).
 * @module catchPhotoService
 */

import { supabase } from "./supabase.js";
import { MAX_CATCH_PHOTOS, normalizePhotoUrls } from "./catchRecordMap.js";

export { MAX_CATCH_PHOTOS, normalizePhotoUrls };

export const CATCH_PHOTO_BUCKET = "catch-photos";
export const CATCH_PHOTO_MAX_EDGE = 1600;
export const CATCH_PHOTO_JPEG_QUALITY = 0.82;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * @typedef {{ kind: "url", url: string } | { kind: "file", file: File }} CatchPhotoSlot
 */

/**
 * @param {File} file
 * @returns {string | null}
 */
export function catchPhotoFileError(file) {
  if (!(file instanceof File) || file.size < 1) return "Choose a photo.";
  if (!ALLOWED_TYPES.has(file.type)) return "Use a JPEG, PNG, or WebP photo.";
  return null;
}

/**
 * @param {File} file
 * @returns {Promise<Blob>}
 */
export function compressCatchPhoto(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, CATCH_PHOTO_MAX_EDGE / Math.max(img.width, img.height, 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not compress photo."));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error("Could not compress photo."));
          else resolve(blob);
        },
        "image/jpeg",
        CATCH_PHOTO_JPEG_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read photo."));
    };
    img.src = objectUrl;
  });
}

/**
 * @param {string} userId
 * @param {string} catchId
 * @param {number} slot — 1 or 2
 * @param {Blob} blob
 * @returns {Promise<{ ok: true, url: string } | { ok: false, error: string }>}
 */
export async function uploadCatchPhoto(userId, catchId, slot, blob) {
  if (!userId) return { ok: false, error: "Not signed in." };
  if (!catchId) return { ok: false, error: "Catch id is missing." };
  const n = slot === 2 ? 2 : 1;
  const path = `${userId}/${catchId}/${n}.jpg`;
  const up = await supabase.storage.from(CATCH_PHOTO_BUCKET).upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
    cacheControl: "3600",
  });
  if (up.error) {
    const msg = up.error.message || "Upload failed.";
    if (/bucket not found/i.test(msg)) {
      return {
        ok: false,
        error: "Photo storage is not set up yet. Run SUPABASE_CATCH_PHOTOS.sql in the Supabase SQL editor.",
      };
    }
    return { ok: false, error: msg };
  }
  const pub = supabase.storage.from(CATCH_PHOTO_BUCKET).getPublicUrl(path);
  const url = pub?.data?.publicUrl;
  if (!url) return { ok: false, error: "Could not build photo URL." };
  const join = url.includes("?") ? "&" : "?";
  return { ok: true, url: `${url}${join}v=${Date.now()}` };
}

/**
 * Upload any new files and return at most two public URLs.
 * @param {string} userId
 * @param {string} catchId
 * @param {CatchPhotoSlot[]} slots
 * @returns {Promise<{ ok: true, urls: string[] } | { ok: false, error: string, urls: string[] }>}
 */
export async function resolveCatchPhotoUrls(userId, catchId, slots) {
  const kept = [];
  const toUpload = [];
  for (const slot of slots.slice(0, MAX_CATCH_PHOTOS)) {
    if (slot.kind === "url" && slot.url) kept.push(slot);
    else if (slot.kind === "file" && slot.file) toUpload.push(slot);
  }
  if (toUpload.length === 0) {
    return { ok: true, urls: normalizePhotoUrls(kept.map((s) => s.url)) };
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      ok: false,
      error: "Photos were skipped while offline.",
      urls: normalizePhotoUrls(kept.map((s) => s.url)),
    };
  }

  /** @type {string[]} */
  const urls = [];
  let nextSlot = 1;
  for (const slot of slots.slice(0, MAX_CATCH_PHOTOS)) {
    if (slot.kind === "url" && slot.url) {
      urls.push(slot.url);
      nextSlot += 1;
      continue;
    }
    if (slot.kind !== "file" || !slot.file) continue;
    const fileErr = catchPhotoFileError(slot.file);
    if (fileErr) return { ok: false, error: fileErr, urls: normalizePhotoUrls(urls) };
    let blob;
    try {
      blob = await compressCatchPhoto(slot.file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not compress photo.";
      return { ok: false, error: msg, urls: normalizePhotoUrls(urls) };
    }
    const up = await uploadCatchPhoto(userId, catchId, nextSlot, blob);
    if (!up.ok) return { ok: false, error: up.error, urls: normalizePhotoUrls(urls) };
    urls.push(up.url);
    nextSlot += 1;
  }
  return { ok: true, urls: normalizePhotoUrls(urls) };
}
