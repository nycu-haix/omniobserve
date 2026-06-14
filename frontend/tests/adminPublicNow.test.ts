import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicNowLabel } from "../src/lib/adminPublicNow.ts";

test("admin Public NOW label keeps all active labels for long multi-item utterances", () => {
	const labels = ["指南針與地圖位置說明", "QR code 報名區塊", "活動時間與集合地點", "主辦單位聯絡方式", "回收分類提醒"];

	assert.equal(buildPublicNowLabel({ activeLabels: labels, componentIds: [], taskItemIds: [], targetCount: labels.length }), labels.join(" + "));
});

test("admin Public NOW label falls back to raw target ids", () => {
	assert.equal(buildPublicNowLabel({ activeLabels: [], componentIds: ["qr_code", "event_time"], taskItemIds: [4, 12], targetCount: 4 }), "qr_code + event_time + 4 + 12");
});

test("admin Public NOW label describes empty state", () => {
	assert.equal(buildPublicNowLabel({ activeLabels: [], componentIds: [], taskItemIds: [], targetCount: 0 }), "尚未指定");
});
