import assert from "node:assert/strict";
import test from "node:test";

import { isEditableShortcutTarget, shouldHandleExperimentSpaceShortcut, type KeyboardShortcutTarget } from "../src/lib/keyboardShortcuts.ts";

function target(tagName: string, options: Partial<KeyboardShortcutTarget> = {}): KeyboardShortcutTarget {
	return { tagName, ...options };
}

test("space shortcut stays active on non-editable experiment surfaces", () => {
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: null }), true);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("button") }), true);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("div") }), true);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("canvas") }), true);
});

test("space shortcut stays active on non-text input controls", () => {
	for (const inputType of ["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]) {
		assert.equal(isEditableShortcutTarget(target("input", { inputType })), false);
		assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("input", { inputType }) }), true);
	}
});

test("space shortcut leaves explicit local space-key controls alone", () => {
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("div", { usesLocalSpaceShortcut: true }) }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("button", { usesLocalSpaceShortcut: true }) }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("button", { usesLocalSpaceShortcut: false }) }), true);
});

test("space shortcut is ignored in text-entry contexts", () => {
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("input") }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("input", { inputType: "text" }) }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("input", { inputType: "search" }) }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("textarea") }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("select") }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("div", { contentEditable: "true" }) }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("div", { isContentEditable: true }) }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", target: target("div", { role: "textbox" }) }), false);
});

test("space shortcut ignores repeats, modifiers, and non-space keys", () => {
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", repeat: true, target: null }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", metaKey: true, target: null }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", ctrlKey: true, target: null }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Space", altKey: true, target: null }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ code: "Enter", key: "Enter", target: null }), false);
	assert.equal(shouldHandleExperimentSpaceShortcut({ key: " ", target: null }), true);
});
