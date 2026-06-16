import assert from "node:assert/strict";
import test from "node:test";

import { getRankingInteractionState } from "../src/lib/rankingPhasePermissions.ts";

test("public ranking is editable only in Public phase", () => {
	assert.equal(getRankingInteractionState("public", "group"), "editable");
	assert.equal(getRankingInteractionState("public", "reflect"), "readonly");
	assert.equal(getRankingInteractionState("public", "private"), "hidden");
	assert.equal(getRankingInteractionState("public", "private_phase_1"), "hidden");
	assert.equal(getRankingInteractionState("public", "private_phase_2"), "hidden");
});

test("private ranking remains editable in Reflect phase", () => {
	assert.equal(getRankingInteractionState("private", "reflect"), "editable");
	assert.equal(getRankingInteractionState("private", "group"), "editable");
});

test("phase-one task builder hides private ranking until ranking phase", () => {
	assert.equal(getRankingInteractionState("private", "private_phase_1", true), "hidden");
	assert.equal(getRankingInteractionState("private", "private_phase_1", false), "editable");
});
