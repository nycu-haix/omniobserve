import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest

from app.services.task_export_service import (
    ExportCondition,
    ExportContext,
    _build_checklist,
    _build_data_files,
    _idea_block_source_metadata,
    _private_reasoning_capture_files,
    _transcript_files,
)


def _context() -> ExportContext:
    generated_at = datetime(2026, 6, 13, 3, 0, tzinfo=timezone.utc)
    return ExportContext(
        session_name="lost-at-sea-G1-no-cue",
        group_id="G1",
        group_token="G1",
        task_id="lost-at-sea",
        task_token="lost_at_sea",
        condition=ExportCondition("control", False, "no_cue", "test"),
        generated_at=generated_at,
        package_root="package",
    )


def _phase_windows() -> list[dict[str, object]]:
    private_started = datetime(2026, 6, 13, 3, 0, tzinfo=timezone.utc)
    private_ended = private_started + timedelta(minutes=8)
    return [
        {
            "phase": "private",
            "started_at": private_started.isoformat().replace("+00:00", "Z"),
            "ended_at": private_ended.isoformat().replace("+00:00", "Z"),
            "started_at_dt": private_started,
            "ended_at_dt": private_ended,
            "start_source": "test",
            "end_source": "test",
            "next_phase": "group",
            "snapshot_count": 1,
            "snapshot_ids": [101],
        },
        {
            "phase": "group",
            "started_at": private_ended.isoformat().replace("+00:00", "Z"),
            "ended_at": "",
            "started_at_dt": private_ended,
            "ended_at_dt": None,
            "start_source": "test",
            "end_source": "missing",
            "next_phase": "",
            "snapshot_count": 0,
            "snapshot_ids": [],
        },
    ]


def _participants() -> list[dict[str, object]]:
    return [
        {
            "system_id": "1",
            "participant_code": "G1P1",
            "display_name": "P1",
            "participant_role": "participant",
            "participant_analysis_included": True,
            "sources": ["idea_block"],
        }
    ]


def _typed_block() -> SimpleNamespace:
    return SimpleNamespace(
        id=42,
        user_id=1,
        session_name="lost-at-sea-G1-no-cue",
        task_name="lost-at-sea",
        time_stamp=datetime(2026, 6, 13, 3, 3, tzinfo=timezone.utc),
        title="Water first",
        summary="Put water first because dehydration is the fastest risk.",
        transcript_id=None,
        transcript_links=[],
        task_items=[],
        poster_task_items=[],
        main_transcript=None,
        similarity_id=None,
        is_deleted=False,
        transcript=None,
    )


class TaskExportPrivateReasoningCaptureTests(unittest.TestCase):
    def test_text_idea_block_source_metadata_matches_data_spec(self) -> None:
        block = SimpleNamespace(id=42)

        source_type, source_ref = _idea_block_source_metadata(block, [])

        self.assertEqual(source_type, "text")
        self.assertEqual(source_ref, "idea_block:42")

    def test_typed_only_idea_block_exports_private_reasoning_jsonl(self) -> None:
        block = _typed_block()

        files = _private_reasoning_capture_files(
            _context(),
            {"1": "participant"},
            _participants(),
            transcripts=[],
            idea_blocks=[block],
            phase_windows=_phase_windows(),
        )

        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].artifact, "private_reasoning_capture")
        self.assertTrue(files[0].required)
        self.assertEqual(files[0].record_count, 1)
        row = json.loads(files[0].content)
        self.assertEqual(row["participant_id"], "1")
        self.assertEqual(row["participant_code"], "G1P1")
        self.assertEqual(row["capture_mode"], "text")
        self.assertEqual(row["source_ref"], "idea_block:42")
        self.assertIn("dehydration", row["content"])

    def test_checklist_uses_private_reasoning_capture_not_private_transcript(self) -> None:
        block = _typed_block()
        files = _build_data_files(
            context=_context(),
            participant_roles={"1": "participant"},
            participants=_participants(),
            transcripts=[],
            chat_messages=[],
            idea_blocks=[block],
            similarities=[],
            cue_events=[],
            pipeline_decisions=[],
            pipeline_latency_events=[],
            ranking_snapshots=[],
            phase_task_snapshots=[],
            phase_windows=_phase_windows(),
        )

        checklist = _build_checklist(
            context=_context(),
            files=files,
            participant_roles={"1": "participant"},
            participant_count=1,
            ranking_snapshots=[],
            transcripts=[],
            chat_messages=[],
            idea_blocks=[block],
            similarities=[],
            cue_events=[],
            pipeline_decisions=[],
            pipeline_latency_events=[],
            phase_task_snapshots=[],
            phase_windows=_phase_windows(),
        )

        private_capture = next(item for item in checklist if item["key"] == "private_reasoning_capture")
        self.assertEqual(private_capture["status"], "present")
        self.assertEqual(private_capture["count"], 1)
        self.assertTrue(any(path.endswith("_private_reasoning_capture_G1P1.jsonl") for path in private_capture["files"]))
        self.assertFalse(any(item["key"] == "private_transcripts" for item in checklist))
        self.assertFalse(any(file.artifact == "private_transcript" for file in files))

    def test_private_transcript_remains_optional_diagnostic_file(self) -> None:
        created_at = datetime(2026, 6, 13, 3, 3, tzinfo=timezone.utc)
        transcript = SimpleNamespace(
            id=88,
            user_id=1,
            session_name="lost-at-sea-G1-no-cue",
            display_name="P1",
            visibility="private",
            time_stamp=created_at,
            transcript="I am comparing water and food.",
        )

        files = _transcript_files(
            _context(),
            {"1": "participant"},
            _participants(),
            [transcript],
            _phase_windows(),
        )
        private_transcript = next(file for file in files if file.artifact == "private_transcript")

        self.assertFalse(private_transcript.required)


if __name__ == "__main__":
    unittest.main()
