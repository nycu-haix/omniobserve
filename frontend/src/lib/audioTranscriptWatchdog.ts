export const AUDIO_TRANSCRIPT_STALL_MS = 15000;
export const AUDIO_TRANSCRIPT_STALL_MESSAGE = "麥克風有收到聲音，但逐字稿尚未更新。請重新連線音訊。";

const TRANSCRIPT_MESSAGE_TYPES = new Set(["transcript", "transcript_update", "transcript_boundary"]);

export interface AudioTranscriptWatchdogState {
	isAudioConnected: boolean;
	spokenAudioAt: number | null;
	lastTranscriptAt: number | null;
	lastReportedAt: number | null;
	now: number;
	stallMs?: number;
}

export interface ObserveAudioTranscriptChunkState {
	chunkRms: number;
	speechThreshold: number;
	spokenAudioAt: number | null;
	now: number;
}

export function isTranscriptWatchdogMessage(message: { type?: string } | null | undefined): boolean {
	return typeof message?.type === "string" && TRANSCRIPT_MESSAGE_TYPES.has(message.type);
}

export function observeAudioTranscriptChunk({ chunkRms, speechThreshold, spokenAudioAt, now }: ObserveAudioTranscriptChunkState): number | null {
	if (spokenAudioAt !== null) {
		return spokenAudioAt;
	}

	return chunkRms >= speechThreshold ? now : null;
}

export function shouldReportAudioTranscriptStall({
	isAudioConnected,
	spokenAudioAt,
	lastTranscriptAt,
	lastReportedAt,
	now,
	stallMs = AUDIO_TRANSCRIPT_STALL_MS
}: AudioTranscriptWatchdogState): boolean {
	if (!isAudioConnected || spokenAudioAt === null) {
		return false;
	}

	if (lastTranscriptAt !== null && lastTranscriptAt >= spokenAudioAt) {
		return false;
	}

	if (lastReportedAt !== null && lastReportedAt >= spokenAudioAt) {
		return false;
	}

	return now - spokenAudioAt >= stallMs;
}
