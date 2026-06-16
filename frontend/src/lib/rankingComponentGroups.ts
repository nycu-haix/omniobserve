export interface RankingComponentGroupItem {
	id: string;
	componentId?: string | null;
	componentLabel?: string | null;
}

export interface RankingComponentGroup {
	id: string;
	label: string;
	itemIds: string[];
	count: number;
}

function normalizeText(value: string | null | undefined): string {
	return value?.trim() ?? "";
}

export function getRankingComponentGroups(items: RankingComponentGroupItem[]): RankingComponentGroup[] {
	const groups = new Map<string, RankingComponentGroup>();

	for (const item of items) {
		const label = normalizeText(item.componentLabel);
		const componentId = normalizeText(item.componentId);
		if (!label && !componentId) {
			continue;
		}

		const groupId = componentId || label;
		const currentGroup = groups.get(groupId);
		if (currentGroup) {
			currentGroup.itemIds.push(item.id);
			currentGroup.count += 1;
		} else {
			groups.set(groupId, {
				id: groupId,
				label: label || componentId,
				itemIds: [item.id],
				count: 1
			});
		}
	}

	return Array.from(groups.values());
}
