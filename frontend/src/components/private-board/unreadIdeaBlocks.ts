export interface IdeaBlockUnreadCandidate {
	id: string;
	isDeleted?: boolean;
	isUnread?: boolean;
	status?: string;
}

export interface IdeaBlockUnreadState {
	count: number;
	latestBlockId: string | null;
}

export function getIdeaBlockUnreadState(blocks: IdeaBlockUnreadCandidate[]): IdeaBlockUnreadState {
	const unreadBlocks = blocks.filter(block => block.isUnread && !block.isDeleted && block.status !== "generating");
	return {
		count: unreadBlocks.length,
		latestBlockId: unreadBlocks.length > 0 ? unreadBlocks[unreadBlocks.length - 1].id : null
	};
}

export function formatUnreadCount(count: number): string {
	return count > 99 ? "99+" : String(count);
}

export function shouldShowIdeaBlockUnreadIndicator(state: IdeaBlockUnreadState, options: { isCollapsed: boolean; activeTab: "transcript" | "ideablock" | "public-chat" }): boolean {
	if (state.count <= 0) {
		return false;
	}
	return options.isCollapsed || options.activeTab !== "ideablock" || state.latestBlockId !== null;
}
