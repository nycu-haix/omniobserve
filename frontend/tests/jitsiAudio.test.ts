import assert from "node:assert/strict";
import test from "node:test";

import {
	getJitsiNoiseSuppressionCommandConfig,
	getJitsiPublicAudioVolume,
	getJitsiRemoteParticipantVolumeCommands,
	JITSI_NOISE_SUPPRESSION_ENABLED,
	JITSI_PUBLIC_AUDIO_DEFAULT_VOLUME,
	JITSI_PUBLIC_AUDIO_WHISPER_DUCK_VOLUME,
	shouldDuckJitsiPublicAudio
} from "../src/lib/jitsiAudio.ts";

test("Jitsi noise suppression is enabled by default", () => {
	assert.equal(JITSI_NOISE_SUPPRESSION_ENABLED, true);
	assert.deepEqual(getJitsiNoiseSuppressionCommandConfig(), { enabled: true });
});

test("Jitsi public audio ducks only while the local participant speaks in private mode", () => {
	assert.equal(shouldDuckJitsiPublicAudio({ micMode: "private", isLocalSpeaking: true }), true);
	assert.equal(shouldDuckJitsiPublicAudio({ micMode: "private", isLocalSpeaking: false }), false);
	assert.equal(shouldDuckJitsiPublicAudio({ micMode: "public", isLocalSpeaking: true }), false);
	assert.equal(getJitsiPublicAudioVolume({ micMode: "private", isLocalSpeaking: true }), JITSI_PUBLIC_AUDIO_WHISPER_DUCK_VOLUME);
	assert.equal(getJitsiPublicAudioVolume({ micMode: "private", isLocalSpeaking: false }), JITSI_PUBLIC_AUDIO_DEFAULT_VOLUME);
	assert.equal(getJitsiPublicAudioVolume({ micMode: "public", isLocalSpeaking: true }), JITSI_PUBLIC_AUDIO_DEFAULT_VOLUME);
});

test("Jitsi remote participant volume commands skip local and duplicate participants", () => {
	assert.deepEqual(getJitsiRemoteParticipantVolumeCommands([{ id: "local", isLocal: true }, { id: "remote-a" }, { id: "remote-a" }, { id: "remote-b", isLocal: false }, { id: "   " }], 0.25), [
		{ participantId: "remote-a", volume: 0.25 },
		{ participantId: "remote-b", volume: 0.25 }
	]);
});

test("Jitsi remote participant volume commands clamp invalid volumes", () => {
	assert.deepEqual(getJitsiRemoteParticipantVolumeCommands([{ id: "remote-a" }], 2), [{ participantId: "remote-a", volume: 1 }]);
	assert.deepEqual(getJitsiRemoteParticipantVolumeCommands([{ id: "remote-a" }], -1), [{ participantId: "remote-a", volume: 0 }]);
});
