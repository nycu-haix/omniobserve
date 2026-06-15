import json
import unittest

from app.schemas import StreamTranscript
from app.services import streaming


class FakeSessionLocal:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, exc_type, exc, traceback):
        return None


class FakeAudioWebSocket:
    def __init__(self) -> None:
        sample = (1000).to_bytes(2, "little", signed=True)
        self._messages = [
            {"type": "websocket.receive", "bytes": sample * 16000},
            {"type": "websocket.receive", "text": json.dumps({"type": "stop"})},
        ]
        self.sent: list[dict] = []
        self.client_state = streaming.WebSocketState.CONNECTED
        self.application_state = streaming.WebSocketState.CONNECTED

    async def accept(self) -> None:
        return None

    async def receive_text(self) -> str:
        return json.dumps(
            {
                "type": "start",
                "sessionName": "session-a",
                "scope": "private",
                "sampleRate": 16000,
                "encoding": "int16_pcm",
                "channels": 1,
            }
        )

    async def receive(self) -> dict:
        if not self._messages:
            return {"type": "websocket.disconnect"}
        return self._messages.pop(0)

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    async def close(self, code: int = 1000) -> None:
        self.application_state = streaming.WebSocketState.DISCONNECTED


class StreamingAudioFailureOrderTests(unittest.IsolatedAsyncioTestCase):
    async def test_pipeline_failure_is_sent_after_final_transcript_updates(self) -> None:
        websocket = FakeAudioWebSocket()
        admin_events: list[dict] = []
        original_logger_disabled = streaming.logger.disabled
        originals = {
            "SessionLocal": streaming.SessionLocal,
            "_sync_cached_participant_roles": streaming._sync_cached_participant_roles,
            "transcribe_ws_chunk": streaming.transcribe_ws_chunk,
            "save_ws_transcript_segment": streaming.save_ws_transcript_segment,
            "handle_transcript_segment": streaming.handle_transcript_segment,
            "broadcast_admin_transcript": streaming.broadcast_admin_transcript,
            "broadcast_admin_idea_blocks_update": streaming.broadcast_admin_idea_blocks_update,
            "broadcast_admin_terminal_error": streaming.broadcast_admin_terminal_error,
            "broadcast_presence_state": streaming.broadcast_presence_state,
            "update_audio_status": streaming.update_audio_status,
            "mark_audio_disconnected": streaming.mark_audio_disconnected,
        }

        async def noop_sync_roles(db, session_name: str) -> None:
            return None

        async def fake_transcribe_ws_chunk(**kwargs) -> str:
            return "final speech"

        async def fake_save_ws_transcript_segment(db, **kwargs) -> StreamTranscript:
            return StreamTranscript(segment_id="42", text=kwargs["transcript_text"])

        async def failing_handle_transcript_segment(*args, **kwargs):
            raise RuntimeError("pipeline failed")

        async def fake_broadcast_admin_transcript(session_name: str, **kwargs) -> None:
            admin_events.append({"type": "transcript", **kwargs})

        async def fake_broadcast_admin_idea_blocks_update(session_name: str, **kwargs) -> None:
            admin_events.append({"type": "idea_blocks_update", **kwargs})

        async def fake_broadcast_admin_terminal_error(session_name: str, *, error_type: str, **kwargs) -> None:
            admin_events.append({"type": error_type, **kwargs})

        async def fake_broadcast_presence_state(session_name: str) -> None:
            return None

        try:
            streaming.logger.disabled = True
            streaming.SessionLocal = lambda: FakeSessionLocal()
            streaming._sync_cached_participant_roles = noop_sync_roles
            streaming.transcribe_ws_chunk = fake_transcribe_ws_chunk
            streaming.save_ws_transcript_segment = fake_save_ws_transcript_segment
            streaming.handle_transcript_segment = failing_handle_transcript_segment
            streaming.broadcast_admin_transcript = fake_broadcast_admin_transcript
            streaming.broadcast_admin_idea_blocks_update = fake_broadcast_admin_idea_blocks_update
            streaming.broadcast_admin_terminal_error = fake_broadcast_admin_terminal_error
            streaming.broadcast_presence_state = fake_broadcast_presence_state
            streaming.update_audio_status = lambda *args, **kwargs: None
            streaming.mark_audio_disconnected = lambda *args, **kwargs: None

            await streaming.handle_audio_stream_websocket(
                websocket,
                session_name="session-a",
                participant_id="7",
                task_name="lost-at-sea",
            )
        finally:
            streaming.logger.disabled = original_logger_disabled
            for name, value in originals.items():
                setattr(streaming, name, value)

        participant_types = [message["type"] for message in websocket.sent]
        self.assertEqual(
            participant_types[-4:],
            ["transcript_update", "idea_blocks_update", "pipeline_error", "task_items_update"],
        )
        terminal_messages = websocket.sent[-4:]
        self.assertEqual(terminal_messages[0]["transcript_segment_id"], "42")
        self.assertEqual(terminal_messages[1]["generation_complete"], False)
        self.assertEqual(terminal_messages[2]["transcript_segment_ids"], ["42"])

        admin_types = [message["type"] for message in admin_events]
        self.assertEqual(admin_types[-3:], ["transcript", "idea_blocks_update", "pipeline_error"])
        terminal_admin_messages = admin_events[-3:]
        self.assertEqual(terminal_admin_messages[1]["generation_complete"], False)
        self.assertEqual(terminal_admin_messages[2]["transcript_segment_ids"], ["42"])


if __name__ == "__main__":
    unittest.main()
