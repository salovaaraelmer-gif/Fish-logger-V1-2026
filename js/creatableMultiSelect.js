/**
 * Compact multi-select: picking an option adds it immediately (no Add button).
 * Optional type-to-search list for catalogs such as fishing spots.
 * @module creatableMultiSelect
 */

import { formatCatalogItemLabel } from "./sessionMetadataService.js";
import {
  filterUnselectedCatalogItems,
  shouldShowCatalogCreateRow,
} from "./catalogSelectFilter.js";

export {
  catalogItemMatchesQuery,
  filterUnselectedCatalogItems,
  unselectedCatalogItems,
} from "./catalogSelectFilter.js";

/**
 * @typedef {import('./sessionMetadataService.js').CatalogItemDisplay} CatalogItemDisplay
 */

/**
 * @typedef {{
 *   container: HTMLElement,
 *   label: string,
 *   items: CatalogItemDisplay[],
 *   selectedIds: string[],
 *   onChange: (ids: string[]) => void,
 *   onCreateNew?: (name: string) => Promise<CatalogItemDisplay | null>,
 *   disabled?: boolean,
 *   searchable?: boolean,
 *   allowCreate?: boolean,
 * }} MountOptions
 */

/**
 * @param {MountOptions} opts
 */
export function mountCreatableMultiSelect(opts) {
  const { container, label, items, selectedIds, onChange, onCreateNew } = opts;
  const disabled = opts.disabled === true;
  const searchable = opts.searchable === true;
  const allowCreate = opts.allowCreate === true && typeof onCreateNew === "function";
  container.innerHTML = "";
  container.className = "creatable-multi-select stack";

  const title = document.createElement("div");
  title.className = "field-label";
  title.textContent = label;
  container.appendChild(title);

  const chips = document.createElement("div");
  chips.className = "creatable-multi-chips";
  container.appendChild(chips);

  /** @type {HTMLInputElement | null} */
  let searchInput = null;
  /** @type {HTMLElement | null} */
  let suggestList = null;
  if (searchable) {
    const searchWrap = document.createElement("div");
    searchWrap.className = "creatable-multi-search-wrap";
    searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.className = "creatable-multi-search-input";
    searchInput.placeholder = allowCreate ? "Search or type a new name" : "Search";
    searchInput.autocomplete = "off";
    searchInput.name = "al_catalog_search";
    searchInput.setAttribute("data-lpignore", "true");
    searchInput.setAttribute("data-1p-ignore", "true");
    searchInput.disabled = disabled;
    if (allowCreate) searchInput.enterKeyHint = "enter";
    suggestList = document.createElement("div");
    suggestList.className = "creatable-multi-suggest hidden";
    suggestList.setAttribute("role", "listbox");
    searchWrap.append(searchInput, suggestList);
    container.appendChild(searchWrap);
  }

  const row = document.createElement("div");
  row.className = "creatable-multi-row";
  const select = document.createElement("select");
  select.className = "creatable-multi-select-input";
  select.disabled = disabled;
  select.setAttribute("aria-label", label);
  row.appendChild(select);
  container.appendChild(row);

  const newRow = document.createElement("div");
  newRow.className = "creatable-multi-new-row";
  const newInput = document.createElement("input");
  newInput.type = "text";
  newInput.className = "creatable-multi-new-input";
  newInput.placeholder = "New name";
  newInput.autocomplete = "off";
  newInput.name = "al_catalog_new_name";
  newInput.setAttribute("data-lpignore", "true");
  newInput.setAttribute("data-1p-ignore", "true");
  newInput.disabled = disabled;
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "btn small-btn";
  newBtn.textContent = "+ New";
  newBtn.disabled = disabled;
  newRow.append(newInput, newBtn);
  if (shouldShowCatalogCreateRow({ allowCreate, disabled })) {
    container.appendChild(newRow);
  }

  /** @type {Set<string>} */
  const selected = new Set(selectedIds);

  function available(query) {
    return filterUnselectedCatalogItems(items, selected, query ?? "");
  }

  function fillSelect() {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    const remaining = available("");
    placeholder.textContent = remaining.length === 0 ? "All selected" : "Select…";
    select.innerHTML = "";
    select.appendChild(placeholder);
    for (const item of remaining) {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = formatCatalogItemLabel(item);
      select.appendChild(opt);
    }
    select.value = "";
    select.disabled = disabled || remaining.length === 0;
  }

  function hideSuggest() {
    suggestList?.classList.add("hidden");
  }

  /**
   * @param {string} query
   * @param {CatalogItemDisplay[]} matches
   */
  function appendCreateSuggestAction(query, matches) {
    if (!allowCreate || disabled || !suggestList) return;
    const trimmed = query.trim();
    if (!trimmed) return;
    const exact = matches.find(
      (item) => item.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (exact) return;
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn creatable-multi-suggest-item";
    addBtn.textContent = `Add “${trimmed}”`;
    addBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      void createAndAdd(trimmed);
    });
    suggestList.appendChild(addBtn);
  }

  function renderSuggest() {
    if (!searchable || !suggestList || !searchInput) return;
    const query = searchInput.value;
    const matches = available(query);
    suggestList.innerHTML = "";
    if (matches.length === 0) {
      const empty = document.createElement("p");
      empty.className = "meta creatable-multi-suggest-empty";
      empty.textContent = query.trim() ? "No matches" : "No spots left to add";
      suggestList.appendChild(empty);
      appendCreateSuggestAction(query, matches);
      suggestList.classList.remove("hidden");
      return;
    }
    for (const item of matches) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn creatable-multi-suggest-item";
      btn.setAttribute("role", "option");
      btn.textContent = formatCatalogItemLabel(item);
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        addId(item.id);
      });
      suggestList.appendChild(btn);
    }
    appendCreateSuggestAction(query, matches);
    suggestList.classList.remove("hidden");
  }

  function renderChips() {
    chips.innerHTML = "";
    for (const id of selected) {
      const item = items.find((i) => i.id === id);
      const chip = document.createElement("span");
      chip.className = "creatable-multi-chip";
      chip.textContent = item ? formatCatalogItemLabel(item) : id;
      if (!disabled) {
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "creatable-multi-chip-remove";
        rm.setAttribute("aria-label", `Remove ${item?.name || id}`);
        rm.textContent = "×";
        rm.addEventListener("click", () => {
          selected.delete(id);
          onChange([...selected]);
          fillSelect();
          renderChips();
          if (searchable && searchInput === document.activeElement) renderSuggest();
        });
        chip.appendChild(rm);
      }
      chips.appendChild(chip);
    }
  }

  /**
   * @param {string} id
   */
  function addId(id) {
    if (!id || selected.has(id)) return;
    selected.add(id);
    onChange([...selected]);
    fillSelect();
    renderChips();
    if (searchInput) searchInput.value = "";
    hideSuggest();
  }

  /**
   * @param {string} name
   */
  async function createAndAdd(name) {
    const trimmed = name.trim();
    if (!trimmed || typeof onCreateNew !== "function") return;
    const created = await onCreateNew(trimmed);
    if (!created) return;
    if (!items.find((i) => i.id === created.id)) items.push(created);
    items.sort((a, b) => a.userNumber - b.userNumber || a.name.localeCompare(b.name, "en"));
    selected.add(created.id);
    newInput.value = "";
    if (searchInput) searchInput.value = "";
    onChange([...selected]);
    fillSelect();
    renderChips();
    hideSuggest();
  }

  select.addEventListener("change", () => {
    const id = select.value;
    if (!id) return;
    addId(id);
  });

  newBtn.addEventListener("click", () => {
    void createAndAdd(newInput.value);
  });

  if (searchInput) {
    searchInput.addEventListener("focus", () => renderSuggest());
    searchInput.addEventListener("input", () => renderSuggest());
    searchInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const query = searchInput.value;
      const matches = available(query);
      const exact = matches.find(
        (item) => item.name.trim().toLowerCase() === query.trim().toLowerCase()
      );
      if (exact) {
        addId(exact.id);
        return;
      }
      if (matches.length === 1) {
        addId(matches[0].id);
        return;
      }
      if (allowCreate) void createAndAdd(query);
    });
    searchInput.addEventListener("blur", () => {
      setTimeout(() => hideSuggest(), 120);
    });
  }

  fillSelect();
  renderChips();
}
