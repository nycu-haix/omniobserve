import type { MicMode } from "../types";

export const PUBLIC_CHANNEL_NORMAL_PLAYBACK_VOLUME = 1;
export const PUBLIC_CHANNEL_DUCKED_PLAYBACK_VOLUME = 0.25;

export function getNextMicModeAfterPublicActivation(currentMode: MicMode): MicMode {
	return currentMode === "public" ? "private" : "public";
}

export function getPublicChannelPlaybackVolume(micMode: MicMode): number {
	return micMode === "private" ? PUBLIC_CHANNEL_DUCKED_PLAYBACK_VOLUME : PUBLIC_CHANNEL_NORMAL_PLAYBACK_VOLUME;
}
