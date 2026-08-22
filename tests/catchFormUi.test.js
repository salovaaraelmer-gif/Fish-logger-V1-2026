/**
 * Catch-form autofill tokens and keyboard helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CATCH_ENTRY_AUTOFILL_VALUE,
  CATCH_ENTRY_FIELD_SPECS,
  CATCH_KEYBOARD_HEIGHT_PX,
  CATCH_KEYBOARD_OPEN_CLASS,
  CATCH_VV_SYNC_CLASS,
  applyCatchEntryAutofillGuards,
  isCatchTypingField,
  isMobileKeyboardOpen,
  isPersonalAutofillToken,
  syncCatchOverlayToVisualViewport,
} from "../js/catchFormUi.js";

describe("catch entry autofill", () => {
  it("does not use login, payment, or address autocomplete tokens", () => {
    assert.equal(isPersonalAutofillToken(CATCH_ENTRY_AUTOFILL_VALUE), false);
    for (const spec of CATCH_ENTRY_FIELD_SPECS) {
      assert.equal(isPersonalAutofillToken(spec.name), false);
      assert.match(spec.name, /^al_catch_/);
    }
  });

  it("covers length, weight, depth, water temperature, and notes", () => {
    const ids = CATCH_ENTRY_FIELD_SPECS.map((spec) => spec.id);
    assert.deepEqual(ids, [
      "fish-input-length",
      "fish-input-weight",
      "fish-input-depth",
      "fish-input-water-temp",
      "fish-notes",
    ]);
  });

  it("applies non-personal names and strips pattern from measurement fields", () => {
    /** @type {Record<string, HTMLElement>} */
    const nodes = {};
    for (const spec of CATCH_ENTRY_FIELD_SPECS) {
      const attrs = new Map([["pattern", "[0-9]*"]]);
      nodes[spec.id] = {
        setAttribute(name, value) {
          attrs.set(name, String(value));
        },
        removeAttribute(name) {
          attrs.delete(name);
        },
        getAttribute(name) {
          return attrs.has(name) ? attrs.get(name) : null;
        },
      };
    }
    applyCatchEntryAutofillGuards({
      querySelector(selector) {
        const id = String(selector).slice(1);
        return nodes[id] || null;
      },
    });
    const length = nodes["fish-input-length"];
    assert.equal(length.getAttribute("name"), "al_catch_length_cm");
    assert.equal(length.getAttribute("autocomplete"), "off");
    assert.equal(length.getAttribute("pattern"), null);
    assert.equal(length.getAttribute("enterkeyhint"), "done");
    assert.equal(nodes["fish-notes"].getAttribute("enterkeyhint"), null);
  });
});

describe("isCatchTypingField", () => {
  it("treats text inputs and notes as typing fields", () => {
    assert.equal(isCatchTypingField({ tagName: "INPUT", type: "text" }), true);
    assert.equal(isCatchTypingField({ tagName: "TEXTAREA" }), true);
    assert.equal(isCatchTypingField({ tagName: "INPUT", type: "file" }), false);
    assert.equal(isCatchTypingField({ tagName: "BUTTON" }), false);
  });
});

describe("isMobileKeyboardOpen", () => {
  it("detects a keyboard-sized visual viewport shrink", () => {
    assert.equal(isMobileKeyboardOpen({ height: 400 }, 800), true);
    assert.equal(isMobileKeyboardOpen({ height: 780 }, 800), false);
    assert.equal(isMobileKeyboardOpen(null, 800), false);
    assert.ok(CATCH_KEYBOARD_HEIGHT_PX > 0);
  });
});

describe("syncCatchOverlayToVisualViewport", () => {
  it("pins a visible overlay to the visual viewport", () => {
    const classes = new Set();
    const style = new Map();
    const overlay = {
      classList: {
        contains: (name) => classes.has(name),
        add: (name) => classes.add(name),
        toggle: (name, on) => {
          if (on) classes.add(name);
          else classes.delete(name);
        },
        remove: (...names) => names.forEach((name) => classes.delete(name)),
      },
      style: {
        setProperty: (name, value) => style.set(name, value),
        removeProperty: (name) => style.delete(name),
      },
    };
    const open = syncCatchOverlayToVisualViewport(
      overlay,
      { height: 430, offsetTop: 12 },
      844
    );
    assert.equal(open, true);
    assert.equal(style.get("--catch-vv-height"), "430px");
    assert.equal(style.get("--catch-vv-top"), "12px");
    assert.equal(classes.has(CATCH_VV_SYNC_CLASS), true);
    assert.equal(classes.has(CATCH_KEYBOARD_OPEN_CLASS), true);
  });
});
