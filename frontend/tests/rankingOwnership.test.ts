import assert from "node:assert/strict";
import test from "node:test";

import { getRankingOwnerLabel, isOwnedRankingItem, normalizeRankingOwnerId } from "../src/lib/rankingOwnership.ts";

test("normalizes positive participant ids for ranking ownership", () => {
	assert.equal(normalizeRankingOwnerId("1"), 1);
	assert.equal(normalizeRankingOwnerId(2), 2);
	assert.equal(normalizeRankingOwnerId(" 3 "), 3);
	assert.equal(normalizeRankingOwnerId("admin"), null);
	assert.equal(normalizeRankingOwnerId("0"), null);
});

test("detects current participant ownership from source user ids", () => {
	assert.equal(isOwnedRankingItem([1, 2], "1"), true);
	assert.equal(isOwnedRankingItem(["2"], 2), true);
	assert.equal(isOwnedRankingItem([1, 2], "3"), false);
	assert.equal(isOwnedRankingItem(undefined, "1"), false);
	assert.equal(isOwnedRankingItem([1], "admin"), false);
});

test("formats ranking owner label from participant display name", () => {
	assert.equal(getRankingOwnerLabel("Alice", "1"), "Alice");
	assert.equal(getRankingOwnerLabel("  Alice  ", "1"), "Alice");
	assert.equal(getRankingOwnerLabel("", "2"), "Participant 2");
	assert.equal(getRankingOwnerLabel(null, null), "Participant ?");
});
