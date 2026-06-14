export interface KeyboardShortcutTarget {
	tagName: string;
	inputType?: string;
	role?: string | null;
	contentEditable?: string | null;
	isContentEditable?: boolean;
	usesLocalSpaceShortcut?: boolean;
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
const LOCAL_SPACE_SHORTCUT_ATTRIBUTE = "data-local-space-shortcut";

export function getKeyboardShortcutTarget(target: EventTarget | null): KeyboardShortcutTarget | null {
	if (!(target instanceof HTMLElement)) {
		return null;
	}

	if (target.getAttribute(LOCAL_SPACE_SHORTCUT_ATTRIBUTE) === "true") {
		return describeKeyboardShortcutElement(target, true);
	}

	const shortcutTarget = target.closest(EDITABLE_SHORTCUT_TARGET_SELECTOR);
	if (!(shortcutTarget instanceof HTMLElement)) {
		return null;
	}

	return describeKeyboardShortcutElement(shortcutTarget, false);
}

function describeKeyboardShortcutElement(shortcutTarget: HTMLElement, usesLocalSpaceShortcut: boolean): KeyboardShortcutTarget {
	const descriptor: KeyboardShortcutTarget = {
		tagName: shortcutTarget.tagName.toLowerCase(),
		role: shortcutTarget.getAttribute("role"),
		contentEditable: shortcutTarget.getAttribute("contenteditable"),
		isContentEditable: shortcutTarget.isContentEditable,
		usesLocalSpaceShortcut
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
	return isSpaceKey && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.target?.usesLocalSpaceShortcut && !isEditableShortcutTarget(event.target);
}
