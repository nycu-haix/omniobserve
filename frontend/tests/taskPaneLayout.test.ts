import assert from "node:assert/strict";
import test from "node:test";

import { countTaskPaneLeaves, createDefaultTaskPaneLayout, getTaskPaneContents, type TaskPaneLayoutConfig } from "../src/lib/taskPaneLayout.ts";

const publicLayoutWithInstructions: TaskPaneLayoutConfig = {
	type: "split",
	direction: "horizontal",
	ratio: 58,
	first: { type: "leaf", content: "public-ranking" },
	second: {
		type: "split",
		direction: "vertical",
		ratio: 50,
		first: { type: "leaf", content: "private-ranking" },
		second: { type: "leaf", content: "task-instructions" }
	}
};

test("public phase default keeps task instructions available after phase transition", () => {
	const layout = createDefaultTaskPaneLayout("group");

	assert.deepEqual(getTaskPaneContents(layout), ["public-ranking", "private-ranking", "task-instructions"]);
	assert.equal(countTaskPaneLeaves(layout), 3);
});

test("public phase accepts configured ranking layout with task instructions", () => {
	const layout = createDefaultTaskPaneLayout("group", true, publicLayoutWithInstructions);

	assert.deepEqual(getTaskPaneContents(layout), ["public-ranking", "private-ranking", "task-instructions"]);
	assert.equal(countTaskPaneLeaves(layout), 3);
});
