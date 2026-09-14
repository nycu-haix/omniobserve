type DisplayableIdeaBlock = {
	status?: string;
};

export function getDisplayedIdeaBlocks<T extends DisplayableIdeaBlock>(blocks: T[]): T[] {
	let hasShownGeneratingBlock = false;

	return blocks.filter(block => {
		if (block.status !== "generating") {
			return true;
		}
		if (hasShownGeneratingBlock) {
			return false;
		}
		hasShownGeneratingBlock = true;
		return true;
	});
}
