/**
 * Compact two-handle range slider for map length filters.
 * @module mapLengthSlider
 */

/**
 * @param {number} ratio
 * @param {number} minBound
 * @param {number} maxBound
 */
export function valueFromRailRatio(ratio, minBound, maxBound, step = 1) {
  const lo = Number(minBound);
  const hi = Number(maxBound);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return 0;
  if (hi === lo) return lo;
  const t = Math.min(1, Math.max(0, Number(ratio)));
  if (!Number.isFinite(t)) return lo;
  const raw = lo + t * (hi - lo);
  const grid = Number(step) > 0 ? Number(step) : 1;
  const snapped = Math.round(raw / grid) * grid;
  return Math.min(hi, Math.max(lo, snapped));
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   minBound: number,
 *   maxBound: number,
 *   value: { min: number, max: number },
 *   step?: number,
 *   onChange: (next: { min: number, max: number }) => void,
 * }} opts
 * @returns {{ setValue: (next: { min: number, max: number }) => void }}
 */
export function bindDualRangeSlider(root, opts) {
  const rail = root.querySelector("[data-rail]");
  const fill = root.querySelector("[data-fill]");
  const minThumb = root.querySelector('[data-thumb="min"]');
  const maxThumb = root.querySelector('[data-thumb="max"]');
  if (
    !(rail instanceof HTMLElement) ||
    !(fill instanceof HTMLElement) ||
    !(minThumb instanceof HTMLElement) ||
    !(maxThumb instanceof HTMLElement)
  ) {
    return { setValue() {} };
  }

  const boundMin = Number(opts.minBound);
  const boundMax = Number(opts.maxBound);
  const step = Number(opts.step) > 0 ? Number(opts.step) : 1;
  let lo = Number(opts.value?.min);
  let hi = Number(opts.value?.max);
  /** @type {"min" | "max" | null} */
  let active = null;

  function paint() {
    const span = boundMax - boundMin || 1;
    const minPct = ((lo - boundMin) / span) * 100;
    const maxPct = ((hi - boundMin) / span) * 100;
    minThumb.style.left = `${minPct}%`;
    maxThumb.style.left = `${maxPct}%`;
    fill.style.left = `${minPct}%`;
    fill.style.width = `${Math.max(0, maxPct - minPct)}%`;
    minThumb.setAttribute("aria-valuenow", String(lo));
    maxThumb.setAttribute("aria-valuenow", String(hi));
    minThumb.setAttribute("aria-valuemin", String(boundMin));
    minThumb.setAttribute("aria-valuemax", String(hi));
    maxThumb.setAttribute("aria-valuemin", String(lo));
    maxThumb.setAttribute("aria-valuemax", String(boundMax));
  }

  /**
   * @param {number} nextLo
   * @param {number} nextHi
   * @param {boolean} fromUser
   */
  function apply(nextLo, nextHi, fromUser) {
    let nextMin = clampBound(nextLo);
    let nextMax = clampBound(nextHi);
    if (active === "min" && nextMin > nextMax) nextMin = nextMax;
    if (active === "max" && nextMax < nextMin) nextMax = nextMin;
    if (nextMin > nextMax) {
      const swap = nextMin;
      nextMin = nextMax;
      nextMax = swap;
    }
    lo = nextMin;
    hi = nextMax;
    paint();
    if (fromUser) opts.onChange({ min: lo, max: hi });
  }

  /** @param {number} value */
  function clampBound(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return boundMin;
    const snapped = Math.round(n / step) * step;
    return Math.min(boundMax, Math.max(boundMin, snapped));
  }

  /** @param {number} clientX */
  function valueAt(clientX) {
    const box = rail.getBoundingClientRect();
    const ratio = box.width <= 0 ? 0 : (clientX - box.left) / box.width;
    return valueFromRailRatio(ratio, boundMin, boundMax, step);
  }

  /** @param {PointerEvent} event */
  function onPointerDown(event) {
    const target = event.target;
    if (!(target instanceof Element) || !root.contains(target)) return;
    if (target.closest("[data-thumb='min']")) active = "min";
    else if (target.closest("[data-thumb='max']")) active = "max";
    else if (target.closest("[data-rail]")) {
      const v = valueAt(event.clientX);
      active = Math.abs(v - lo) <= Math.abs(v - hi) ? "min" : "max";
      apply(active === "min" ? v : lo, active === "max" ? v : hi, true);
    } else {
      return;
    }
    event.preventDefault();
    (active === "min" ? minThumb : maxThumb).style.zIndex = "3";
    root.setPointerCapture(event.pointerId);
  }

  /** @param {PointerEvent} event */
  function onPointerMove(event) {
    if (!active) return;
    const v = valueAt(event.clientX);
    apply(active === "min" ? v : lo, active === "max" ? v : hi, true);
  }

  function onPointerUp() {
    active = null;
    minThumb.style.zIndex = "";
    maxThumb.style.zIndex = "";
  }

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerUp);

  /** @param {HTMLElement} thumb @param {"min" | "max"} which */
  function wireKeys(thumb, which) {
    thumb.addEventListener("keydown", (event) => {
      const down = event.key === "ArrowLeft" || event.key === "ArrowDown";
      const up = event.key === "ArrowRight" || event.key === "ArrowUp";
      if (!down && !up) return;
      event.preventDefault();
      active = which;
      const delta = down ? -step : step;
      apply(which === "min" ? lo + delta : lo, which === "max" ? hi + delta : hi, true);
      active = null;
    });
  }
  wireKeys(minThumb, "min");
  wireKeys(maxThumb, "max");

  apply(lo, hi, false);
  return {
    setValue(next) {
      active = null;
      apply(Number(next.min), Number(next.max), false);
    },
  };
}
