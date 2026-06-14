export interface SimilarityCueLifecycleItem {
	id?: string;
	kind?: string;
}

export function isSimilarityCueDisplayPhase(phase: unknown): boolean {
	return phase === "group" || phase === "reflect";
}

export function canShareSimilarityReasonInPhase(phase: unknown): boolean {
	return isSimilarityCueDisplayPhase(phase);
}

export function getSimilarityPairCues<T extends SimilarityCueLifecycleItem>(cues: T[]): T[] {
	return cues.filter(cue => cue.kind !== "phase-transition-summary");
}

export function removeSimilarityPairCues<T extends SimilarityCueLifecycleItem>(cues: T[]): T[] {
	return cues.filter(cue => cue.kind === "phase-transition-summary");
}

export function shouldAutoDismissSimilarityCue(cue: SimilarityCueLifecycleItem): boolean {
	return cue.kind === "phase-transition-summary";
}
