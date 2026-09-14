import assert from "node:assert/strict";
import test from "node:test";

import { getRankingComponentGroups } from "../src/lib/rankingComponentGroups.ts";

test("groups ranking items by poster component metadata for scanning", () => {
	const groups = getRankingComponentGroups([
		{ id: "item-1", componentId: "qr_code", componentLabel: "QR 碼" },
		{ id: "item-2", componentId: "main_title", componentLabel: "主標題" },
		{ id: "item-3", componentId: "qr_code", componentLabel: "QR 碼" },
		{ id: "item-4", componentId: "activity_icon1", componentLabel: "活動圖示1" },
		{ id: "item-5", componentId: "main_title", componentLabel: "主標題" },
		{ id: "item-6", componentId: "background", componentLabel: "背景圖／底色" }
	]);

	assert.deepEqual(groups, [
		{ id: "qr_code", label: "QR 碼", itemIds: ["item-1", "item-3"], count: 2 },
		{ id: "main_title", label: "主標題", itemIds: ["item-2", "item-5"], count: 2 },
		{ id: "activity_icon1", label: "活動圖示1", itemIds: ["item-4"], count: 1 },
		{ id: "background", label: "背景圖／底色", itemIds: ["item-6"], count: 1 }
	]);
});

test("ignores ranking items without component metadata", () => {
	assert.deepEqual(getRankingComponentGroups([{ id: "lost-at-sea-1" }, { id: "poster-1", componentId: "qr_code", componentLabel: "QR 碼" }]), [
		{ id: "qr_code", label: "QR 碼", itemIds: ["poster-1"], count: 1 }
	]);
});
