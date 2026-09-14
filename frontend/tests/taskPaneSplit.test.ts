import assert from "node:assert/strict";
import test from "node:test";

import {
	clampTaskPaneSplitRatio,
	clampVisibleTaskPaneSplitRatio,
	getTaskPaneCollapsedSide,
	getTaskPaneSplitRatioFromKeyboard,
	getTaskPaneSplitRatioFromPointerDelta,
	getTaskPaneSplitTracks,
	TASK_PANE_COLLAPSED_TRACK,
	TASK_PANE_VISIBLE_MIN_RATIO
} from "../src/lib/taskPaneSplit.ts";

test("task pane split ratios clamp to the full draggable range", () => {
	assert.equal(clampTaskPaneSplitRatio(-20), 0);
	assert.equal(clampTaskPaneSplitRatio(120), 100);
	assert.equal(clampTaskPaneSplitRatio(Number.NaN), 50);
	assert.equal(clampVisibleTaskPaneSplitRatio(5), TASK_PANE_VISIBLE_MIN_RATIO);
	assert.equal(clampVisibleTaskPaneSplitRatio(95), 100 - TASK_PANE_VISIBLE_MIN_RATIO);
});

test("task pane split tracks collapse only the undersized side", () => {
	assert.equal(getTaskPaneCollapsedSide(8), "first");
	assert.equal(getTaskPaneCollapsedSide(92), "second");
	assert.equal(getTaskPaneCollapsedSide(50), null);

	assert.deepEqual(getTaskPaneSplitTracks("horizontal", 8), {
		collapsedSide: "first",
		firstTrack: TASK_PANE_COLLAPSED_TRACK,
		secondTrack: "minmax(240px, 92fr)"
	});
	assert.deepEqual(getTaskPaneSplitTracks("vertical", 92), {
		collapsedSide: "second",
		firstTrack: "minmax(160px, 92fr)",
		secondTrack: TASK_PANE_COLLAPSED_TRACK
	});
});

test("task pane pointer delta converts to ratio changes", () => {
	assert.equal(getTaskPaneSplitRatioFromPointerDelta(50, 120, 600), 70);
	assert.equal(getTaskPaneSplitRatioFromPointerDelta(50, -180, 600), 20);
	assert.equal(getTaskPaneSplitRatioFromPointerDelta(50, 120, 0), 50);
	assert.equal(getTaskPaneSplitRatioFromPointerDelta(96, 120, 600), 100);
});

test("task pane keyboard controls resize and restore collapsed sides", () => {
	assert.equal(getTaskPaneSplitRatioFromKeyboard(50, "ArrowRight", "horizontal"), 54);
	assert.equal(getTaskPaneSplitRatioFromKeyboard(50, "ArrowLeft", "horizontal"), 46);
	assert.equal(getTaskPaneSplitRatioFromKeyboard(50, "ArrowDown", "vertical"), 54);
	assert.equal(getTaskPaneSplitRatioFromKeyboard(50, "ArrowUp", "vertical"), 46);
	assert.equal(getTaskPaneSplitRatioFromKeyboard(4, "ArrowRight", "horizontal"), TASK_PANE_VISIBLE_MIN_RATIO);
	assert.equal(getTaskPaneSplitRatioFromKeyboard(96, "ArrowLeft", "horizontal"), 100 - TASK_PANE_VISIBLE_MIN_RATIO);
	assert.equal(getTaskPaneSplitRatioFromKeyboard(50, "Home", "horizontal"), 0);
	assert.equal(getTaskPaneSplitRatioFromKeyboard(50, "End", "vertical"), 100);
});
