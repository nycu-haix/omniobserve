import assert from "node:assert/strict";
import test from "node:test";
import { isObserverRole, isParticipantAnalysisRole, normalizeParticipantRole } from "../src/lib/participantRoles.ts";

test("normalizes observer aliases", () => {
	assert.equal(normalizeParticipantRole("observer"), "observer");
	assert.equal(normalizeParticipantRole("nonparticipant"), "observer");
	assert.equal(normalizeParticipantRole("non_participant"), "observer");
	assert.equal(normalizeParticipantRole("facilitator"), "observer");
});

test("defaults missing and unknown roles to participant for frontend display", () => {
	assert.equal(normalizeParticipantRole(undefined), "participant");
	assert.equal(normalizeParticipantRole("presenter"), "participant");
	assert.equal(isParticipantAnalysisRole("participant"), true);
});

test("identifies observers as excluded from participant analysis", () => {
	assert.equal(isObserverRole("observer"), true);
	assert.equal(isParticipantAnalysisRole("observer"), false);
});
