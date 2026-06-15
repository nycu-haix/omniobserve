import assert from "node:assert/strict";
import test from "node:test";

import { getNextMicModeAfterPublicActivation, getPublicChannelPlaybackVolume, PUBLIC_CHANNEL_DUCKED_PLAYBACK_VOLUME, PUBLIC_CHANNEL_NORMAL_PLAYBACK_VOLUME } from "../src/lib/micMode.ts";

test("public-speaking activation switches private mode to public", () => {
	assert.equal(getNextMicModeAfterPublicActivation("private"), "public");
});

test("public-speaking activation switches active public mode back to private", () => {
	assert.equal(getNextMicModeAfterPublicActivation("public"), "private");
});

test("private whisper mode ducks public-channel playback", () => {
	assert.equal(getPublicChannelPlaybackVolume("private"), PUBLIC_CHANNEL_DUCKED_PLAYBACK_VOLUME);
	assert.ok(getPublicChannelPlaybackVolume("private") < PUBLIC_CHANNEL_NORMAL_PLAYBACK_VOLUME);
});

test("public speaking mode restores public-channel playback", () => {
	assert.equal(getPublicChannelPlaybackVolume("public"), PUBLIC_CHANNEL_NORMAL_PLAYBACK_VOLUME);
});
