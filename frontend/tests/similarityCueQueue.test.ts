import assert from "node:assert/strict";
import test from "node:test";
import { emptyCueQueue, hydrateCueQueue, respondToCue, selectCue } from "../src/lib/similarityCueQueue.ts";
import type { SimilarityPairCueData } from "../src/types/index.ts";

const cue = (id: string, blockId = id): SimilarityPairCueData => ({ id, cueId: id, blockId, blockSummary: id });
const candidates = [cue("water"), cue("mirror"), cue("food")];

test("a batch shows exactly one cue, preferring Now over arrival order", () => {
	const queue = hydrateCueQueue(emptyCueQueue(), candidates, ["mirror"], true);
	assert.equal(queue.activeId, "mirror");
	assert.equal(queue.items.length, 3);
});
test("no matching Now cue falls back to the oldest pending cue", () => {
	assert.equal(hydrateCueQueue(emptyCueQueue(), candidates, ["rope"], true).activeId, "water");
});
test("changing Now or receiving new candidates never replaces active cue", () => {
	const queue = hydrateCueQueue(emptyCueQueue(), candidates, ["mirror"], true);
	assert.equal(selectCue(queue, ["food"], true).activeId, "mirror");
	assert.equal(hydrateCueQueue(queue, [...candidates, cue("rope")], ["rope"], true).activeId, "mirror");
});
for (const response of ["accepted", "shared", "dismissed"] as const) {
	test(`${response} selects the next cue using the latest Now`, () => {
		const queue = hydrateCueQueue(emptyCueQueue(), candidates, ["mirror"], true);
		const next = respondToCue(queue, "mirror", response, ["food"], true);
		assert.equal(next.activeId, "food");
		assert.equal(next.items.find(c => c.id === "mirror")?.responseStatus, response);
	});
}
test("shown does not advance; time and rehydration do not advance", () => {
	const queue = hydrateCueQueue(emptyCueQueue(), candidates, ["mirror"], true);
	const shown = respondToCue(queue, "mirror", "shown", ["food"], true);
	assert.equal(shown.activeId, "mirror");
	assert.equal(hydrateCueQueue(shown, shown.items, ["food"], true).activeId, "mirror");
});
test("reload restores the unanswered shown cue before Now and excludes completed", () => {
	const saved = [{ ...cue("water"), responseStatus: "accepted" as const }, { ...cue("mirror"), responseStatus: "shown" as const }, cue("food")];
	assert.equal(hydrateCueQueue(emptyCueQueue(), saved, ["food"], true).activeId, "mirror");
});
test("a stale GET or shown acknowledgement cannot resurrect a completed cue", () => {
	const queue = hydrateCueQueue(emptyCueQueue(), candidates, [], true);
	const done = respondToCue(queue, "water", "dismissed", [], true);
	const stale = hydrateCueQueue(done, candidates, ["water"], true);
	assert.equal(stale.activeId, "mirror");
	assert.equal(respondToCue(stale, "water", "shown", [], true).items[0].responseStatus, "dismissed");
});
test("private/control do not select; enabling uses current Now", () => {
	const queue = hydrateCueQueue(emptyCueQueue(), candidates, [], false);
	assert.equal(queue.activeId, null);
	assert.equal(selectCue(queue, ["food"], true).activeId, "food");
});
test("same block with distinct pairs keeps both cues; duplicate event keeps one", () => {
	const queue = hydrateCueQueue(emptyCueQueue(), [cue("pair-1", "water"), cue("pair-2", "water"), cue("pair-1", "water")], [], true);
	assert.equal(queue.items.length, 2);
	assert.equal(respondToCue(queue, "pair-1", "dismissed", [], true).activeId, "pair-2");
});
test("deleted pairs disappear; an exhausted queue shows nothing", () => {
	const queue = hydrateCueQueue(emptyCueQueue(), candidates, [], true);
	assert.equal(hydrateCueQueue(queue, [], [], true).activeId, null);
	const done = candidates.map(c => ({ ...c, responseStatus: "dismissed" as const }));
	assert.equal(hydrateCueQueue(emptyCueQueue(), done, ["food"], true).activeId, null);
});
