import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskReferenceImageSrc } from "../src/lib/taskReferenceImage.ts";

test("task reference image retry preserves existing query params", () => {
	assert.equal(buildTaskReferenceImageSrc("/task-assets/poster.png?v=20260613-main", 2), "/task-assets/poster.png?v=20260613-main&_retry=2");
});

test("task reference image retry preserves hash fragments", () => {
	assert.equal(buildTaskReferenceImageSrc("/task-assets/poster.png#page-3", 1), "/task-assets/poster.png?_retry=1#page-3");
});

test("task reference image retry supports absolute URLs", () => {
	assert.equal(buildTaskReferenceImageSrc("https://sky.omni.elvismao.com/task-assets/poster.png?v=old", 3), "https://sky.omni.elvismao.com/task-assets/poster.png?v=old&_retry=3");
});

test("task reference image retry leaves initial image URLs unchanged", () => {
	assert.equal(buildTaskReferenceImageSrc("/task-assets/poster.png?v=20260613-main", 0), "/task-assets/poster.png?v=20260613-main");
	assert.equal(buildTaskReferenceImageSrc("", 1), "");
});
