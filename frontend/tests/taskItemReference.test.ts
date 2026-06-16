import assert from "node:assert/strict";
import test from "node:test";

import {
	getActionDetailHint,
	getActionReferenceDescription,
	getComponentReferenceCategoryLabel,
	getComponentReferenceDescription,
	getComponentReferenceMeta,
	getTaskReferenceLabel,
	groupComponentReferenceOptions,
	isBackgroundReferenceOption
} from "../src/lib/taskItemReference.ts";

test("builds compact reference labels and descriptions from task metadata", () => {
	assert.equal(getTaskReferenceLabel({ id: "qr_code", label_zh: "QR 碼", label_en: "QR code" }), "QR 碼");
	assert.equal(getComponentReferenceDescription({ id: "qr_code", label_zh: "QR 碼", label_en: "QR code", description_zh: "報名 QR code 圖像本身。" }), "報名 QR code 圖像本身。");
	assert.equal(getComponentReferenceDescription({ id: "unknown", label_zh: "未知", label_en: "Unknown" }), "Unknown");
});

test("marks poster background options with participant-facing category metadata", () => {
	const background = { id: "background", label_zh: "背景圖／底色", label_en: "Background image/color", category: "background" };

	assert.equal(isBackgroundReferenceOption(background), true);
	assert.equal(getComponentReferenceCategoryLabel(background), "背景/底色");
	assert.equal(getComponentReferenceMeta(background), "背景類元件，只提供改顏色與透明度。");
	assert.equal(getComponentReferenceCategoryLabel({ id: "main_title", label_zh: "主標題" }), "標題與說明");
	assert.equal(getComponentReferenceMeta({ id: "qr_code", label_zh: "QR 碼" }), "分類：報名資訊");
});

test("groups poster component options into participant-facing sections", () => {
	const groups = groupComponentReferenceOptions([
		{ id: "main_title", label_zh: "主標題" },
		{ id: "qr_code", label_zh: "QR 碼" },
		{ id: "activity_icon1", label_zh: "活動圖示1" },
		{ id: "organizer_list", label_zh: "主辦單位" },
		{ id: "background", label_zh: "背景圖／底色", category: "background" },
		{ id: "custom_component", label_zh: "自訂元件" }
	]);

	assert.deepEqual(
		groups.map(group => [group.id, group.label, group.items.map(item => item.id)]),
		[
			["title-copy", "標題與說明", ["main_title"]],
			["signup", "報名資訊", ["qr_code"]],
			["visuals", "圖像與圖示", ["activity_icon1"]],
			["footer", "下方資訊", ["organizer_list"]],
			["background", "背景/底色", ["background"]],
			["other", "其他元件", ["custom_component"]]
		]
	);
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
