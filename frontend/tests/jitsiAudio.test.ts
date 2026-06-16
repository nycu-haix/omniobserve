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

test("Jitsi public audio ducks only in private mode when enabled", () => {
	assert.equal(shouldDuckJitsiPublicAudio({ micMode: "private", duckingEnabled: true }), true);
	assert.equal(shouldDuckJitsiPublicAudio({ micMode: "public", duckingEnabled: true }), false);
	assert.equal(shouldDuckJitsiPublicAudio({ micMode: "private", duckingEnabled: false }), false);
	assert.equal(getJitsiPublicAudioVolume({ micMode: "private", duckingEnabled: true }), JITSI_PUBLIC_AUDIO_WHISPER_DUCK_VOLUME);
	assert.equal(getJitsiPublicAudioVolume({ micMode: "public", duckingEnabled: true }), JITSI_PUBLIC_AUDIO_DEFAULT_VOLUME);
	assert.equal(getJitsiPublicAudioVolume({ micMode: "private", duckingEnabled: false }), JITSI_PUBLIC_AUDIO_DEFAULT_VOLUME);
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
