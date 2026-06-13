export interface IdeaBlockJumpTargetCandidate {
	id?: string | number | null;
	isDeleted?: boolean;
	is_deleted?: boolean;
	status?: string | null;
}

export function isValidIdeaBlockJumpTarget(block: IdeaBlockJumpTargetCandidate | null | undefined, targetId?: string | number | null): boolean {
	if (!block || block.id == null) {
		return false;
	}

	if (targetId != null && String(block.id) !== String(targetId)) {
		return false;
	}

	if (block.isDeleted || block.is_deleted || block.status === "generating") {
		return false;
	}

	return true;
}

export function hasIdeaBlockJumpTarget(blocks: IdeaBlockJumpTargetCandidate[], targetId: string | number | null | undefined): boolean {
	if (targetId == null) {
		return false;
	}
	return blocks.some(block => isValidIdeaBlockJumpTarget(block, targetId));
}

export function getValidIdeaBlockJumpTargetIds<T extends string | number>(blocks: IdeaBlockJumpTargetCandidate[], targetIds: T[]): T[] {
	const seen = new Set<string>();
	const validIds: T[] = [];
	targetIds.forEach(targetId => {
		const key = String(targetId);
		if (seen.has(key) || !hasIdeaBlockJumpTarget(blocks, targetId)) {
			return;
		}
		seen.add(key);
		validIds.push(targetId);
	});
	return validIds;
}
