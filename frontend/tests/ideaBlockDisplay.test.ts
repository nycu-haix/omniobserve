import assert from "node:assert/strict";
import test from "node:test";

import { getDisplayedIdeaBlocks } from "../src/lib/ideaBlockDisplay.ts";

test("shows at most one generating idea block placeholder", () => {
	const blocks = [
		{ id: "ready-1", status: "ready" },
		{ id: "generating-1", status: "generating" },
		{ id: "generating-2", status: "generating" },
		{ id: "ready-2", status: "ready" }
	];

	assert.deepEqual(
		getDisplayedIdeaBlocks(blocks).map(block => block.id),
		["ready-1", "generating-1", "ready-2"]
	);
});
