import assert from "node:assert/strict";
import test from "node:test";
import { filterAdminPresenceRows, isAdminParticipantId, isObserverRole, isParticipantAnalysisRole, normalizeParticipantRole } from "../src/lib/participantRoles.ts";

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

test("identifies admin presence participant IDs", () => {
	assert.equal(isAdminParticipantId("0"), true);
	assert.equal(isAdminParticipantId("admin"), true);
	assert.equal(isAdminParticipantId("admin-268affaa"), true);
	assert.equal(isAdminParticipantId("1"), false);
	assert.equal(isAdminParticipantId("Participant 1"), false);
});

test("filters admin presence rows for admin role controls", () => {
	const participants = filterAdminPresenceRows([
		{ id: "1", participant_role: "observer", display_name: "Participant 1" },
		{ id: "admin-268affaa", participant_role: "participant" },
		{ id: "2", participant_role: "participant", display_name: "Participant 2" }
	]);

	assert.deepEqual(
		participants.map(participant => participant.id),
		["1", "2"]
	);
	assert.equal(participants[0]?.participant_role, "observer");
	assert.equal(participants[1]?.display_name, "Participant 2");
});
