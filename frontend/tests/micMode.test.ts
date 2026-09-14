import assert from "node:assert/strict";
import test from "node:test";

import { getNextMicModeAfterPublicActivation } from "../src/lib/micMode.ts";

test("public-speaking activation switches private mode to public", () => {
	assert.equal(getNextMicModeAfterPublicActivation("private"), "public");
});

test("public-speaking activation switches active public mode back to private", () => {
	assert.equal(getNextMicModeAfterPublicActivation("public"), "private");
});
