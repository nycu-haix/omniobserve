const PARTICIPANT_NAME_MAP: Record<string, string> = {
	"1": "Otter",
	"2": "Fox",
	"3": "Rabbit",
	"4": "Penguin"
};

function normalizeRoomName(roomName: string | null): string {
	const fallbackRoomName = import.meta.env.VITE_DEFAULT_ROOM_NAME || "mars-survival-001";
	const normalized = roomName?.trim().replace(/^["']|["']$/g, "");
	return normalized || fallbackRoomName;
}

export function useParticipantIdentity() {
	const params = new URLSearchParams(window.location.search);
	const participantId = params.get("id") ?? "1";
	const roomName = normalizeRoomName(params.get("room_name"));
	const displayName = PARTICIPANT_NAME_MAP[participantId] ?? `Guest ${participantId}`;

	return {
		participantId,
		displayName,
		roomName
	};
}
