import { getDefaultRoomName } from "../lib/defaultRoomName";
import { normalizePresenceParticipantIdsPayload, normalizePresenceParticipantsPayload, type ParticipantPresence } from "../lib/presenceParticipants";
import { apiUrl } from "./api";

export { normalizePresenceParticipantsPayload, type ParticipantPresence } from "../lib/presenceParticipants";

export async function fetchSessionPresence(sessionName: string, signal?: AbortSignal): Promise<ParticipantPresence[]> {
	const normalizedSessionName = sessionName.trim() || getDefaultRoomName();
	const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(normalizedSessionName)}/presence`), { signal });

	if (!response.ok) {
		throw new Error("Failed to fetch session presence.");
	}

	const payload = (await response.json()) as { participants?: unknown; participant_ids?: unknown };
	return normalizePresenceParticipantsPayload(payload);
}

export async function fetchSessionParticipants(sessionName: string, signal?: AbortSignal) {
	const normalizedSessionName = sessionName.trim() || getDefaultRoomName();
	const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(normalizedSessionName)}/presence`), { signal });

	if (!response.ok) {
		throw new Error("Failed to fetch session presence.");
	}

	const payload = (await response.json()) as { participants?: unknown; participant_ids?: unknown };
	return normalizePresenceParticipantIdsPayload(payload);
}
