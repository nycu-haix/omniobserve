export function normalizeRankingOwnerId(value: unknown): number | null {
	const parsed = Number(String(value ?? "").trim());
	return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isOwnedRankingItem(sourceUserIds: readonly unknown[] | null | undefined, participantId: unknown): boolean {
	const normalizedParticipantId = normalizeRankingOwnerId(participantId);
	if (normalizedParticipantId === null || !Array.isArray(sourceUserIds)) {
		return false;
	}

	return sourceUserIds.some(sourceUserId => normalizeRankingOwnerId(sourceUserId) === normalizedParticipantId);
}

export function getRankingOwnerLabel(displayName: unknown, participantId: unknown): string {
	const normalizedDisplayName = String(displayName ?? "").trim();
	if (normalizedDisplayName) {
		return normalizedDisplayName;
	}

	return `Participant ${String(participantId ?? "").trim() || "?"}`;
}
