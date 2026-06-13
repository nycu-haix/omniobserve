import assert from "node:assert/strict";
import test from "node:test";

import { getValidIdeaBlockJumpTargetIds, hasIdeaBlockJumpTarget, isValidIdeaBlockJumpTarget } from "../src/lib/ideaBlockJumpTargets.ts";

test("disables jump targets when the idea block is missing or unavailable", () => {
	const blocks = [
		{ id: "ready", status: "ready" },
		{ id: "pending", status: "generating" },
		{ id: "deleted", isDeleted: true }
	];

	assert.equal(hasIdeaBlockJumpTarget(blocks, "missing"), false);
	assert.equal(hasIdeaBlockJumpTarget(blocks, "pending"), false);
	assert.equal(hasIdeaBlockJumpTarget(blocks, "deleted"), false);
});

test("allows jump targets only when the referenced idea block exists", () => {
	const blocks = [{ id: 1 }, { id: 2, is_deleted: true }, { id: 3, status: "ready" }];

	assert.equal(isValidIdeaBlockJumpTarget(blocks[0], "1"), true);
	assert.equal(hasIdeaBlockJumpTarget(blocks, 3), true);
	assert.deepEqual(getValidIdeaBlockJumpTargetIds(blocks, [3, 2, 3, 99, 1]), [3, 1]);
});
