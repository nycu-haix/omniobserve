from types import SimpleNamespace
import unittest

from app.schemas import ApiError
from app.services.phase_task_item_snapshot_service import _observer_participant_ids, _participant_user_id_filter
from app.services.participant_status import sync_participant_roles
from app.services.participant_roles import is_participant_analysis_role, normalize_participant_role
from app.services.ranking_phase_snapshot_service import _is_participant_subject
from app.services.realtime import (
    _is_admin_monitor_ranking_subject,
    _is_participant_ranking_subject,
    _phase_snapshot_participant_ids,
)
from app.services.task_export_service import _ranking_artifact_name, _snapshot_subject_token


class ParticipantRoleTests(unittest.TestCase):
    def test_normalizes_observer_aliases(self) -> None:
        self.assertEqual(normalize_participant_role("observer"), "observer")
        self.assertEqual(normalize_participant_role("nonparticipant"), "observer")
        self.assertEqual(normalize_participant_role("non_participant"), "observer")
        self.assertEqual(normalize_participant_role("facilitator"), "facilitator")

    def test_normalizes_experiment_role_aliases(self) -> None:
        self.assertEqual(normalize_participant_role("confederate"), "confederate")
        self.assertEqual(normalize_participant_role("confederate_script"), "confederate")
        self.assertEqual(normalize_participant_role("staff"), "facilitator")
        self.assertEqual(normalize_participant_role("test_client"), "test")
        self.assertEqual(normalize_participant_role("mock_participant"), "test")
        self.assertTrue(is_participant_analysis_role("participant"))
        self.assertFalse(is_participant_analysis_role("confederate"))
        self.assertFalse(is_participant_analysis_role("facilitator"))
        self.assertFalse(is_participant_analysis_role("test"))

    def test_rejects_unknown_roles(self) -> None:
        with self.assertRaises(ApiError):
            normalize_participant_role("speaker")

    def test_observer_private_ranking_uses_diagnostic_artifact(self) -> None:
        snapshot = SimpleNamespace(
            scope="private",
            participant_id="7",
            phase="reflect",
            subject_type="participant",
            subject_id="7",
        )

        self.assertEqual(
            _ranking_artifact_name(snapshot, {"7": "observer"}),
            "observer_ranking_diagnostic",
        )

    def test_observer_private_ranking_subject_is_prefixed(self) -> None:
        context = SimpleNamespace(group_id="G2")
        snapshot = SimpleNamespace(
            scope="private",
            participant_id="7",
            phase="private_phase_2",
            subject_type="participant",
            subject_id="7",
        )

        self.assertEqual(
            _snapshot_subject_token(context, snapshot, {"7": "observer"}),
            "observer_G2P7_private_phase_2",
        )

    def test_confederate_private_ranking_uses_role_diagnostic_artifact(self) -> None:
        context = SimpleNamespace(group_id="G2")
        snapshot = SimpleNamespace(
            scope="private",
            participant_id="7",
            phase="private_phase_2",
            subject_type="participant",
            subject_id="7",
        )

        self.assertEqual(
            _ranking_artifact_name(snapshot, {"7": "confederate"}),
            "confederate_ranking_diagnostic",
        )
        self.assertEqual(
            _snapshot_subject_token(context, snapshot, {"7": "confederate"}),
            "confederate_G2P7_private_phase_2",
        )

    def test_observer_is_kept_for_phase_snapshot_diagnostics(self) -> None:
        session_name = "test-observer-phase-snapshot"
        sync_participant_roles(session_name, {"1": "observer", "2": "participant"})

        self.assertEqual(
            _phase_snapshot_participant_ids(["1", "2", "admin", "admin-reviewer", "observer"]),
            ["1", "2"],
        )
        self.assertFalse(_is_participant_ranking_subject(session_name, "1"))
        self.assertTrue(_is_participant_ranking_subject(session_name, "2"))
        self.assertFalse(_is_participant_ranking_subject(session_name, "observer"))

    def test_admin_monitor_keeps_confederate_private_ranking_visible(self) -> None:
        session_name = "test-admin-monitor-confederate-ranking"
        sync_participant_roles(
            session_name,
            {
                "1": "participant",
                "2": "confederate",
                "3": "observer",
                "4": "facilitator",
                "5": "test",
            },
        )

        self.assertTrue(_is_admin_monitor_ranking_subject(session_name, "1"))
        self.assertTrue(_is_admin_monitor_ranking_subject(session_name, "2"))
        self.assertFalse(_is_admin_monitor_ranking_subject(session_name, "3"))
        self.assertFalse(_is_admin_monitor_ranking_subject(session_name, "4"))
        self.assertFalse(_is_admin_monitor_ranking_subject(session_name, "5"))
        self.assertFalse(_is_admin_monitor_ranking_subject(session_name, "admin-reviewer"))
        self.assertFalse(_is_participant_ranking_subject(session_name, "2"))

    def test_phase_snapshot_item_catalog_filters_to_analysis_participants(self) -> None:
        self.assertEqual(_participant_user_id_filter(["2", "admin", "observer", "1", "0"]), [1, 2])
        self.assertEqual(_participant_user_id_filter([]), [])
        self.assertIsNone(_participant_user_id_filter(None))

    def test_phase_snapshot_item_catalog_excludes_observer_sources(self) -> None:
        observer_ids = _observer_participant_ids(
            {
                "1": "observer",
                "2": "confederate",
                "3": "participant",
                "4": "facilitator",
                "5": "test",
                "admin": "observer",
                "test-client": "test",
            }
        )
        self.assertEqual(
            observer_ids,
            ["1", "2", "4", "5", "admin", "test-client"],
        )
        self.assertEqual(_participant_user_id_filter(observer_ids), [1, 2, 4, 5])

    def test_persisted_phase_snapshot_subjects_are_participant_ids(self) -> None:
        self.assertTrue(_is_participant_subject("1"))
        self.assertTrue(_is_participant_subject(2))
        self.assertFalse(_is_participant_subject("0"))
        self.assertFalse(_is_participant_subject("admin"))
        self.assertFalse(_is_participant_subject("admin-reviewer"))
        self.assertFalse(_is_participant_subject("test-client"))


if __name__ == "__main__":
    unittest.main()
