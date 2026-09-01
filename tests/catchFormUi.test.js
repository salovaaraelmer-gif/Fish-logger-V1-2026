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
  CATCH_NAV_FOCUS_CLASS,
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
      assert.equal(isPersonalAutofillToken(spec.id), false);
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

  it("applies neutral names, non-personal autocomplete, and readonly until focus", () => {
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
    assert.equal(length.getAttribute("name"), "al_meas_cm");
    assert.equal(length.getAttribute("autocomplete"), "al-no-fill");
    assert.equal(length.getAttribute("inputmode"), "numeric");
    assert.equal(length.getAttribute("pattern"), null);
    assert.equal(length.getAttribute("readonly"), "true");
    assert.equal(length.getAttribute("enterkeyhint"), "done");
    assert.equal(nodes["fish-input-weight"].getAttribute("inputmode"), "decimal");
    assert.equal(nodes["fish-notes"].getAttribute("name"), "al_field_memo");
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
  function mockOverlay() {
    const classes = new Set();
    const style = new Map();
    return {
      classes,
      style,
      overlay: {
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
        contains: () => false,
      },
    };
  }

  it("pins a visible overlay to the visual viewport", () => {
    const { overlay, classes, style } = mockOverlay();
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

  it("clears the keyboard class when the viewport is restored while a field may stay focused", () => {
    const { overlay, classes } = mockOverlay();
    syncCatchOverlayToVisualViewport(overlay, { height: 430, offsetTop: 0 }, 844);
    assert.equal(classes.has(CATCH_KEYBOARD_OPEN_CLASS), true);
    const open = syncCatchOverlayToVisualViewport(overlay, { height: 844, offsetTop: 0 }, 844);
    assert.equal(open, false);
    assert.equal(classes.has(CATCH_KEYBOARD_OPEN_CLASS), false);
    assert.equal(classes.has(CATCH_NAV_FOCUS_CLASS), false);
  });
});
