export function buildPublicNowLabel({ activeLabels, componentIds, taskItemIds, targetCount }: { activeLabels: string[]; componentIds: string[]; taskItemIds: number[]; targetCount: number }): string {
	const labels = activeLabels.map(label => label.trim()).filter(Boolean);
	if (labels.length > 0) {
		return labels.join(" + ");
	}
	if (targetCount > 0) {
		return [...componentIds, ...taskItemIds.map(String)].join(" + ");
	}
	return "尚未指定";
}
