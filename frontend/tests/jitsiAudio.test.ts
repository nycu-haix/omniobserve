import assert from "node:assert/strict";
import test from "node:test";

import { getJitsiNoiseSuppressionCommandConfig, JITSI_NOISE_SUPPRESSION_ENABLED } from "../src/lib/jitsiAudio.ts";

test("Jitsi noise suppression is enabled by default", () => {
	assert.equal(JITSI_NOISE_SUPPRESSION_ENABLED, true);
	assert.deepEqual(getJitsiNoiseSuppressionCommandConfig(), { enabled: true });
});
