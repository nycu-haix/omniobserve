import assert from "node:assert/strict";
import test from "node:test";

import { getActionDetailHint, getActionReferenceDescription, getComponentReferenceDescription, getTaskReferenceLabel } from "../src/lib/taskItemReference.ts";

test("builds compact reference labels and descriptions from task metadata", () => {
	assert.equal(getTaskReferenceLabel({ id: "qr_code", label_zh: "QR 碼", label_en: "QR code" }), "QR 碼");
	assert.equal(getComponentReferenceDescription({ id: "qr_code", label_zh: "QR 碼", label_en: "QR code", description_zh: "報名 QR code 圖像本身。" }), "報名 QR code 圖像本身。");
	assert.equal(getComponentReferenceDescription({ id: "unknown", label_zh: "未知", label_en: "Unknown" }), "Unknown");
});

test("uses action descriptions, templates, and detail hints", () => {
	assert.equal(getActionReferenceDescription({ id: "custom_detail", label_zh: "自訂動作", description_zh: "用自己的文字描述要怎麼調整這個元件。" }), "用自己的文字描述要怎麼調整這個元件。");
	assert.equal(getActionReferenceDescription({ id: "enlarge", label_zh: "放大", template_zh: "放大「{component}」" }), "範例：放大「{component}」");
	assert.equal(
		getActionDetailHint({
			id: "replace_image_library",
			label_zh: "替換成圖片",
			requires_detail: true,
			detail_input: { label_zh: "圖片編號", placeholder_zh: "例如：2" }
		}),
		"圖片編號：例如：2"
	);
});
