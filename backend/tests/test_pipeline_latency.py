from datetime import datetime, timezone
from types import SimpleNamespace
import unittest

from app.services.pipeline_latency import pipeline_decision
from app.services.task_export_service import (
    ExportCondition,
    ExportContext,
    _pipeline_latency_events_file,
    _pipeline_latency_status,
    _transcript_generation_decisions_file,
)


def _context() -> ExportContext:
    generated_at = datetime(2026, 6, 13, 3, 0, tzinfo=timezone.utc)
    return ExportContext(
        session_name="lost-at-sea-G1-with-cue",
        group_id="G1",
        group_token="G1",
        task_id="lost-at-sea",
        task_token="lost_at_sea",
        condition=ExportCondition("experimental", True, "with_cue", "test"),
        generated_at=generated_at,
        package_root="package",
    )


class PipelineLatencyTests(unittest.TestCase):
    def test_pipeline_decision_classifies_generation_outcomes(self) -> None:
        self.assertEqual(pipeline_decision(1, 0, raw_generated_count=1), "generated")
        self.assertEqual(pipeline_decision(0, 2, raw_generated_count=2), "duplicate_only")
        self.assertEqual(pipeline_decision(0, 0, raw_generated_count=0), "llm_zero_blocks")
        self.assertEqual(pipeline_decision(0, 0, raw_generated_count=2), "duplicate_only")

    def test_decision_export_has_latency_columns_without_raw_text(self) -> None:
        timestamp = datetime(2026, 6, 13, 3, 1, tzinfo=timezone.utc)
        decision = SimpleNamespace(
            session_name="lost-at-sea-G1-with-cue",
            condition="with_cue",
            phase="unknown",
            participant_id="5",
            scope="private",
            transcript_id=7569,
            client_segment_ids=["client-1"],
            segment_cut_at=timestamp,
            transcript_saved_at=timestamp,
            decision_done_at=timestamp,
            cut_to_decision_ms=4830,
            save_to_decision_ms=4750,
            decision="generated",
            generated_idea_block_count=3,
            duplicate_idea_block_count=0,
            transcript_chars=128,
            session_transcript_count_before=388,
            session_idea_block_count_before=217,
            participant_idea_block_count_before=42,
            skipped_reason=None,
            error_type=None,
            pipeline_run_id="run-1",
            event_metadata={"raw_generated_idea_block_count": 3},
            created_at=timestamp,
        )

        export_file = _transcript_generation_decisions_file(_context(), {"5": "participant"}, [decision], [])

        self.assertIn("cut_to_decision_ms", export_file.content)
        self.assertIn("save_to_decision_ms", export_file.content)
        self.assertIn("G1P5", export_file.content)
        self.assertIn("run-1", export_file.content)
        self.assertNotIn("transcript_text", export_file.content)
        self.assertNotIn("raw transcript", export_file.content.lower())

    def test_stage_export_has_scaling_context_without_raw_text(self) -> None:
        timestamp = datetime(2026, 6, 13, 3, 2, tzinfo=timezone.utc)
        event = SimpleNamespace(
            pipeline_run_id="run-1",
            session_name="lost-at-sea-G1-with-cue",
            condition="with_cue",
            phase="private",
            participant_id="5",
            scope="private",
            transcript_id=7569,
            stage="similarity_llm_compare",
            duration_ms=842,
            meeting_elapsed_ms=3512000,
            phase_elapsed_ms=923000,
            transcript_chars=128,
            session_transcript_count_before=388,
            session_idea_block_count_before=217,
            participant_idea_block_count_before=42,
            candidate_count=31,
            llm_model="gpt-test",
            llm_input_tokens=1800,
            llm_output_tokens=120,
            retry_count=0,
            event_metadata={"candidate_ids": [1, 2]},
            created_at=timestamp,
        )

        export_file = _pipeline_latency_events_file(_context(), {"5": "participant"}, [event], [])

        self.assertIn("meeting_elapsed_ms", export_file.content)
        self.assertIn("session_idea_block_count_before", export_file.content)
        self.assertIn("similarity_llm_compare", export_file.content)
        self.assertIn("gpt-test", export_file.content)
        self.assertNotIn("transcript_text", export_file.content)

    def test_pipeline_latency_checklist_status(self) -> None:
        self.assertEqual(_pipeline_latency_status([object()], [object()]), "present")
        self.assertEqual(_pipeline_latency_status([object()], []), "partial")
        self.assertEqual(_pipeline_latency_status([], []), "missing")


if __name__ == "__main__":
    unittest.main()
