import { getDefaultRoomName } from "../lib/defaultRoomName";
import { getDefaultParticipantName } from "../lib/participantDefaults";

function normalizeRoomName(roomName: string | null): string {
	const fallbackRoomName = getDefaultRoomName();
	const normalized = roomName?.trim().replace(/^["']|["']$/g, "");
	return normalized || fallbackRoomName;
}

export function useParticipantIdentity() {
	const params = new URLSearchParams(window.location.search);
	const participantId = params.get("id") ?? "1";
	const roomName = normalizeRoomName(params.get("room_name"));
	const customDisplayName = params.get("name")?.trim();
	const displayName = customDisplayName || getDefaultParticipantName(participantId);

	return {
		participantId,
		displayName,
		roomName
	};
}
