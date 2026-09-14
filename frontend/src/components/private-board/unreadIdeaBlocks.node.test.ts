import assert from "node:assert/strict";
import test from "node:test";

import { formatUnreadCount, getIdeaBlockUnreadState, shouldShowIdeaBlockUnreadIndicator } from "./unreadIdeaBlocks.ts";

test("tracks latest unread idea block while ignoring deleted and generating blocks", () => {
	const state = getIdeaBlockUnreadState([
		{ id: "old", isUnread: true },
		{ id: "deleted", isUnread: true, isDeleted: true },
		{ id: "pending", isUnread: true, status: "generating" },
		{ id: "latest", isUnread: true }
	]);

	assert.deepEqual(state, { count: 2, latestBlockId: "latest" });
});

test("keeps unread indicator visible outside the active idea block surface", () => {
	const state = { count: 3, latestBlockId: "latest" };

	assert.equal(shouldShowIdeaBlockUnreadIndicator(state, { isCollapsed: true, activeTab: "ideablock" }), true);
	assert.equal(shouldShowIdeaBlockUnreadIndicator(state, { isCollapsed: false, activeTab: "transcript" }), true);
	assert.equal(shouldShowIdeaBlockUnreadIndicator({ count: 0, latestBlockId: null }, { isCollapsed: true, activeTab: "public-chat" }), false);
});

test("formats large unread counts for compact badges", () => {
	assert.equal(formatUnreadCount(3), "3");
	assert.equal(formatUnreadCount(120), "99+");
});
