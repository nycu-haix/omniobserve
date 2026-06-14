export interface SimilarityCueLifecycleItem {
	id?: string;
	kind?: string;
}

export function isSimilarityCueDisplayPhase(phase: unknown): boolean {
	return phase === "group" || phase === "reflect";
}

export function shouldAutoDismissSimilarityCue(cue: SimilarityCueLifecycleItem): boolean {
	return cue.kind === "phase-transition-summary";
}
