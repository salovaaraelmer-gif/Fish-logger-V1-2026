/**
 * Filter helpers for session catalog multi-select (spots / target species).
 * @module catalogSelectFilter
 */

/**
 * @typedef {{ id: string, name: string, userNumber?: number }} CatalogItem
 */

/**
 * @param {CatalogItem} item
 * @param {string} query
 * @returns {boolean}
 */
export function catalogItemMatchesQuery(item, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  const name = String(item?.name ?? "").toLowerCase();
  const number = String(item?.userNumber ?? "");
  return name.includes(q) || number.includes(q);
}

/**
 * @param {CatalogItem[]} items
 * @param {Iterable<string>} selectedIds
 * @returns {CatalogItem[]}
 */
export function unselectedCatalogItems(items, selectedIds) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  return items.filter((item) => item && typeof item.id === "string" && !selected.has(item.id));
}

/**
 * @param {CatalogItem[]} items
 * @param {Iterable<string>} selectedIds
 * @param {string} query
 * @returns {CatalogItem[]}
 */
export function filterUnselectedCatalogItems(items, selectedIds, query) {
  return unselectedCatalogItems(items, selectedIds).filter((item) =>
    catalogItemMatchesQuery(item, query)
  );
}

/**
 * Fishing-spot creation and target-species creation are independent.
 * Disabling one must not disable the other.
 *
 * @param {"location" | "target"} kind
 * @param {{ allowLocationCreate?: boolean, allowTargetCreate?: boolean }} [flags]
 * @returns {boolean}
 */
export function canCreateCatalogItem(kind, flags = {}) {
  if (kind === "location") return flags.allowLocationCreate !== false;
  if (kind === "target") return flags.allowTargetCreate === true;
  return false;
}

/**
 * Show the "+ New" row whenever create is allowed, including searchable lists.
 *
 * @param {{ allowCreate?: boolean, disabled?: boolean }} opts
 * @returns {boolean}
 */
export function shouldShowCatalogCreateRow(opts) {
  return opts.allowCreate === true && opts.disabled !== true;
}
