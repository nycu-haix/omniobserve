import assert from "node:assert/strict";
import test from "node:test";

import { completionTargetKeys, completionTargetSegmentIds, matchingDraftCompletionTargetKeys } from "../src/lib/audioCompletionTargets.ts";

test("builds completion target keys from transcript and client segment ids", () => {
	const message = {
		scope: "private",
		participant_id: "1",
		transcript_segment_id: 42,
		client_segment_ids: ["client-1", "client-1"]
	};

	assert.deepEqual(completionTargetSegmentIds(message), ["client-1", "42"]);
	assert.deepEqual(completionTargetKeys(message, "fallback"), ["private|1|client-1", "private|1|42"]);
});

test("matches persisted completion ids back to live draft keys", () => {
	const drafts = new Map([
		["private|1|live-1", { id: "42", source: "private", userId: "1" }],
		["private|2|live-2", { id: "42", source: "private", userId: "2" }],
		["public|1|live-1", { id: "42", source: "public", userId: "1" }]
	]);

	assert.deepEqual(
		matchingDraftCompletionTargetKeys({
			drafts,
			segmentIds: ["42"],
			source: "private",
			userId: "1"
		}),
		["private|1|live-1"]
	);
});
