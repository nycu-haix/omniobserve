import assert from "node:assert/strict";
import test from "node:test";

import { getLatestTranscriptIdeaBlockStatusAfterUpdate } from "../src/lib/adminLatestTranscriptStatus.ts";

test("ignores non-completion idea block updates", () => {
	assert.equal(
		getLatestTranscriptIdeaBlockStatusAfterUpdate({ transcriptSegmentId: "t2", ideaBlockStatus: "pending" }, { generationComplete: false, ideaBlockCount: 1, transcriptSegmentIds: [] }),
		"pending"
	);
});

test("ignores completion updates for an older transcript segment", () => {
	assert.equal(
		getLatestTranscriptIdeaBlockStatusAfterUpdate(
			{ transcriptSegmentId: "newer-segment", ideaBlockStatus: "pending" },
			{ generationComplete: true, ideaBlockCount: 1, transcriptSegmentIds: ["older-segment"] }
		),
		"pending"
	);
});

test("marks matching completion updates as generated or no idea", () => {
	assert.equal(
		getLatestTranscriptIdeaBlockStatusAfterUpdate(
			{ transcriptSegmentId: "segment-1", ideaBlockStatus: "pending" },
			{ generationComplete: true, ideaBlockCount: 1, transcriptSegmentIds: ["segment-1"] }
		),
		"generated"
	);
	assert.equal(
		getLatestTranscriptIdeaBlockStatusAfterUpdate(
			{ transcriptSegmentId: "segment-1", ideaBlockStatus: "pending" },
			{ generationComplete: true, ideaBlockCount: 0, transcriptSegmentIds: ["segment-1"] }
		),
		"no_idea"
	);
});
