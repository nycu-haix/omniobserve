import assert from "node:assert/strict";
import test from "node:test";

import { buildPublicNowLabel, computePublicNowAgeMs, formatPublicNowLatency, isPublicNowStale } from "../src/lib/adminPublicNow.ts";

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

test("admin Public NOW stale state requires an active target", () => {
	assert.equal(isPublicNowStale({ targetCount: 1, ageMs: 10001, staleBudgetMs: 10000 }), true);
	assert.equal(isPublicNowStale({ targetCount: 1, ageMs: 9999, staleBudgetMs: 10000 }), false);
	assert.equal(isPublicNowStale({ targetCount: 0, ageMs: 10001, staleBudgetMs: 10000 }), false);
	assert.equal(isPublicNowStale({ targetCount: 1, ageMs: null, staleBudgetMs: 10000 }), false);
});

test("admin Public NOW age advances server elapsed time with local receipt elapsed time", () => {
	assert.equal(computePublicNowAgeMs({ stateUpdatedAtMs: 100000, adminBroadcastAtMs: 102000, receivedAtMs: 500000, nowMs: 503000 }), 5000);
	assert.equal(computePublicNowAgeMs({ stateUpdatedAtMs: 100000, adminBroadcastAtMs: 102000, receivedAtMs: 500000, nowMs: 499000 }), 2000);
	assert.equal(computePublicNowAgeMs({ stateUpdatedAtMs: 100000, nowMs: 112000 }), 12000);
	assert.equal(computePublicNowAgeMs({ stateUpdatedAtMs: null, adminBroadcastAtMs: 102000, receivedAtMs: 500000, nowMs: 503000 }), null);
});

test("admin Public NOW latency formatter keeps compact live-monitoring units", () => {
	assert.equal(formatPublicNowLatency(480), "480 ms");
	assert.equal(formatPublicNowLatency(1580), "1.6 s");
	assert.equal(formatPublicNowLatency(12600), "13 s");
	assert.equal(formatPublicNowLatency(null), "-");
});
