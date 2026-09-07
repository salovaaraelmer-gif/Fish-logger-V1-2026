/**
 * Compact map callout placement. Keeps the bubble on-screen without resizing the map.
 * @module mapCallout
 */

/**
 * @param {{
 *   wrapW: number,
 *   wrapH: number,
 *   x: number,
 *   y: number,
 *   panelW: number,
 *   panelH: number,
 *   pad?: number,
 *   gap?: number,
 * }} opts
 * @returns {{ left: number, top: number, placement: "above" | "below", caretX: number }}
 */
export function placeMapCallout(opts) {
  const wrapW = Math.max(0, Number(opts.wrapW) || 0);
  const wrapH = Math.max(0, Number(opts.wrapH) || 0);
  const x = Number(opts.x) || 0;
  const y = Number(opts.y) || 0;
  const panelW = Math.max(0, Number(opts.panelW) || 0);
  const panelH = Math.max(0, Number(opts.panelH) || 0);
  const pad = Number.isFinite(opts.pad) ? Math.max(0, opts.pad) : 16;
  const gap = Number.isFinite(opts.gap) ? Math.max(0, opts.gap) : 16;

  let placement = /** @type {"above" | "below"} */ ("above");
  let top = y - panelH - gap;
  if (top < pad) {
    placement = "below";
    top = y + gap;
  }

  let left = x - panelW / 2;
  const maxLeft = Math.max(pad, wrapW - panelW - pad);
  if (left < pad) left = pad;
  if (left > maxLeft) left = maxLeft;

  const maxTop = Math.max(pad, wrapH - panelH - pad);
  if (top > maxTop) top = maxTop;
  if (top < pad) top = pad;

  const caretX = Math.min(Math.max(14, x - left), Math.max(14, panelW - 14));
  return { left, top, placement, caretX };
}
