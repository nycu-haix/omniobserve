const PARTICIPANT_NAME_MAP: Record<string, string> = {
  "1": "Otter",
  "2": "Fox",
  "3": "Rabbit",
  "4": "Penguin",
};

export function useParticipantIdentity() {
  const params = new URLSearchParams(window.location.search);
  const participantId = params.get("id") ?? "1";
  const displayName = PARTICIPANT_NAME_MAP[participantId] ?? `Guest ${participantId}`;

  return {
    participantId,
    displayName,
  };
}
