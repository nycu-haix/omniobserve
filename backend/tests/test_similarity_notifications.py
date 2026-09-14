from types import SimpleNamespace
import unittest

from app.services import similarity_notifications


class FakeAsyncSession:
    def __init__(self) -> None:
        self.rollback_called = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def rollback(self) -> None:
        self.rollback_called = True


class SimilarityNotificationTests(unittest.IsolatedAsyncioTestCase):
    async def test_suppressed_similarity_cue_is_persisted_for_audit(self) -> None:
        recorded_events: list[dict] = []
        fake_session = FakeAsyncSession()
        original_session_local = similarity_notifications.SessionLocal
        original_record_delivery = similarity_notifications.record_similarity_cue_delivery
        original_cue_enabled = similarity_notifications.is_similarity_cue_enabled
        original_get_phase = similarity_notifications.get_session_phase
        original_get_condition = similarity_notifications.get_session_cue_condition
        original_board_manager = similarity_notifications.board_manager

        async def fake_record_similarity_cue_delivery(db, **kwargs):
            recorded_events.append(kwargs)

        try:
            similarity_notifications.SessionLocal = lambda: fake_session
            similarity_notifications.record_similarity_cue_delivery = fake_record_similarity_cue_delivery
            similarity_notifications.is_similarity_cue_enabled = lambda session_name: False
            similarity_notifications.get_session_phase = lambda session_name: "reflect"
            similarity_notifications.get_session_cue_condition = lambda session_name: "control"
            similarity_notifications.board_manager = SimpleNamespace(get_participants=lambda session_name: ["1"])

            status = await similarity_notifications.send_similarity_cue(
                session_name="test-suppressed-cue",
                participant_id="1",
                own_block=SimpleNamespace(id=10, title="Own", summary="Own summary"),
                other_block=SimpleNamespace(id=11, title="Other", summary="Other summary"),
                similarity_id=7,
                is_same_reason=True,
                reason="same component",
            )
        finally:
            similarity_notifications.SessionLocal = original_session_local
            similarity_notifications.record_similarity_cue_delivery = original_record_delivery
            similarity_notifications.is_similarity_cue_enabled = original_cue_enabled
            similarity_notifications.get_session_phase = original_get_phase
            similarity_notifications.get_session_cue_condition = original_get_condition
            similarity_notifications.board_manager = original_board_manager

        self.assertEqual(status, "suppressed")
        self.assertEqual(len(recorded_events), 1)
        event = recorded_events[0]
        self.assertEqual(event["delivery_status"], "suppressed")
        self.assertEqual(event["phase"], "reflect")
        self.assertEqual(event["condition"], "control")
        self.assertFalse(event["cue_enabled"])
        self.assertEqual(event["event_metadata"]["suppressed_reason"], "cue_disabled")
        self.assertEqual(event["event_metadata"]["board_participants"], ["1"])
        self.assertFalse(fake_session.rollback_called)


if __name__ == "__main__":
    unittest.main()
