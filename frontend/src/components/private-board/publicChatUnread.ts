import type { BoardTab, PublicChatMessage } from "../../types";

export function shouldCountPublicChatMessageUnread(message: PublicChatMessage, existingMessages: PublicChatMessage[], options: { activeTab: BoardTab; isCollapsed: boolean }): boolean {
	if ((!options.isCollapsed && options.activeTab === "public-chat") || message.isOwn || message.isDeleted) {
		return false;
	}
	return !existingMessages.some(existingMessage => existingMessage.id === message.id);
}
