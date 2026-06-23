import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAudioWsBaseUrl } from "../src/lib/audioWsBaseUrl.ts";

test("adds the ASR gateway prefix for bare Omni API websocket hosts", () => {
	assert.equal(normalizeAudioWsBaseUrl("wss://api.omni.observe.tw/"), "wss://api.omni.observe.tw/asr");
});

test("uses branch-specific ASR hosts for personal Omni deployments", () => {
	assert.equal(normalizeAudioWsBaseUrl("wss://api.omni.observe.tw", { frontendHostname: "sky.omni.observe.tw" }), "wss://sky.ai.omni.observe.tw");
	assert.equal(normalizeAudioWsBaseUrl("wss://sky.api.omni.observe.tw"), "wss://sky.ai.omni.observe.tw");
});

test("keeps explicit ASR gateway prefixes unchanged", () => {
	assert.equal(normalizeAudioWsBaseUrl("wss://sky.api.omni.observe.tw/asr"), "wss://sky.api.omni.observe.tw/asr");
});

test("keeps local and custom audio websocket bases unchanged", () => {
	assert.equal(normalizeAudioWsBaseUrl("ws://127.0.0.1:8001"), "ws://127.0.0.1:8001");
	assert.equal(normalizeAudioWsBaseUrl("wss://example.com/gateway"), "wss://example.com/gateway");
});
