/**
 * Catch photo slots on the Notes step and a full-size viewer for catch cards.
 * @module catchPhotoUi
 */

import { MAX_CATCH_PHOTOS } from "./catchRecordMap.js";

/**
 * @typedef {null | { kind: "url", url: string } | { kind: "file", file: File, preview: string }} FishPhotoSlot
 */

/**
 * @param {FishPhotoSlot} slot
 * @returns {string}
 */
export function fishPhotoSlotPreviewUrl(slot) {
  if (!slot) return "";
  return slot.kind === "url" ? slot.url : slot.preview;
}

/**
 * @param {HTMLElement | null} root
 * @param {FishPhotoSlot[]} slots
 * @param {{
 *   onAdd: (index: number) => void,
 *   onRemove: (index: number) => void,
 *   onPreview: (url: string) => void,
 * }} handlers
 */
export function renderFishPhotoSlots(root, slots, handlers) {
  if (!root) return;
  root.replaceChildren();
  for (let i = 0; i < MAX_CATCH_PHOTOS; i += 1) {
    const slot = slots[i] || null;
    const wrap = document.createElement("div");
    wrap.className = "fish-photo-slot";
    if (!slot) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "fish-photo-slot-add";
      add.textContent = "Add photo";
      add.addEventListener("click", () => handlers.onAdd(i));
      wrap.appendChild(add);
    } else {
      const preview = fishPhotoSlotPreviewUrl(slot);
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "fish-photo-slot-thumb";
      thumb.setAttribute("aria-label", `View photo ${i + 1}`);
      const img = document.createElement("img");
      img.src = preview;
      img.alt = "";
      thumb.appendChild(img);
      thumb.addEventListener("click", () => handlers.onPreview(preview));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "fish-photo-slot-remove";
      remove.setAttribute("aria-label", `Remove photo ${i + 1}`);
      remove.textContent = "×";
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        handlers.onRemove(i);
      });
      wrap.append(thumb, remove);
    }
    root.appendChild(wrap);
  }
}

/**
 * @param {string} url
 */
export function openCatchPhotoViewer(url) {
  const ov = document.getElementById("catch-photo-viewer");
  const img = /** @type {HTMLImageElement | null} */ (document.getElementById("catch-photo-viewer-img"));
  if (!ov || !img || !url) return;
  img.src = url;
  ov.classList.remove("hidden");
}

export function closeCatchPhotoViewer() {
  const ov = document.getElementById("catch-photo-viewer");
  const img = /** @type {HTMLImageElement | null} */ (document.getElementById("catch-photo-viewer-img"));
  if (img) img.removeAttribute("src");
  ov?.classList.add("hidden");
}

export function wireCatchPhotoViewer() {
  const ov = document.getElementById("catch-photo-viewer");
  const closeBtn = document.getElementById("catch-photo-viewer-close");
  closeBtn?.addEventListener("click", () => closeCatchPhotoViewer());
  ov?.addEventListener("click", (e) => {
    if (e.target === ov) closeCatchPhotoViewer();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!ov || ov.classList.contains("hidden")) return;
    closeCatchPhotoViewer();
  });
}
