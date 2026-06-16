import json
import unittest

from app.schemas import StreamTranscript
from app.services import streaming
from app.services.transcript_pipeline import PipelineResult


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


class FakeTranscriptSegmentsWebSocket:
    def __init__(self) -> None:
        self._messages = [
            {
                "type": "transcript_segment",
                "text": "gateway final speech",
                "reason": "silence",
                "scope": "private",
                "start": 0,
            },
            {"type": "stop"},
        ]
        self.sent: list[dict] = []
        self.client_state = streaming.WebSocketState.CONNECTED
        self.application_state = streaming.WebSocketState.CONNECTED

    async def accept(self) -> None:
        return None

    async def receive_json(self) -> dict:
        if not self._messages:
            raise streaming.WebSocketDisconnect()
        return self._messages.pop(0)

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)

    async def close(self, code: int = 1000) -> None:
        self.application_state = streaming.WebSocketState.DISCONNECTED


class StreamingAudioFailureOrderTests(unittest.IsolatedAsyncioTestCase):
    async def run_private_audio_stop(self, handle_transcript_segment):
        websocket = FakeAudioWebSocket()
        admin_events: list[dict] = []
        pipeline_call_observations: list[dict] = []
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

        async def fake_broadcast_admin_transcript(session_name: str, **kwargs) -> None:
            admin_events.append({"type": "transcript", **kwargs})

        async def fake_broadcast_admin_idea_blocks_update(session_name: str, **kwargs) -> None:
            admin_events.append({"type": "idea_blocks_update", **kwargs})

        async def fake_broadcast_admin_terminal_error(session_name: str, *, error_type: str, **kwargs) -> None:
            admin_events.append({"type": error_type, **kwargs})

        async def fake_broadcast_presence_state(session_name: str) -> None:
            return None

        async def recorded_handle_transcript_segment(*args, **kwargs):
            pipeline_call_observations.append(
                {
                    "participant_types": [message["type"] for message in websocket.sent],
                    "participant_messages": [dict(message) for message in websocket.sent],
                    "admin_types": [message["type"] for message in admin_events],
                    "admin_messages": [dict(message) for message in admin_events],
                }
            )
            return await handle_transcript_segment(*args, **kwargs)

        try:
            streaming.logger.disabled = True
            streaming.SessionLocal = lambda: FakeSessionLocal()
            streaming._sync_cached_participant_roles = noop_sync_roles
            streaming.transcribe_ws_chunk = fake_transcribe_ws_chunk
            streaming.save_ws_transcript_segment = fake_save_ws_transcript_segment
            streaming.handle_transcript_segment = recorded_handle_transcript_segment
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

        return websocket, admin_events, pipeline_call_observations

    async def run_gateway_transcript_segment(self, handle_transcript_segment):
        websocket = FakeTranscriptSegmentsWebSocket()
        admin_events: list[dict] = []
        original_logger_disabled = streaming.logger.disabled
        originals = {
            "SessionLocal": streaming.SessionLocal,
            "_sync_cached_participant_roles": streaming._sync_cached_participant_roles,
            "_is_audio_transcription_enabled": streaming._is_audio_transcription_enabled,
            "save_ws_transcript_segment": streaming.save_ws_transcript_segment,
            "handle_transcript_segment": streaming.handle_transcript_segment,
            "broadcast_admin_transcript": streaming.broadcast_admin_transcript,
            "broadcast_admin_idea_blocks_update": streaming.broadcast_admin_idea_blocks_update,
            "broadcast_admin_terminal_error": streaming.broadcast_admin_terminal_error,
            "send_board_idea_blocks_update": streaming.send_board_idea_blocks_update,
        }

        async def noop_sync_roles(db, session_name: str) -> None:
            return None

        async def fake_save_ws_transcript_segment(db, **kwargs) -> StreamTranscript:
            return StreamTranscript(segment_id="84", text=kwargs["transcript_text"])

        async def fake_broadcast_admin_transcript(session_name: str, **kwargs) -> None:
            admin_events.append({"type": "transcript", **kwargs})

        async def fake_broadcast_admin_idea_blocks_update(session_name: str, **kwargs) -> None:
            admin_events.append({"type": "idea_blocks_update", **kwargs})

        async def fake_broadcast_admin_terminal_error(session_name: str, *, error_type: str, **kwargs) -> None:
            admin_events.append({"type": error_type, **kwargs})

        async def fake_send_board_idea_blocks_update(**kwargs) -> None:
            return None

        try:
            streaming.logger.disabled = True
            streaming.SessionLocal = lambda: FakeSessionLocal()
            streaming._sync_cached_participant_roles = noop_sync_roles
            streaming._is_audio_transcription_enabled = lambda *args, **kwargs: True
            streaming.save_ws_transcript_segment = fake_save_ws_transcript_segment
            streaming.handle_transcript_segment = handle_transcript_segment
            streaming.broadcast_admin_transcript = fake_broadcast_admin_transcript
            streaming.broadcast_admin_idea_blocks_update = fake_broadcast_admin_idea_blocks_update
            streaming.broadcast_admin_terminal_error = fake_broadcast_admin_terminal_error
            streaming.send_board_idea_blocks_update = fake_send_board_idea_blocks_update

            await streaming.handle_transcript_segments_websocket(
                websocket,
                session_name="session-gateway",
                participant_id="7",
                task_name="lost-at-sea",
            )
        finally:
            streaming.logger.disabled = original_logger_disabled
            for name, value in originals.items():
                setattr(streaming, name, value)

        return websocket, admin_events

    async def test_pipeline_failure_is_sent_after_final_transcript_and_before_stop_ack(self) -> None:
        pipeline_calls: list[dict] = []

        async def failing_handle_transcript_segment(*args, **kwargs):
            pipeline_calls.append(kwargs)
            raise RuntimeError("pipeline failed")

        websocket, admin_events, pipeline_call_observations = await self.run_private_audio_stop(failing_handle_transcript_segment)

        self.assertEqual([call["transcript"].segment_id for call in pipeline_calls], ["42"])
        self.assertEqual([call["is_final"] for call in pipeline_calls], [True])
        self.assertEqual(pipeline_call_observations[0]["participant_types"][-1], "transcript_update")
        self.assertEqual(pipeline_call_observations[0]["participant_messages"][-1]["transcript_segment_id"], "42")
        self.assertEqual(pipeline_call_observations[0]["admin_types"][-1], "transcript")
        self.assertEqual(pipeline_call_observations[0]["admin_messages"][-1]["transcript_segment_id"], "42")

        participant_types = [message["type"] for message in websocket.sent]
        self.assertEqual(
            participant_types[-4:],
            ["transcript_update", "pipeline_error", "idea_blocks_update", "task_items_update"],
        )
        terminal_messages = websocket.sent[-4:]
        self.assertEqual(terminal_messages[0]["transcript_segment_id"], "42")
        self.assertEqual(terminal_messages[1]["transcript_segment_ids"], ["42"])
        self.assertEqual(terminal_messages[2]["generation_complete"], False)

        admin_types = [message["type"] for message in admin_events]
        self.assertEqual(admin_types[-3:], ["transcript", "pipeline_error", "idea_blocks_update"])
        terminal_admin_messages = admin_events[-3:]
        self.assertEqual(terminal_admin_messages[1]["transcript_segment_ids"], ["42"])
        self.assertEqual(terminal_admin_messages[2]["generation_complete"], False)

    async def test_no_result_private_audio_stop_resolves_as_no_idea_completion(self) -> None:
        pipeline_calls: list[dict] = []

        async def empty_handle_transcript_segment(*args, **kwargs):
            pipeline_calls.append(kwargs)
            return PipelineResult(idea_blocks=[], task_items=[])

        websocket, admin_events, pipeline_call_observations = await self.run_private_audio_stop(empty_handle_transcript_segment)

        self.assertEqual([call["transcript"].segment_id for call in pipeline_calls], ["42"])
        self.assertEqual([call["is_final"] for call in pipeline_calls], [True])
        self.assertEqual(pipeline_call_observations[0]["participant_types"][-1], "transcript_update")
        self.assertEqual(pipeline_call_observations[0]["participant_messages"][-1]["transcript_segment_id"], "42")
        self.assertEqual(pipeline_call_observations[0]["admin_types"][-1], "transcript")
        self.assertEqual(pipeline_call_observations[0]["admin_messages"][-1]["transcript_segment_id"], "42")

        participant_types = [message["type"] for message in websocket.sent]
        self.assertEqual(participant_types[-3:], ["transcript_update", "idea_blocks_update", "task_items_update"])
        terminal_messages = websocket.sent[-3:]
        self.assertEqual(terminal_messages[1]["idea_blocks"], [])
        self.assertEqual(terminal_messages[1]["generation_complete"], True)
        self.assertEqual(terminal_messages[1]["transcript_segment_ids"], ["42"])
        self.assertNotIn("pipeline_error", participant_types)

        admin_types = [message["type"] for message in admin_events]
        self.assertEqual(admin_types[-2:], ["transcript", "idea_blocks_update"])
        self.assertEqual(admin_events[-1]["idea_blocks"], [])
        self.assertEqual(admin_events[-1]["generation_complete"], True)
        self.assertEqual(admin_events[-1]["transcript_segment_ids"], ["42"])
        self.assertNotIn("pipeline_error", admin_types)

    async def test_gateway_admin_transcript_precedes_completion_update(self) -> None:
        pipeline_calls: list[dict] = []

        async def empty_handle_transcript_segment(*args, **kwargs):
            pipeline_calls.append(kwargs)
            return PipelineResult(idea_blocks=[], task_items=[])

        websocket, admin_events = await self.run_gateway_transcript_segment(empty_handle_transcript_segment)

        self.assertEqual([call["transcript"].segment_id for call in pipeline_calls], ["84"])
        self.assertEqual([call["is_final"] for call in pipeline_calls], [True])

        participant_types = [message["type"] for message in websocket.sent]
        self.assertIn("transcript_update", participant_types)
        self.assertIn("idea_blocks_update", participant_types)

        admin_types = [message["type"] for message in admin_events]
        self.assertEqual(admin_types[-2:], ["transcript", "idea_blocks_update"])
        self.assertEqual(admin_events[-2]["text"], "gateway final speech")
        self.assertEqual(admin_events[-2]["transcript_segment_id"], "84")
        self.assertEqual(admin_events[-2]["reason"], "silence")
        self.assertEqual(admin_events[-1]["generation_complete"], True)
        self.assertEqual(admin_events[-1]["transcript_segment_ids"], ["84"])


if __name__ == "__main__":
    unittest.main()
