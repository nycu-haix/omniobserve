import assert from "node:assert/strict";
import test from "node:test";

import { getPrivatePhaseTaskItemActionLabel, reindexPrivatePhaseTaskItems, sortPrivatePhaseTaskItems } from "../src/lib/privatePhaseTaskItems.ts";

test("sorts and reindexes private phase task items by priority and id", () => {
	const items = [
		{ id: 5, priority: 3, statement: "third" },
		{ id: 3, priority: 1, statement: "first" },
		{ id: 4, priority: 1, statement: "second" }
	];

	assert.deepEqual(
		sortPrivatePhaseTaskItems(items).map(item => item.id),
		[3, 4, 5]
	);
	assert.deepEqual(
		reindexPrivatePhaseTaskItems(items).map(item => ({ id: item.id, priority: item.priority })),
		[
			{ id: 3, priority: 1 },
			{ id: 4, priority: 2 },
			{ id: 5, priority: 3 }
		]
	);
});

test("labels private phase task item row actions with item identity", () => {
	assert.equal(getPrivatePhaseTaskItemActionLabel("刪除", { priority: 7, statement: "調整「背景」透明度" }, 0), "刪除第 7 個優先改善項目：調整「背景」透明度");
	assert.equal(getPrivatePhaseTaskItemActionLabel("編輯", { statement: "放大「副標題」" }, 1), "編輯第 2 個優先改善項目：放大「副標題」");
});
