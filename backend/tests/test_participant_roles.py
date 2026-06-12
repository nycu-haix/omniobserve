from types import SimpleNamespace
import unittest

from app.schemas import ApiError
from app.services.participant_roles import normalize_participant_role
from app.services.task_export_service import _ranking_artifact_name, _snapshot_subject_token


class ParticipantRoleTests(unittest.TestCase):
    def test_normalizes_observer_aliases(self) -> None:
        self.assertEqual(normalize_participant_role("observer"), "observer")
        self.assertEqual(normalize_participant_role("nonparticipant"), "observer")
        self.assertEqual(normalize_participant_role("non_participant"), "observer")
        self.assertEqual(normalize_participant_role("facilitator"), "observer")

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
            phase="initial",
            subject_type="participant",
            subject_id="7",
        )

        self.assertEqual(
            _snapshot_subject_token(context, snapshot, {"7": "observer"}),
            "observer_G2P7",
        )


if __name__ == "__main__":
    unittest.main()
