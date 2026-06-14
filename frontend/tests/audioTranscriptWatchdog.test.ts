import assert from "node:assert/strict";
import test from "node:test";

import { AUDIO_TRANSCRIPT_STALL_MS, isTranscriptWatchdogMessage, observeAudioTranscriptChunk, shouldReportAudioTranscriptStall } from "../src/lib/audioTranscriptWatchdog.ts";

test("audio transcript watchdog waits until connected spoken audio exceeds the stall window", () => {
	const spokenAudioAt = 1000;

	assert.equal(
		shouldReportAudioTranscriptStall({
			isAudioConnected: true,
			spokenAudioAt,
			lastTranscriptAt: null,
			lastReportedAt: null,
			now: spokenAudioAt + AUDIO_TRANSCRIPT_STALL_MS - 1
		}),
		false
	);

	assert.equal(
		shouldReportAudioTranscriptStall({
			isAudioConnected: true,
			spokenAudioAt,
			lastTranscriptAt: null,
			lastReportedAt: null,
			now: spokenAudioAt + AUDIO_TRANSCRIPT_STALL_MS
		}),
		true
	);
});

test("audio transcript watchdog does not report when a transcript arrived after speech", () => {
	const spokenAudioAt = 1000;

	assert.equal(
		shouldReportAudioTranscriptStall({
			isAudioConnected: true,
			spokenAudioAt,
			lastTranscriptAt: spokenAudioAt + 500,
			lastReportedAt: null,
			now: spokenAudioAt + AUDIO_TRANSCRIPT_STALL_MS + 1000
		}),
		false
	);
});

test("audio transcript watchdog does not repeat the same spoken-audio stall report", () => {
	const spokenAudioAt = 1000;

	assert.equal(
		shouldReportAudioTranscriptStall({
			isAudioConnected: true,
			spokenAudioAt,
			lastTranscriptAt: null,
			lastReportedAt: spokenAudioAt + AUDIO_TRANSCRIPT_STALL_MS,
			now: spokenAudioAt + AUDIO_TRANSCRIPT_STALL_MS + 1000
		}),
		false
	);
});

test("audio transcript watchdog ignores disconnected or silent states", () => {
	assert.equal(
		shouldReportAudioTranscriptStall({
			isAudioConnected: false,
			spokenAudioAt: 1000,
			lastTranscriptAt: null,
			lastReportedAt: null,
			now: 20000
		}),
		false
	);

	assert.equal(
		shouldReportAudioTranscriptStall({
			isAudioConnected: true,
			spokenAudioAt: null,
			lastTranscriptAt: null,
			lastReportedAt: null,
			now: 20000
		}),
		false
	);
});

test("audio transcript watchdog keeps checking after speech stops", () => {
	const speechThreshold = 0.02;
	const spokenAudioAt = observeAudioTranscriptChunk({
		chunkRms: speechThreshold,
		speechThreshold,
		spokenAudioAt: null,
		now: 1000
	});

	assert.equal(spokenAudioAt, 1000);
	assert.equal(
		observeAudioTranscriptChunk({
			chunkRms: 0,
			speechThreshold,
			spokenAudioAt,
			now: 1000 + AUDIO_TRANSCRIPT_STALL_MS
		}),
		spokenAudioAt
	);
	assert.equal(
		shouldReportAudioTranscriptStall({
			isAudioConnected: true,
			spokenAudioAt,
			lastTranscriptAt: null,
			lastReportedAt: null,
			now: 1000 + AUDIO_TRANSCRIPT_STALL_MS
		}),
		true
	);
});

test("audio transcript watchdog recognizes transcript lifecycle messages", () => {
	assert.equal(isTranscriptWatchdogMessage({ type: "transcript" }), true);
	assert.equal(isTranscriptWatchdogMessage({ type: "transcript_update" }), true);
	assert.equal(isTranscriptWatchdogMessage({ type: "transcript_boundary" }), true);
	assert.equal(isTranscriptWatchdogMessage({ type: "idea_blocks_update" }), false);
	assert.equal(isTranscriptWatchdogMessage(null), false);
});
