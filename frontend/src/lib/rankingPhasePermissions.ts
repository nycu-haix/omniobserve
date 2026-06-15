import { isGroupPhase, isPrivatePhase1, isReflectPhase, type SessionPhase } from "./sessionPhase.ts";

export type RankingScope = "public" | "private";
export type RankingInteractionState = "editable" | "readonly" | "hidden";

export function getRankingInteractionState(scope: RankingScope, phase: SessionPhase, phase1BuilderEnabled = false): RankingInteractionState {
	if (scope === "public") {
		if (isGroupPhase(phase)) {
			return "editable";
		}
		return isReflectPhase(phase) ? "readonly" : "hidden";
	}

	if (isPrivatePhase1(phase) && phase1BuilderEnabled) {
		return "hidden";
	}

	return "editable";
}
