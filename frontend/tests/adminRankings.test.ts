import assert from "node:assert/strict";
import test from "node:test";

import { getAdminRankingDisplayItemIds, getAdminRankingRowCount } from "../src/lib/adminRankings.ts";

const defaultItemIds = Array.from({ length: 15 }, (_, index) => `item-${index + 1}`);

test("limits admin ranking display items to the snapshot change count", () => {
	const items = getAdminRankingDisplayItemIds({ items: defaultItemIds, change_count: 10 }, defaultItemIds);

	assert.deepEqual(items, defaultItemIds.slice(0, 10));
	assert.equal(items.includes("item-11"), false);
});

test("preserves all normalized ranking items when no cutoff is supplied", () => {
	const items = getAdminRankingDisplayItemIds({ items: ["item-3", "item-1"] }, defaultItemIds);

	assert.deepEqual(items, ["item-3", "item-1", ...defaultItemIds.filter(id => id !== "item-3" && id !== "item-1")]);
});

test("normalizes ranking ids before applying the admin cutoff", () => {
	const items = getAdminRankingDisplayItemIds({ items: ["item-3", "item-1", "item-3", "invalid", "item-12", "item-11"], change_count: 3 }, defaultItemIds);

	assert.deepEqual(items, ["item-3", "item-1", "item-12"]);
});

test("uses the longest cutoff-aware ranking length for admin table rows", () => {
	assert.equal(getAdminRankingRowCount(defaultItemIds.slice(0, 8), [defaultItemIds.slice(0, 10)]), 10);
	assert.equal(getAdminRankingRowCount(defaultItemIds.slice(0, 10), [defaultItemIds.slice(0, 6), defaultItemIds.slice(0, 9)]), 10);
	assert.equal(getAdminRankingRowCount([], [[]]), 0);
});
