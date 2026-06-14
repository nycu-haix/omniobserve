import assert from "node:assert/strict";
import test from "node:test";
import { canShareSimilarityReasonInPhase, getSimilarityPairCues, isSimilarityCueDisplayPhase, removeSimilarityPairCues, shouldAutoDismissSimilarityCue } from "../src/lib/similarityCueLifecycle.ts";

test("similarity cues stay visible through public and reflect phases", () => {
	assert.equal(isSimilarityCueDisplayPhase("group"), true);
	assert.equal(isSimilarityCueDisplayPhase("reflect"), true);
	assert.equal(isSimilarityCueDisplayPhase("private"), false);
	assert.equal(isSimilarityCueDisplayPhase("private_phase_1"), false);
	assert.equal(isSimilarityCueDisplayPhase("private_phase_2"), false);
});

test("similarity reason sharing remains available while cues are visible", () => {
	assert.equal(canShareSimilarityReasonInPhase("group"), true);
	assert.equal(canShareSimilarityReasonInPhase("reflect"), true);
	assert.equal(canShareSimilarityReasonInPhase("private"), false);
});

test("only transition summaries auto-dismiss similarity cues", () => {
	assert.equal(shouldAutoDismissSimilarityCue({ id: "pair-1", kind: "pair" }), false);
	assert.equal(shouldAutoDismissSimilarityCue({ id: "legacy-pair" }), false);
	assert.equal(shouldAutoDismissSimilarityCue({ id: "summary-1", kind: "phase-transition-summary" }), true);
});

test("leaving cue display phases removes pair cues before the next transition summary", () => {
	const cues = [{ id: "pair-1", kind: "pair" }, { id: "legacy-pair" }, { id: "summary-1", kind: "phase-transition-summary" }];
	assert.deepEqual(getSimilarityPairCues(cues), [{ id: "pair-1", kind: "pair" }, { id: "legacy-pair" }]);
	assert.deepEqual(removeSimilarityPairCues(cues), [{ id: "summary-1", kind: "phase-transition-summary" }]);
});
