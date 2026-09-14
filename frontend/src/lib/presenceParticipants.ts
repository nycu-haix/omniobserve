import { filterAdminPresenceRows, isAudioTranscriptionRole, normalizeParticipantRole, type ParticipantRole } from "./participantRoles.ts";

export interface ParticipantPresence {
	id: string;
	participant_role: ParticipantRole;
	transcription_enabled: boolean;
	mic_mode: "off" | "public" | "private" | string;
	audio_connected: boolean;
	is_speaking?: boolean;
	display_name?: string | null;
	client_id?: string | null;
	updated_at?: string | null;
}

function normalizePresenceParticipant(item: unknown): ParticipantPresence | null {
	if (typeof item === "string") {
		return {
			id: item,
			participant_role: normalizeParticipantRole(item),
			transcription_enabled: isAudioTranscriptionRole(item),
			mic_mode: "off",
			audio_connected: false
		};
	}

	if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string") {
		return null;
	}

	const participant = item as Record<string, unknown>;
	const participantRole = normalizeParticipantRole(participant.participant_role ?? participant.id);
	return {
		id: item.id,
		participant_role: participantRole,
		transcription_enabled: typeof participant.transcription_enabled === "boolean" ? participant.transcription_enabled : isAudioTranscriptionRole(participantRole),
		mic_mode: typeof participant.mic_mode === "string" ? participant.mic_mode : "off",
		audio_connected: typeof participant.audio_connected === "boolean" ? participant.audio_connected : false,
		is_speaking: typeof participant.is_speaking === "boolean" ? participant.is_speaking : false,
		display_name: typeof participant.display_name === "string" ? participant.display_name : null,
		client_id: typeof participant.client_id === "string" ? participant.client_id : null,
		updated_at: typeof participant.updated_at === "string" ? participant.updated_at : null
	};
}

export function normalizePresenceParticipantsPayload(payload: { participants?: unknown; participant_ids?: unknown }, options: { includeAdmin?: boolean } = {}): ParticipantPresence[] {
	const includeAdmin = options.includeAdmin ?? true;
	const rawParticipants = Array.isArray(payload.participants) ? payload.participants : Array.isArray(payload.participant_ids) ? payload.participant_ids : [];
	const participants = rawParticipants.map(normalizePresenceParticipant).filter((item): item is ParticipantPresence => item !== null);
	return includeAdmin ? participants : filterAdminPresenceRows(participants);
}

export function normalizePresenceParticipantIdsPayload(payload: { participants?: unknown; participant_ids?: unknown }, options: { includeAdmin?: boolean } = {}): string[] {
	const includeAdmin = options.includeAdmin ?? true;
	if (Array.isArray(payload.participant_ids)) {
		const participants = payload.participant_ids.map(normalizePresenceParticipant).filter((item): item is ParticipantPresence => item !== null);
		const filteredParticipants = includeAdmin ? participants : filterAdminPresenceRows(participants);
		return filteredParticipants.map(participant => participant.id);
	}

	return normalizePresenceParticipantsPayload(payload, options).map(participant => participant.id);
}

export function getParticipantTranscriptionEnabled(participants: ParticipantPresence[], participantId: string | number | null | undefined): boolean | undefined {
	const normalizedParticipantId = String(participantId ?? "").trim();
	if (!normalizedParticipantId) {
		return undefined;
	}
	return participants.find(participant => participant.id === normalizedParticipantId)?.transcription_enabled;
}
