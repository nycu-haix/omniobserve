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

export const PUBLIC_NOW_STALE_BUDGET_MS = 10000;

export function isPublicNowStale({
	targetCount,
	stateUpdatedAtMs,
	nowMs,
	staleBudgetMs = PUBLIC_NOW_STALE_BUDGET_MS
}: {
	targetCount: number;
	stateUpdatedAtMs: number | null | undefined;
	nowMs: number;
	staleBudgetMs?: number;
}): boolean {
	return targetCount > 0 && typeof stateUpdatedAtMs === "number" && nowMs - stateUpdatedAtMs > staleBudgetMs;
}

export function formatPublicNowLatency(valueMs: number | null | undefined): string {
	if (typeof valueMs !== "number" || !Number.isFinite(valueMs)) {
		return "-";
	}
	const normalizedValue = Math.max(0, Math.round(valueMs));
	if (normalizedValue < 1000) {
		return `${normalizedValue} ms`;
	}
	if (normalizedValue < 10000) {
		return `${(normalizedValue / 1000).toFixed(1)} s`;
	}
	return `${Math.round(normalizedValue / 1000)} s`;
}
