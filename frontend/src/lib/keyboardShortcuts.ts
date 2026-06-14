export interface KeyboardShortcutTarget {
	tagName: string;
	inputType?: string;
	role?: string | null;
	contentEditable?: string | null;
	isContentEditable?: boolean;
}

interface ExperimentSpaceShortcutState {
	code?: string;
	key?: string;
	repeat?: boolean;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	target?: KeyboardShortcutTarget | null;
}

const EDITABLE_SHORTCUT_TARGET_SELECTOR = "input, textarea, select, [contenteditable], [role='textbox']";
const NON_TEXT_INPUT_TYPES = new Set(["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"]);

export function getKeyboardShortcutTarget(target: EventTarget | null): KeyboardShortcutTarget | null {
	if (!(target instanceof HTMLElement)) {
		return null;
	}

	const shortcutTarget = target.closest(EDITABLE_SHORTCUT_TARGET_SELECTOR);
	if (!(shortcutTarget instanceof HTMLElement)) {
		return null;
	}

	const descriptor: KeyboardShortcutTarget = {
		tagName: shortcutTarget.tagName.toLowerCase(),
		role: shortcutTarget.getAttribute("role"),
		contentEditable: shortcutTarget.getAttribute("contenteditable"),
		isContentEditable: shortcutTarget.isContentEditable
	};

	if (shortcutTarget instanceof HTMLInputElement) {
		descriptor.inputType = shortcutTarget.type;
	}

	return descriptor;
}

export function isEditableShortcutTarget(target: KeyboardShortcutTarget | null | undefined) {
	if (!target) {
		return false;
	}

	if (target.isContentEditable || target.contentEditable === "" || target.contentEditable === "true" || target.role === "textbox") {
		return true;
	}

	if (target.tagName === "textarea" || target.tagName === "select") {
		return true;
	}

	if (target.tagName !== "input") {
		return false;
	}

	return !NON_TEXT_INPUT_TYPES.has((target.inputType || "text").toLowerCase());
}

export function shouldHandleExperimentSpaceShortcut(event: ExperimentSpaceShortcutState) {
	const isSpaceKey = event.code === "Space" || event.key === " ";
	return isSpaceKey && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !isEditableShortcutTarget(event.target);
}
