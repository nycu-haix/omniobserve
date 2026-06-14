import assert from "node:assert/strict";
import test from "node:test";

import { shouldClearPublicChatUnreadCount, shouldCountPublicChatMessageUnread } from "../src/components/private-board/publicChatUnread.ts";
import { buildIdeaBlockChatMessage, parseIdeaBlockChatMessage } from "../src/lib/chatMessages.ts";
import type { PublicChatMessage } from "../src/types/index.ts";

function chatMessage(overrides: Partial<PublicChatMessage> = {}): PublicChatMessage {
	return {
		id: "message-1",
		userId: "2",
		message: "hello",
		...overrides
	};
}

test("counts incoming shared idea block chat messages as unread outside the chat tab", () => {
	const message = chatMessage({
		message: buildIdeaBlockChatMessage({
			summary: "加入 QR code",
			aiSummary: "把 QR code 放到報名區塊旁邊"
		})
	});

	assert.notEqual(parseIdeaBlockChatMessage(message.message), null);
	assert.equal(shouldCountPublicChatMessageUnread(message, [], { activeTab: "ideablock", isCollapsed: false }), true);
	assert.equal(shouldCountPublicChatMessageUnread(message, [], { activeTab: "transcript", isCollapsed: false }), true);
	assert.equal(shouldCountPublicChatMessageUnread(message, [], { activeTab: "public-chat", isCollapsed: true }), true);
});

test("does not count visible, own, deleted, or already-seen chat messages as unread", () => {
	const message = chatMessage({ message: buildIdeaBlockChatMessage({ summary: "補充活動時間" }) });

	assert.equal(shouldCountPublicChatMessageUnread(message, [], { activeTab: "public-chat", isCollapsed: false }), false);
	assert.equal(shouldCountPublicChatMessageUnread({ ...message, isOwn: true }, [], { activeTab: "ideablock", isCollapsed: false }), false);
	assert.equal(shouldCountPublicChatMessageUnread({ ...message, isDeleted: true }, [], { activeTab: "ideablock", isCollapsed: false }), false);
	assert.equal(shouldCountPublicChatMessageUnread(message, [message], { activeTab: "ideablock", isCollapsed: false }), false);
});

test("clears chat unread count when reopening to a visible chat tab", () => {
	assert.equal(shouldClearPublicChatUnreadCount({ activeTab: "public-chat", isCollapsed: false }), true);
	assert.equal(shouldClearPublicChatUnreadCount({ activeTab: "public-chat", isCollapsed: true }), false);
	assert.equal(shouldClearPublicChatUnreadCount({ activeTab: "ideablock", isCollapsed: false }), false);
});
