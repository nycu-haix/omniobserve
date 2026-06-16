export type TaskPaneSplitDirection = "horizontal" | "vertical";
export type TaskPaneCollapsedSide = "first" | "second" | null;

export const TASK_PANE_SPLIT_MIN_RATIO = 0;
export const TASK_PANE_SPLIT_MAX_RATIO = 100;
export const TASK_PANE_VISIBLE_MIN_RATIO = 24;
export const TASK_PANE_COLLAPSE_RATIO = 12;
export const TASK_PANE_HORIZONTAL_MIN_TRACK = "minmax(240px, var(--task-pane-first-ratio, 1fr))";
export const TASK_PANE_VERTICAL_MIN_TRACK = "minmax(160px, var(--task-pane-first-ratio, 1fr))";
export const TASK_PANE_COLLAPSED_TRACK = "2.5rem";
export const TASK_PANE_SEPARATOR_TRACK = "1rem";

export interface TaskPaneSplitTracks {
	firstTrack: string;
	secondTrack: string;
	collapsedSide: TaskPaneCollapsedSide;
}

export function clampTaskPaneSplitRatio(ratio: number) {
	if (!Number.isFinite(ratio)) {
		return 50;
	}
	return Math.min(TASK_PANE_SPLIT_MAX_RATIO, Math.max(TASK_PANE_SPLIT_MIN_RATIO, ratio));
}

export function clampVisibleTaskPaneSplitRatio(ratio: number) {
	return Math.min(TASK_PANE_SPLIT_MAX_RATIO - TASK_PANE_VISIBLE_MIN_RATIO, Math.max(TASK_PANE_VISIBLE_MIN_RATIO, ratio));
}

export function getTaskPaneCollapsedSide(ratio: number): TaskPaneCollapsedSide {
	const normalizedRatio = clampTaskPaneSplitRatio(ratio);
	if (normalizedRatio <= TASK_PANE_COLLAPSE_RATIO) {
		return "first";
	}
	if (normalizedRatio >= TASK_PANE_SPLIT_MAX_RATIO - TASK_PANE_COLLAPSE_RATIO) {
		return "second";
	}
	return null;
}

export function getTaskPaneSplitTracks(direction: TaskPaneSplitDirection, ratio: number): TaskPaneSplitTracks {
	const normalizedRatio = clampTaskPaneSplitRatio(ratio);
	const collapsedSide = getTaskPaneCollapsedSide(normalizedRatio);
	const firstRatio = Math.max(0.01, normalizedRatio);
	const secondRatio = Math.max(0.01, TASK_PANE_SPLIT_MAX_RATIO - normalizedRatio);
	const firstVisibleTrack = direction === "horizontal" ? `minmax(240px, ${firstRatio}fr)` : `minmax(160px, ${firstRatio}fr)`;
	const secondVisibleTrack = direction === "horizontal" ? `minmax(240px, ${secondRatio}fr)` : `minmax(160px, ${secondRatio}fr)`;

	return {
		collapsedSide,
		firstTrack: collapsedSide === "first" ? TASK_PANE_COLLAPSED_TRACK : firstVisibleTrack,
		secondTrack: collapsedSide === "second" ? TASK_PANE_COLLAPSED_TRACK : secondVisibleTrack
	};
}

export function getTaskPaneSplitRatioFromPointerDelta(startRatio: number, deltaPixels: number, containerPixels: number) {
	if (!Number.isFinite(containerPixels) || containerPixels <= 0) {
		return clampTaskPaneSplitRatio(startRatio);
	}
	return clampTaskPaneSplitRatio(startRatio + (deltaPixels / containerPixels) * TASK_PANE_SPLIT_MAX_RATIO);
}

export function getTaskPaneSplitRatioFromKeyboard(currentRatio: number, key: string, direction: TaskPaneSplitDirection, step = 4) {
	const collapsedSide = getTaskPaneCollapsedSide(currentRatio);
	const increaseKeys = direction === "horizontal" ? new Set(["ArrowRight"]) : new Set(["ArrowDown"]);
	const decreaseKeys = direction === "horizontal" ? new Set(["ArrowLeft"]) : new Set(["ArrowUp"]);

	if (key === "Home") {
		return TASK_PANE_SPLIT_MIN_RATIO;
	}
	if (key === "End") {
		return TASK_PANE_SPLIT_MAX_RATIO;
	}
	if (increaseKeys.has(key)) {
		if (collapsedSide === "first") {
			return TASK_PANE_VISIBLE_MIN_RATIO;
		}
		return clampTaskPaneSplitRatio(currentRatio + step);
	}
	if (decreaseKeys.has(key)) {
		if (collapsedSide === "second") {
			return TASK_PANE_SPLIT_MAX_RATIO - TASK_PANE_VISIBLE_MIN_RATIO;
		}
		return clampTaskPaneSplitRatio(currentRatio - step);
	}
	return currentRatio;
}
