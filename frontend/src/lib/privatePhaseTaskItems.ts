export interface SortablePrivatePhaseTaskItem {
	id: number;
	priority: number;
}

export interface PrivatePhaseTaskItemActionLabelSource {
	priority?: number;
	statement: string;
}

export function sortPrivatePhaseTaskItems<T extends SortablePrivatePhaseTaskItem>(items: T[]): T[] {
	return [...items].sort((left, right) => left.priority - right.priority || left.id - right.id);
}

export function reindexPrivatePhaseTaskItems<T extends SortablePrivatePhaseTaskItem>(items: T[]): T[] {
	return sortPrivatePhaseTaskItems(items).map((item, index) => ({
		...item,
		priority: index + 1
	}));
}

export function getPrivatePhaseTaskItemActionLabel(action: string, item: PrivatePhaseTaskItemActionLabelSource, fallbackIndex: number): string {
	const priority = item.priority || fallbackIndex + 1;
	return `${action}第 ${priority} 個優先改善項目：${item.statement}`;
}
