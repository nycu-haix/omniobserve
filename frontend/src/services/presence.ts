import { getDefaultRoomName } from "../lib/defaultRoomName";
import { normalizeParticipantRole, type ParticipantRole } from "../lib/participantRoles";
import { apiUrl } from "./api";

export interface ParticipantPresence {
	id: string;
	participant_role: ParticipantRole;
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
			participant_role: "participant",
			mic_mode: "off",
			audio_connected: false
		};
	}

	if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string") {
		return null;
	}

	const participant = item as Record<string, unknown>;
	return {
		id: item.id,
		participant_role: normalizeParticipantRole(participant.participant_role),
		mic_mode: typeof participant.mic_mode === "string" ? participant.mic_mode : "off",
		audio_connected: typeof participant.audio_connected === "boolean" ? participant.audio_connected : false,
		is_speaking: typeof participant.is_speaking === "boolean" ? participant.is_speaking : false,
		display_name: typeof participant.display_name === "string" ? participant.display_name : null,
		client_id: typeof participant.client_id === "string" ? participant.client_id : null,
		updated_at: typeof participant.updated_at === "string" ? participant.updated_at : null
	};
}

export async function fetchSessionPresence(sessionName: string, signal?: AbortSignal): Promise<ParticipantPresence[]> {
	const normalizedSessionName = sessionName.trim() || getDefaultRoomName();
	const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(normalizedSessionName)}/presence`), { signal });

	if (!response.ok) {
		throw new Error("Failed to fetch session presence.");
	}

	const payload = (await response.json()) as { participants?: unknown; participant_ids?: unknown };
	if (Array.isArray(payload.participants)) {
		return payload.participants.map(normalizePresenceParticipant).filter((item): item is ParticipantPresence => item !== null);
	}

	return Array.isArray(payload.participant_ids) ? payload.participant_ids.map(normalizePresenceParticipant).filter((item): item is ParticipantPresence => item !== null) : [];
}

export async function fetchSessionParticipants(sessionName: string, signal?: AbortSignal) {
	const participants = await fetchSessionPresence(sessionName, signal);
	return participants.map(participant => participant.id);
}
