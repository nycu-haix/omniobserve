import unittest

from app.services.realtime import _public_context_component_state_message, session_public_context_state


class PublicNowLatencyMessageTests(unittest.TestCase):
    def tearDown(self) -> None:
        session_public_context_state.pop("latency-room", None)

    def test_public_context_state_message_exposes_latency_diagnostics(self) -> None:
        session_public_context_state["latency-room"] = {
            "component_ids": ["qr_code"],
            "task_item_ids": [2],
            "source": "auto",
            "match_count": 3,
            "delivered_count": 2,
            "timestamp_ms": 3000,
            "event_timestamp_ms": 1000,
            "matching_started_at_ms": 1800,
            "matching_completed_at_ms": 2900,
            "debounce_ms": 750,
            "queue_delay_ms": 800,
            "matching_duration_ms": 1100,
            "event_to_state_ms": 1900,
            "text_chars": 42,
            "context_chars": 120,
            "target_participant_count": 2,
            "board_connection_count": 4,
            "admin_connection_count": 1,
            "transcript_segment_id": "77",
        }

        message = _public_context_component_state_message("latency-room")

        self.assertEqual(message["eventTimestampMs"], 1000)
        self.assertEqual(message["event_timestamp_ms"], 1000)
        self.assertEqual(message["eventToStateMs"], 1900)
        self.assertEqual(message["matchingDurationMs"], 1100)
        self.assertEqual(message["queueDelayMs"], 800)
        self.assertEqual(message["targetParticipantCount"], 2)
        self.assertEqual(message["textChars"], 42)
        self.assertEqual(message["contextChars"], 120)
        self.assertEqual(message["transcriptSegmentId"], "77")
        self.assertIsInstance(message["adminBroadcastAtMs"], int)


if __name__ == "__main__":
    unittest.main()
