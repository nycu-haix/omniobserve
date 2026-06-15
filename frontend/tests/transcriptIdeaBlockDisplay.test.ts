import assert from "node:assert/strict";
import test from "node:test";

import { getTranscriptIdeaBlockStatus, getTranscriptIdeaBlockTargetId, linkTranscriptLinesToReadyBlocks } from "../src/lib/transcriptIdeaBlockDisplay.ts";
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
		status: "ready",
		...overrides
	};
}

test("keeps raw transcript lines without idea-block affordances", () => {
	const line = transcriptLine();

	assert.equal(getTranscriptIdeaBlockStatus(line, []), "raw");
	assert.equal(getTranscriptIdeaBlockTargetId(line, []), null);
	assert.deepEqual(linkTranscriptLinesToReadyBlocks([line], []), [line]);
});

test("marks generating idea blocks as pending instead of jump targets", () => {
	const line = transcriptLine({ linkedBlockId: "pending" });
	const blocks = [ideaBlock({ id: "pending", status: "generating" })];
	const linkedLines = linkTranscriptLinesToReadyBlocks([line], blocks);

	assert.equal(getTranscriptIdeaBlockStatus(line, blocks), "pending");
	assert.equal(getTranscriptIdeaBlockTargetId(line, blocks), null);
	assert.equal(linkedLines[0]?.linkedBlockId, undefined);
});

test("links transcript lines only after a ready idea block exists", () => {
	const line = transcriptLine();
	const blocks = [ideaBlock({ id: "ready-block" })];
	const linkedLines = linkTranscriptLinesToReadyBlocks([line], blocks);

	assert.equal(getTranscriptIdeaBlockStatus(line, blocks), "linked");
	assert.equal(getTranscriptIdeaBlockTargetId(line, blocks), "ready-block");
	assert.equal(linkedLines[0]?.linkedBlockId, "ready-block");
});

test("ignores deleted and public transcript matches", () => {
	const privateLine = transcriptLine({ linkedBlockId: "deleted" });
	const publicLine = transcriptLine({ id: "p1", source: "public" });
	const blocks = [ideaBlock({ id: "deleted", isDeleted: true })];
	const linkedLines = linkTranscriptLinesToReadyBlocks([privateLine, publicLine], blocks);

	assert.equal(getTranscriptIdeaBlockStatus(privateLine, blocks), "raw");
	assert.equal(getTranscriptIdeaBlockTargetId(privateLine, blocks), null);
	assert.equal(linkedLines[0]?.linkedBlockId, undefined);
	assert.equal(linkedLines[1]?.linkedBlockId, undefined);
});
