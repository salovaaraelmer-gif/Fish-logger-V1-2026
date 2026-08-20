/**
 * Compact multi-select with optional "create new" catalog entry.
 * @module creatableMultiSelect
 */

import { formatCatalogItemLabel } from "./sessionMetadataService.js";

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
 *   onCreateNew: (name: string) => Promise<CatalogItemDisplay | null>,
 *   disabled?: boolean,
 * }} MountOptions
 */

/**
 * @param {MountOptions} opts
 */
export function mountCreatableMultiSelect(opts) {
  const { container, label, items, selectedIds, onChange, onCreateNew } = opts;
  const disabled = opts.disabled === true;
  container.innerHTML = "";
  container.className = "creatable-multi-select stack";

  const title = document.createElement("div");
  title.className = "field-label";
  title.textContent = label;
  container.appendChild(title);

  const chips = document.createElement("div");
  chips.className = "creatable-multi-chips";
  container.appendChild(chips);

  const row = document.createElement("div");
  row.className = "creatable-multi-row";

  const select = document.createElement("select");
  select.className = "creatable-multi-select-input";
  select.disabled = disabled;
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Select…";
  select.appendChild(empty);
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = formatCatalogItemLabel(item);
    select.appendChild(opt);
  }
  row.appendChild(select);

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn small-btn";
  addBtn.textContent = "Add";
  addBtn.disabled = disabled;
  row.appendChild(addBtn);
  container.appendChild(row);

  const newRow = document.createElement("div");
  newRow.className = "creatable-multi-new-row";
  const newInput = document.createElement("input");
  newInput.type = "text";
  newInput.className = "creatable-multi-new-input";
  newInput.placeholder = "New name";
  newInput.autocomplete = "off";
  newInput.disabled = disabled;
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "btn small-btn";
  newBtn.textContent = "+ New";
  newBtn.disabled = disabled;
  newRow.append(newInput, newBtn);
  container.appendChild(newRow);

  /** @type {Set<string>} */
  const selected = new Set(selectedIds);

  function renderChips() {
    chips.innerHTML = "";
    for (const id of selected) {
      const item = items.find((i) => i.id === id);
      if (!item) continue;
      const chip = document.createElement("span");
      chip.className = "creatable-multi-chip";
      chip.textContent = formatCatalogItemLabel(item);
      if (!disabled) {
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "creatable-multi-chip-remove";
        rm.setAttribute("aria-label", `Remove ${item.name}`);
        rm.textContent = "×";
        rm.addEventListener("click", () => {
          selected.delete(id);
          onChange([...selected]);
          renderChips();
        });
        chip.appendChild(rm);
      }
      chips.appendChild(chip);
    }
  }

  addBtn.addEventListener("click", () => {
    const id = select.value;
    if (!id) return;
    selected.add(id);
    select.value = "";
    onChange([...selected]);
    renderChips();
  });

  newBtn.addEventListener("click", async () => {
    const name = newInput.value.trim();
    if (!name) return;
    newBtn.disabled = true;
    const created = await onCreateNew(name);
    newBtn.disabled = false;
    if (!created) return;
    const existing = items.find((i) => i.id === created.id);
    if (!existing) items.push(created);
    items.sort((a, b) => a.userNumber - b.userNumber || a.name.localeCompare(b.name, "en"));
    select.innerHTML = "";
    select.appendChild(empty);
    for (const item of items) {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = formatCatalogItemLabel(item);
      select.appendChild(opt);
    }
    selected.add(created.id);
    newInput.value = "";
    onChange([...selected]);
    renderChips();
  });

  renderChips();
}
