export interface AdminRankingSnapshotLike {
	items: string[];
	change_count?: number;
}

function normalizeRankingItemIds(itemIds: string[], defaultItemIds: string[]) {
	const validIds = new Set(defaultItemIds);
	const rankedValidIds = itemIds.filter((id, index) => validIds.has(id) && itemIds.indexOf(id) === index);
	const missingIds = defaultItemIds.filter(id => !rankedValidIds.includes(id));

	return [...rankedValidIds, ...missingIds];
}

function normalizeAdminRankingChangeCount(value: number | undefined, itemCount: number) {
	if (value === undefined || !Number.isFinite(value)) {
		return null;
	}
	return Math.max(0, Math.min(Math.trunc(value), itemCount));
}

export function getAdminRankingDisplayItemIds(snapshot: AdminRankingSnapshotLike, defaultItemIds: string[]) {
	const normalizedItems = normalizeRankingItemIds(snapshot.items, defaultItemIds);
	const changeCount = normalizeAdminRankingChangeCount(snapshot.change_count, normalizedItems.length);
	return changeCount === null ? normalizedItems : normalizedItems.slice(0, changeCount);
}

export function getAdminRankingRowCount(publicItems: string[], privateItemsByParticipant: string[][]) {
	return Math.max(publicItems.length, ...privateItemsByParticipant.map(items => items.length));
}
