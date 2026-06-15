export type ParticipantRole = "participant" | "confederate" | "observer" | "facilitator" | "test";

const PARTICIPANT_ROLES = new Set<ParticipantRole>(["participant", "confederate", "observer", "facilitator", "test"]);
const PARTICIPANT_ROLE_ALIASES = new Map<string, ParticipantRole>([
	["nonparticipant", "observer"],
	["non-participant", "observer"],
	["staff", "facilitator"],
	["moderator", "facilitator"],
	["experimenter", "facilitator"],
	["confederate-script", "confederate"],
	["manipulation", "confederate"],
	["mock", "test"],
	["mock-participant", "test"],
	["test-client", "test"]
]);
const AUDIO_TRANSCRIPTION_ROLES = new Set<ParticipantRole>(["participant", "confederate"]);

export function normalizeParticipantRole(value: unknown): ParticipantRole {
	const role = String(value || "participant")
		.trim()
		.toLowerCase()
		.replace(/_/g, "-");

	const aliasedRole = PARTICIPANT_ROLE_ALIASES.get(role) ?? role;
	return PARTICIPANT_ROLES.has(aliasedRole as ParticipantRole) ? (aliasedRole as ParticipantRole) : "participant";
}

export function isObserverRole(value: unknown): boolean {
	return normalizeParticipantRole(value) === "observer";
}

export function isParticipantAnalysisRole(value: unknown): boolean {
	return normalizeParticipantRole(value) === "participant";
}

export function isAdminRankingRole(value: unknown): boolean {
	const role = normalizeParticipantRole(value);
	return role === "participant" || role === "confederate";
}

export function isAudioTranscriptionRole(value: unknown): boolean {
	return AUDIO_TRANSCRIPTION_ROLES.has(normalizeParticipantRole(value));
}

export function isAdminParticipantId(participantId: string | number | null | undefined): boolean {
	const normalizedParticipantId = String(participantId ?? "")
		.trim()
		.toLowerCase();
	return normalizedParticipantId === "0" || normalizedParticipantId === "admin" || normalizedParticipantId.startsWith("admin-");
}

export function filterAdminPresenceRows<T extends { id: string | number | null | undefined }>(participants: T[]): T[] {
	return participants.filter(participant => !isAdminParticipantId(participant.id));
}
