import type { BoardTab, PublicChatMessage } from "../../types";

export function shouldClearPublicChatUnreadCount(options: { activeTab: BoardTab; isCollapsed: boolean }): boolean {
	return !options.isCollapsed && options.activeTab === "public-chat";
}

export function shouldCountPublicChatMessageUnread(message: PublicChatMessage, existingMessages: PublicChatMessage[], options: { activeTab: BoardTab; isCollapsed: boolean }): boolean {
	if ((!options.isCollapsed && options.activeTab === "public-chat") || message.isOwn || message.isDeleted) {
		return false;
	}
	return !existingMessages.some(existingMessage => existingMessage.id === message.id);
}
