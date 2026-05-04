import { getDefaultRoomName } from "../lib/defaultRoomName";
import { apiUrl } from "./api";

export async function fetchSessionParticipants(sessionName: string, signal?: AbortSignal) {
	const normalizedSessionName = sessionName.trim() || getDefaultRoomName();
	const response = await fetch(apiUrl(`/api/sessions/${encodeURIComponent(normalizedSessionName)}/presence`), { signal });

	if (!response.ok) {
		throw new Error("Failed to fetch session presence.");
	}

	const payload = (await response.json()) as { participants?: unknown };
	return Array.isArray(payload.participants) ? payload.participants.filter((item): item is string => typeof item === "string") : [];
}
