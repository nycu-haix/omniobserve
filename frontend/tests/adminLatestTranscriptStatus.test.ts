import assert from "node:assert/strict";
import test from "node:test";

import { getInitialLatestTranscriptIdeaBlockStatus, getLatestTranscriptIdeaBlockStatusAfterUpdate, latestTranscriptMatchesSegmentIds } from "../src/lib/adminLatestTranscriptStatus.ts";

test("marks only persisted private transcripts as initially pending", () => {
	assert.equal(getInitialLatestTranscriptIdeaBlockStatus({ scope: "private", persisted: true }), "pending");
	assert.equal(getInitialLatestTranscriptIdeaBlockStatus({ scope: "private", persisted: false }), "captured");
	assert.equal(getInitialLatestTranscriptIdeaBlockStatus({ scope: "public", persisted: true }), "captured");
});

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

test("matches terminal updates only to their transcript segment when ids are present", () => {
	assert.equal(latestTranscriptMatchesSegmentIds({ transcriptSegmentId: "segment-2", ideaBlockStatus: "pending" }, ["segment-1"]), false);
	assert.equal(latestTranscriptMatchesSegmentIds({ transcriptSegmentId: "segment-2", ideaBlockStatus: "pending" }, ["segment-2"]), true);
	assert.equal(latestTranscriptMatchesSegmentIds({ transcriptSegmentId: "segment-2", ideaBlockStatus: "pending" }, []), true);
	assert.equal(latestTranscriptMatchesSegmentIds({ transcriptSegmentId: null, ideaBlockStatus: "pending" }, ["segment-1"]), false);
	assert.equal(latestTranscriptMatchesSegmentIds({ transcriptSegmentId: null, ideaBlockStatus: "pending" }, []), true);
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

test("keeps live latest transcript pending when identified completion belongs to another segment", () => {
	assert.equal(
		getLatestTranscriptIdeaBlockStatusAfterUpdate(
			{ transcriptSegmentId: null, ideaBlockStatus: "pending" },
			{ generationComplete: true, ideaBlockCount: 1, transcriptSegmentIds: ["persisted-segment"] }
		),
		"pending"
	);
});
