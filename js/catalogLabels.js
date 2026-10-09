/**
 * Display labels for catalog multi-select items.
 * @module catalogLabels
 */

/**
 * @param {{ name: string, userNumber?: number }} item
 * @returns {string}
 */
export function formatCatalogItemLabel(item) {
  if (typeof item.userNumber === "number") {
    return `${item.userNumber} — ${item.name}`;
  }
  return item.name;
}
