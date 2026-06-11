export type SessionPhase = "private" | "private_phase_1" | "private_phase_2" | "group" | "reflect";

export interface SessionPhaseOption {
	id: SessionPhase;
	label: string;
}

export const DEFAULT_SESSION_PHASE: SessionPhase = "private";
export const DEFAULT_SESSION_PHASE_OPTIONS: SessionPhaseOption[] = [
	{ id: "private", label: "Private Phase" },
	{ id: "group", label: "Public Phase" }
];

export function normalizeSessionPhase(value: unknown): SessionPhase | null {
	if (typeof value !== "string") {
		return null;
	}

	const phase = value
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	if (phase === "private") {
		return "private";
	}
	if (phase === "private_1" || phase === "private_phase_1") {
		return "private_phase_1";
	}
	if (phase === "private_2" || phase === "private_phase_2") {
		return "private_phase_2";
	}
	if (phase === "group" || phase === "group_phase" || phase === "public" || phase === "public_phase") {
		return "group";
	}
	if (phase === "reflect" || phase === "reflect_phase" || phase === "reflection" || phase === "reflection_phase") {
		return "reflect";
	}
	return null;
}

export function normalizeSessionPhaseOptions(phases: Array<{ id?: unknown; label?: unknown }> | undefined): SessionPhaseOption[] {
	const normalizedPhases =
		phases
			?.map(phase => {
				const id = normalizeSessionPhase(phase.id);
				if (!id) {
					return null;
				}
				return {
					id,
					label: typeof phase.label === "string" && phase.label.trim() ? phase.label.trim() : getSessionPhaseLabel(id)
				};
			})
			.filter((phase): phase is SessionPhaseOption => phase !== null) ?? [];

	const uniquePhases = normalizedPhases.filter((phase, index) => normalizedPhases.findIndex(item => item.id === phase.id) === index);
	return uniquePhases.length > 0 ? uniquePhases : DEFAULT_SESSION_PHASE_OPTIONS;
}

export function getSessionPhaseLabel(phase: SessionPhase, phases?: SessionPhaseOption[]): string {
	const phaseOption = phases?.find(item => item.id === phase);
	if (phaseOption) {
		return phaseOption.label;
	}
	if (phase === "private") {
		return "Private Phase";
	}
	if (phase === "private_phase_1") {
		return "Private Phase 1";
	}
	if (phase === "private_phase_2") {
		return "Private Phase 2";
	}
	if (phase === "reflect") {
		return "Reflect Phase";
	}
	return "Public Phase";
}

export function isGroupPhase(phase: SessionPhase): boolean {
	return phase === "group";
}

export function isPrivatePhase1(phase: SessionPhase): boolean {
	return phase === "private_phase_1";
}

export function isPrivatePhase2(phase: SessionPhase): boolean {
	return phase === "private_phase_2";
}

export function isReflectPhase(phase: SessionPhase): boolean {
	return phase === "reflect";
}
