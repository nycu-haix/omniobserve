import assert from "node:assert/strict";
import test from "node:test";

import {
	clearPendingTranscriptLinesIdeaBlockStatus,
	getIdeaBlockTranscriptLineIdsForBlockIds,
	hasReadyIdeaBlockForTranscriptLineIds,
	markTranscriptLinesIdeaBlockStatus
} from "../src/lib/transcriptLineIdeaBlockStatus.ts";
import type { IdeaBlock, TranscriptLine } from "../src/types/index.ts";

function transcriptLine(overrides: Partial<TranscriptLine> = {}): TranscriptLine {
	return {
		id: "t1",
		source: "private",
		text: "我覺得可以先看飲用水",
		...overrides
	};
}

function ideaBlock(overrides: Partial<IdeaBlock> = {}): IdeaBlock {
	return {
		id: "b1",
		summary: "飲用水很重要",
		transcript: "我覺得可以先看飲用水",
		transcriptLineId: "t1",
		status: "generating",
		...overrides
	};
}

test("finds transcript lines referenced by pending voice blocks", () => {
	const lineIds = getIdeaBlockTranscriptLineIdsForBlockIds(
		[ideaBlock({ id: "pending-1", transcriptLineId: "t1", sourceTranscriptIds: ["t2"] }), ideaBlock({ id: "ready-1", transcriptLineId: "t3" })],
		new Set(["pending-1"])
	);

	assert.deepEqual([...lineIds].sort(), ["t1", "t2"]);
});

test("detects existing ready idea blocks for transcript completions", () => {
	const blocks = [
		ideaBlock({ id: "pending-block", status: "generating", transcriptLineId: "t1" }),
		ideaBlock({ id: "ready-block", status: "ready", transcriptLineId: "t2", sourceTranscriptIds: ["t3"] }),
		ideaBlock({ id: "deleted-ready-block", status: "ready", transcriptLineId: "t4", isDeleted: true })
	];

	assert.equal(hasReadyIdeaBlockForTranscriptLineIds(blocks, new Set(["t1"])), false);
	assert.equal(hasReadyIdeaBlockForTranscriptLineIds(blocks, new Set(["t2"])), true);
	assert.equal(hasReadyIdeaBlockForTranscriptLineIds(blocks, new Set(["t3"])), true);
	assert.equal(hasReadyIdeaBlockForTranscriptLineIds(blocks, new Set(["t4"])), false);
});

test("marks private transcript lines with explicit processing status", () => {
	const lines = [transcriptLine({ id: "t1", linkedBlockId: "ready-block" }), transcriptLine({ id: "public-1", source: "public" })];
	const nextLines = markTranscriptLinesIdeaBlockStatus(lines, new Set(["t1", "public-1"]), "failed");

	assert.equal(nextLines[0]?.ideaBlockStatus, "failed");
	assert.equal(nextLines[0]?.linkedBlockId, undefined);
	assert.equal(nextLines[1], lines[1]);
});

test("clears only pending private transcript status during voice cleanup", () => {
	const lines = [
		transcriptLine({ id: "pending-line", ideaBlockStatus: "pending", linkedBlockId: "pending-block" }),
		transcriptLine({ id: "failed-line", ideaBlockStatus: "failed", linkedBlockId: "ready-block" }),
		transcriptLine({ id: "linked-line", linkedBlockId: "ready-block" }),
		transcriptLine({ id: "public-line", source: "public", ideaBlockStatus: "pending", linkedBlockId: "pending-block" })
	];
	const nextLines = clearPendingTranscriptLinesIdeaBlockStatus(lines, new Set(["pending-line", "failed-line", "linked-line", "public-line"]));

	assert.equal(nextLines[0]?.ideaBlockStatus, undefined);
	assert.equal(nextLines[0]?.linkedBlockId, undefined);
	assert.equal(nextLines[1], lines[1]);
	assert.equal(nextLines[2], lines[2]);
	assert.equal(nextLines[3], lines[3]);
});
