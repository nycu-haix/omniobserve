import assert from "node:assert/strict";
import test from "node:test";

import { NOTIFICATION_AUTO_DISMISS_MS } from "../src/lib/notificationTiming.ts";

test("notifications auto-dismiss after ten seconds", () => {
	assert.equal(NOTIFICATION_AUTO_DISMISS_MS, 10000);
});
