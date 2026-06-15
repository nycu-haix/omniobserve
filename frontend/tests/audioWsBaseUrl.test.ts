import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAudioWsBaseUrl } from "../src/lib/audioWsBaseUrl.ts";

test("adds the ASR gateway prefix for bare Omni API websocket hosts", () => {
	assert.equal(normalizeAudioWsBaseUrl("wss://api.omni.elvismao.com/"), "wss://api.omni.elvismao.com/asr");
});

test("uses branch-specific ASR hosts for personal Omni deployments", () => {
	assert.equal(normalizeAudioWsBaseUrl("wss://api.omni.elvismao.com", { frontendHostname: "sky.omni.elvismao.com" }), "wss://sky.ai.omni.elvismao.com");
	assert.equal(normalizeAudioWsBaseUrl("wss://sky.api.omni.elvismao.com"), "wss://sky.ai.omni.elvismao.com");
});

test("keeps explicit ASR gateway prefixes unchanged", () => {
	assert.equal(normalizeAudioWsBaseUrl("wss://sky.api.omni.elvismao.com/asr"), "wss://sky.api.omni.elvismao.com/asr");
});

test("keeps local and custom audio websocket bases unchanged", () => {
	assert.equal(normalizeAudioWsBaseUrl("ws://127.0.0.1:8001"), "ws://127.0.0.1:8001");
	assert.equal(normalizeAudioWsBaseUrl("wss://example.com/gateway"), "wss://example.com/gateway");
});
