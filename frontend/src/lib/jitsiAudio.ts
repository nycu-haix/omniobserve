import type { MicMode } from "../types";

export const JITSI_NOISE_SUPPRESSION_ENABLED = true;
export const JITSI_PUBLIC_AUDIO_DEFAULT_VOLUME = 1;
export const JITSI_PUBLIC_AUDIO_WHISPER_DUCK_VOLUME = 0.25;

export function getJitsiNoiseSuppressionCommandConfig() {
	return {
		enabled: JITSI_NOISE_SUPPRESSION_ENABLED
	};
}

export function shouldDuckJitsiPublicAudio({ micMode, duckingEnabled }: { micMode: MicMode; duckingEnabled: boolean }) {
	return duckingEnabled && micMode === "private";
}

export function getJitsiPublicAudioVolume({ micMode, duckingEnabled }: { micMode: MicMode; duckingEnabled: boolean }) {
	return shouldDuckJitsiPublicAudio({ micMode, duckingEnabled }) ? JITSI_PUBLIC_AUDIO_WHISPER_DUCK_VOLUME : JITSI_PUBLIC_AUDIO_DEFAULT_VOLUME;
}

export function getJitsiRemoteParticipantVolumeCommands(participants: Iterable<{ id: string; isLocal?: boolean }>, volume: number): { participantId: string; volume: number }[] {
	const normalizedVolume = Math.min(JITSI_PUBLIC_AUDIO_DEFAULT_VOLUME, Math.max(0, volume));
	const seenParticipantIds = new Set<string>();
	const commands: { participantId: string; volume: number }[] = [];

	for (const participant of participants) {
		const participantId = participant.id.trim();
		if (!participantId || participant.isLocal || participantId === "local" || seenParticipantIds.has(participantId)) {
			continue;
		}

		seenParticipantIds.add(participantId);
		commands.push({ participantId, volume: normalizedVolume });
	}

	return commands;
}
