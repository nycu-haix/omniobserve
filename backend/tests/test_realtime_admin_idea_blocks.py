from types import SimpleNamespace
import unittest

from app.services import realtime


class AdminIdeaBlocksBroadcastTests(unittest.IsolatedAsyncioTestCase):
    async def test_broadcast_includes_completion_metadata(self) -> None:
        sent_messages: list[tuple[str, dict]] = []
        original_admin_manager = realtime.admin_manager

        async def fake_broadcast(session_id: str, message: dict) -> None:
            sent_messages.append((session_id, message))

        try:
            realtime.admin_manager = SimpleNamespace(broadcast=fake_broadcast)

            await realtime.broadcast_admin_idea_blocks_update(
                "session-a",
                participant_id="7",
                idea_blocks=[],
                duplicate_idea_blocks=[{"id": 12}],
                scope="private",
                transcript_segment_id=42,
                transcript_segment_ids=["42"],
                client_segment_id="client-42",
                client_segment_ids=["client-42"],
                generation_complete=True,
            )
        finally:
            realtime.admin_manager = original_admin_manager

        self.assertEqual(len(sent_messages), 1)
        session_id, message = sent_messages[0]
        self.assertEqual(session_id, "session-a")
        self.assertEqual(message["type"], "idea_blocks_update")
        self.assertEqual(message["session_name"], "session-a")
        self.assertEqual(message["participant_id"], "7")
        self.assertEqual(message["idea_blocks"], [])
        self.assertEqual(message["duplicate_idea_blocks"], [{"id": 12}])
        self.assertEqual(message["scope"], "private")
        self.assertEqual(message["transcript_segment_id"], 42)
        self.assertEqual(message["transcript_segment_ids"], ["42"])
        self.assertEqual(message["client_segment_id"], "client-42")
        self.assertEqual(message["client_segment_ids"], ["client-42"])
        self.assertIs(message["generation_complete"], True)
        self.assertIsInstance(message["timestamp_ms"], int)


if __name__ == "__main__":
    unittest.main()
