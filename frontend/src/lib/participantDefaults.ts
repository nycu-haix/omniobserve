export const PARTICIPANT_NAME_MAP: Record<string, string> = {
	"1": "Otter",
	"2": "Fox",
	"3": "Rabbit",
	"4": "Penguin"
};

export const DEFAULT_PARTICIPANT_IDS = Object.keys(PARTICIPANT_NAME_MAP);

export function getDefaultParticipantName(participantId: string) {
	return PARTICIPANT_NAME_MAP[participantId] || `Guest ${participantId}`;
}

export function getNextAvailableParticipantId(participants: string[]) {
	const occupiedIds = new Set(participants);
	return DEFAULT_PARTICIPANT_IDS.find(participantId => !occupiedIds.has(participantId)) || DEFAULT_PARTICIPANT_IDS[0];
}
