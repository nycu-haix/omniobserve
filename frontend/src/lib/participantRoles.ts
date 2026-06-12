export type ParticipantRole = "participant" | "observer";

const OBSERVER_ROLE_ALIASES = new Set(["observer", "nonparticipant", "non-participant", "facilitator"]);

export function normalizeParticipantRole(value: unknown): ParticipantRole {
	const role = String(value || "participant")
		.trim()
		.toLowerCase()
		.replace(/_/g, "-");

	return OBSERVER_ROLE_ALIASES.has(role) ? "observer" : "participant";
}

export function isObserverRole(value: unknown): boolean {
	return normalizeParticipantRole(value) === "observer";
}

export function isParticipantAnalysisRole(value: unknown): boolean {
	return !isObserverRole(value);
}
