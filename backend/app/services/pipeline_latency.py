from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import logger
from ..models import IdeaBlock, PipelineLatencyEvent, Transcript, TranscriptGenerationDecision
from ..task_config import resolve_task_id
from ..utils import utc_now


@dataclass(frozen=True)
class PipelineSizeContext:
    transcript_saved_at: datetime | None
    segment_cut_at: datetime | None
    meeting_elapsed_ms: int | None
    phase_elapsed_ms: int | None
    session_transcript_count_before: int | None
    session_idea_block_count_before: int | None
    participant_idea_block_count_before: int | None


@dataclass(frozen=True)
class PipelineStageRecord:
    stage: str
    duration_ms: int
    candidate_count: int | None = None
    llm_model: str | None = None
    llm_input_tokens: int | None = None
    llm_output_tokens: int | None = None
    retry_count: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class PipelineTrace:
    pipeline_run_id: str
    session_name: str
    task_name: str
    condition: str
    phase: str
    participant_id: str
    scope: str
    transcript_id: int | None
    client_segment_ids: list[str]
    transcript_chars: int
    size_context: PipelineSizeContext
    started_at: datetime
    started_perf: float
    stages: list[PipelineStageRecord] = field(default_factory=list)

    def add_stage(
        self,
        stage: str,
        started_perf: float,
        *,
        candidate_count: int | None = None,
        llm_model: str | None = None,
        llm_input_tokens: int | None = None,
        llm_output_tokens: int | None = None,
        retry_count: int = 0,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.stages.append(
            PipelineStageRecord(
                stage=stage,
                duration_ms=_duration_ms(started_perf),
                candidate_count=candidate_count,
                llm_model=llm_model,
                llm_input_tokens=llm_input_tokens,
                llm_output_tokens=llm_output_tokens,
                retry_count=retry_count,
                metadata=dict(metadata or {}),
            )
        )


async def create_pipeline_trace(
    db: AsyncSession,
    *,
    session_name: str,
    task_name: str,
    participant_id: str | int,
    scope: str,
    transcript_id: int | None,
    transcript_chars: int,
    transcript_count_in_batch: int,
    client_segment_ids: list[str] | None = None,
    segment_cut_at: datetime | None = None,
) -> PipelineTrace:
    size_context = await _load_pipeline_size_context(
        db,
        session_name=session_name,
        task_name=task_name,
        participant_id=str(participant_id),
        transcript_id=transcript_id,
        transcript_count_in_batch=transcript_count_in_batch,
        segment_cut_at=segment_cut_at,
    )
    return PipelineTrace(
        pipeline_run_id=uuid4().hex,
        session_name=session_name,
        task_name=task_name,
        condition=_infer_condition_token(session_name),
        phase="unknown",
        participant_id=str(participant_id),
        scope=scope,
        transcript_id=transcript_id,
        client_segment_ids=list(client_segment_ids or []),
        transcript_chars=transcript_chars,
        size_context=size_context,
        started_at=utc_now(),
        started_perf=time.perf_counter(),
    )


def stage_started() -> float:
    return time.perf_counter()


async def persist_pipeline_trace(
    db: AsyncSession,
    trace: PipelineTrace,
    *,
    decision: str,
    generated_idea_block_count: int = 0,
    duplicate_idea_block_count: int = 0,
    skipped_reason: str | None = None,
    error_type: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    decision_done_at = utc_now()
    try:
        db.add(
            TranscriptGenerationDecision(
                pipeline_run_id=trace.pipeline_run_id,
                session_name=trace.session_name,
                task_name=trace.task_name,
                condition=trace.condition,
                phase=trace.phase,
                participant_id=trace.participant_id,
                scope=trace.scope,
                transcript_id=trace.transcript_id,
                client_segment_ids=trace.client_segment_ids,
                segment_cut_at=trace.size_context.segment_cut_at,
                transcript_saved_at=trace.size_context.transcript_saved_at,
                decision_done_at=decision_done_at,
                cut_to_decision_ms=_datetime_delta_ms(trace.size_context.segment_cut_at, decision_done_at),
                save_to_decision_ms=_datetime_delta_ms(trace.size_context.transcript_saved_at, decision_done_at),
                decision=decision,
                generated_idea_block_count=generated_idea_block_count,
                duplicate_idea_block_count=duplicate_idea_block_count,
                transcript_chars=trace.transcript_chars,
                session_transcript_count_before=trace.size_context.session_transcript_count_before,
                session_idea_block_count_before=trace.size_context.session_idea_block_count_before,
                participant_idea_block_count_before=trace.size_context.participant_idea_block_count_before,
                skipped_reason=skipped_reason,
                error_type=error_type,
                event_metadata=dict(metadata or {}),
            )
        )
        for stage in trace.stages:
            db.add(_stage_event_model(trace, stage))
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception(
            "pipeline_latency_persist_failed pipeline_run_id=%s session_name=%s error_type=%s error=%s",
            trace.pipeline_run_id,
            trace.session_name,
            exc.__class__.__name__,
            exc,
        )


async def record_similarity_stage_event(
    db: AsyncSession,
    *,
    pipeline_run_id: str | None,
    idea_block: IdeaBlock,
    stage: str,
    started_perf: float,
    candidate_count: int | None = None,
    llm_model: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    if not pipeline_run_id:
        return
    duration_ms = _duration_ms(started_perf)
    size_context = await _load_pipeline_size_context(
        db,
        session_name=idea_block.session_name,
        task_name=idea_block.task_name,
        participant_id=str(idea_block.user_id),
        transcript_id=idea_block.transcript_id,
        transcript_count_in_batch=1,
    )
    trace = PipelineTrace(
        pipeline_run_id=pipeline_run_id,
        session_name=idea_block.session_name,
        task_name=idea_block.task_name,
        condition=_infer_condition_token(idea_block.session_name),
        phase="unknown",
        participant_id=str(idea_block.user_id),
        scope="private",
        transcript_id=idea_block.transcript_id,
        client_segment_ids=[],
        transcript_chars=len(idea_block.transcript or ""),
        size_context=size_context,
        started_at=utc_now(),
        started_perf=started_perf,
    )
    stage_record = PipelineStageRecord(
        stage=stage,
        duration_ms=duration_ms,
        candidate_count=candidate_count,
        llm_model=llm_model,
        metadata=dict(metadata or {}),
    )
    try:
        db.add(_stage_event_model(trace, stage_record))
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception(
            "pipeline_similarity_latency_persist_failed pipeline_run_id=%s idea_block_id=%s error_type=%s error=%s",
            pipeline_run_id,
            idea_block.id,
            exc.__class__.__name__,
            exc,
        )


async def record_public_now_latency_events(
    db: AsyncSession,
    *,
    session_name: str,
    participant_id: str | int,
    phase: str,
    transcript_id: int | None,
    transcript_chars: int,
    context_chars: int,
    source: str,
    event_to_state_ms: int | None,
    matching_duration_ms: int | None,
    queue_delay_ms: int | None,
    debounce_ms: int | None,
    match_count: int,
    delivered_count: int,
    target_participant_count: int,
    board_connection_count: int,
    admin_connection_count: int,
    component_ids: list[str],
    task_item_ids: list[int],
    metadata: dict[str, Any] | None = None,
) -> None:
    raw_stage_durations = [
        ("public_now_debounce_queue", queue_delay_ms),
        ("public_now_context_match", matching_duration_ms),
        ("public_now_event_to_state", event_to_state_ms),
    ]
    stage_durations: list[tuple[str, int]] = []
    for stage, duration in raw_stage_durations:
        normalized_duration = _normalize_duration_ms(duration)
        if normalized_duration is not None:
            stage_durations.append((stage, normalized_duration))
    if not stage_durations:
        return

    pipeline_run_id = uuid4().hex
    event_metadata: dict[str, Any] = {
        "source": source,
        "debounce_ms": debounce_ms,
        "event_to_state_ms": event_to_state_ms,
        "matching_duration_ms": matching_duration_ms,
        "queue_delay_ms": queue_delay_ms,
        "match_count": match_count,
        "delivered_count": delivered_count,
        "target_participant_count": target_participant_count,
        "board_connection_count": board_connection_count,
        "admin_connection_count": admin_connection_count,
        "context_chars": context_chars,
        "component_ids": component_ids,
        "task_item_ids": task_item_ids,
    }
    event_metadata.update(metadata or {})
    try:
        for stage, duration_ms in stage_durations:
            stage_metadata = dict(event_metadata)
            stage_metadata["stage_kind"] = stage
            db.add(
                PipelineLatencyEvent(
                    pipeline_run_id=pipeline_run_id,
                    session_name=session_name,
                    task_name=resolve_task_id(session_name=session_name, task_id=None),
                    condition=_infer_condition_token(session_name),
                    phase=phase or "unknown",
                    participant_id=str(participant_id),
                    scope="public",
                    transcript_id=transcript_id,
                    stage=stage,
                    duration_ms=duration_ms,
                    meeting_elapsed_ms=None,
                    phase_elapsed_ms=None,
                    transcript_chars=max(0, transcript_chars),
                    session_transcript_count_before=None,
                    session_idea_block_count_before=None,
                    participant_idea_block_count_before=None,
                    candidate_count=match_count,
                    llm_model=None,
                    llm_input_tokens=None,
                    llm_output_tokens=None,
                    retry_count=0,
                    event_metadata=stage_metadata,
                )
            )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception(
            "public_now_latency_persist_failed pipeline_run_id=%s session_name=%s error_type=%s error=%s",
            pipeline_run_id,
            session_name,
            exc.__class__.__name__,
            exc,
        )


async def record_audio_transcript_latency_events(
    db: AsyncSession,
    *,
    session_name: str,
    participant_id: str | int,
    scope: str,
    transcript_id: int | str | None,
    transcript_chars: int,
    audio_started_at: datetime | None,
    audio_ended_at: datetime | None,
    task_name: str | None = None,
    sample_rate: int | None = None,
    channels: int | None = None,
    audio_samples: int | None = None,
    audio_bytes: int | None = None,
    source: str | None = None,
    reason: str | None = None,
    client_segment_ids: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    pipeline_run_id = uuid4().hex
    normalized_transcript_id = _optional_int(transcript_id)
    try:
        transcript_saved_at = await _transcript_saved_at(db, normalized_transcript_id)
        observed_at = transcript_saved_at or utc_now()
        raw_stage_durations = [
            ("audio_segment_to_transcript_save", _datetime_delta_ms(audio_started_at, observed_at)),
            ("audio_end_to_transcript_save", _datetime_delta_ms(audio_ended_at, observed_at)),
        ]
        stage_durations: list[tuple[str, int]] = []
        for stage, duration in raw_stage_durations:
            normalized_duration = _normalize_duration_ms(duration)
            if normalized_duration is not None:
                stage_durations.append((stage, normalized_duration))
        if not stage_durations:
            return

        resolved_task_name = resolve_task_id(session_name=session_name, task_id=task_name)
        size_context = await _load_pipeline_size_context(
            db,
            session_name=session_name,
            task_name=resolved_task_name,
            participant_id=str(participant_id),
            transcript_id=normalized_transcript_id,
            transcript_count_in_batch=1,
            segment_cut_at=audio_ended_at,
        )
        audio_duration_ms = _datetime_delta_ms(audio_started_at, audio_ended_at)
        event_metadata: dict[str, Any] = {
            "source": source,
            "reason": reason,
            "audio_started_at": audio_started_at.isoformat() if audio_started_at else None,
            "audio_ended_at": audio_ended_at.isoformat() if audio_ended_at else None,
            "transcript_saved_at": transcript_saved_at.isoformat() if transcript_saved_at else None,
            "audio_duration_ms": audio_duration_ms,
            "sample_rate": sample_rate,
            "channels": channels,
            "audio_samples": audio_samples,
            "audio_bytes": audio_bytes,
            "client_segment_ids": client_segment_ids or [],
        }
        event_metadata.update(metadata or {})

        for stage, duration_ms in stage_durations:
            stage_metadata = dict(event_metadata)
            stage_metadata["stage_kind"] = stage
            db.add(
                PipelineLatencyEvent(
                    pipeline_run_id=pipeline_run_id,
                    session_name=session_name,
                    task_name=resolved_task_name,
                    condition=_infer_condition_token(session_name),
                    phase="unknown",
                    participant_id=str(participant_id),
                    scope=scope,
                    transcript_id=normalized_transcript_id,
                    stage=stage,
                    duration_ms=duration_ms,
                    meeting_elapsed_ms=size_context.meeting_elapsed_ms,
                    phase_elapsed_ms=size_context.phase_elapsed_ms,
                    transcript_chars=max(0, transcript_chars),
                    session_transcript_count_before=size_context.session_transcript_count_before,
                    session_idea_block_count_before=size_context.session_idea_block_count_before,
                    participant_idea_block_count_before=size_context.participant_idea_block_count_before,
                    candidate_count=None,
                    llm_model=None,
                    llm_input_tokens=None,
                    llm_output_tokens=None,
                    retry_count=0,
                    event_metadata=stage_metadata,
                )
            )
        await db.commit()
    except Exception as exc:
        rollback = getattr(db, "rollback", None)
        if callable(rollback):
            await rollback()
        logger.exception(
            "audio_transcript_latency_persist_failed pipeline_run_id=%s session_name=%s transcript_id=%s error_type=%s error=%s",
            pipeline_run_id,
            session_name,
            normalized_transcript_id,
            exc.__class__.__name__,
            exc,
        )


def pipeline_decision(generated_count: int, duplicate_count: int, *, raw_generated_count: int = 0) -> str:
    if generated_count > 0:
        return "generated"
    if duplicate_count > 0:
        return "duplicate_only"
    if raw_generated_count <= 0:
        return "llm_zero_blocks"
    return "duplicate_only"


def _stage_event_model(trace: PipelineTrace, stage: PipelineStageRecord) -> PipelineLatencyEvent:
    return PipelineLatencyEvent(
        pipeline_run_id=trace.pipeline_run_id,
        session_name=trace.session_name,
        task_name=trace.task_name,
        condition=trace.condition,
        phase=trace.phase,
        participant_id=trace.participant_id,
        scope=trace.scope,
        transcript_id=trace.transcript_id,
        stage=stage.stage,
        duration_ms=stage.duration_ms,
        meeting_elapsed_ms=trace.size_context.meeting_elapsed_ms,
        phase_elapsed_ms=trace.size_context.phase_elapsed_ms,
        transcript_chars=trace.transcript_chars,
        session_transcript_count_before=trace.size_context.session_transcript_count_before,
        session_idea_block_count_before=trace.size_context.session_idea_block_count_before,
        participant_idea_block_count_before=trace.size_context.participant_idea_block_count_before,
        candidate_count=stage.candidate_count,
        llm_model=stage.llm_model,
        llm_input_tokens=stage.llm_input_tokens,
        llm_output_tokens=stage.llm_output_tokens,
        retry_count=stage.retry_count,
        event_metadata=stage.metadata,
    )


async def _load_pipeline_size_context(
    db: AsyncSession,
    *,
    session_name: str,
    task_name: str,
    participant_id: str,
    transcript_id: int | None,
    transcript_count_in_batch: int,
    segment_cut_at: datetime | None = None,
) -> PipelineSizeContext:
    transcript_saved_at: datetime | None = None
    if transcript_id is not None:
        transcript = await db.get(Transcript, transcript_id)
        transcript_saved_at = transcript.time_stamp if transcript else None

    first_transcript_at = (
        await db.execute(select(func.min(Transcript.time_stamp)).where(Transcript.session_name == session_name))
    ).scalar_one_or_none()
    session_transcript_count = int(
        (
            await db.execute(select(func.count(Transcript.id)).where(Transcript.session_name == session_name))
        ).scalar_one()
        or 0
    )
    session_idea_block_count = int(
        (
            await db.execute(
                select(func.count(IdeaBlock.id)).where(
                    IdeaBlock.session_name == session_name,
                    IdeaBlock.task_name == task_name,
                )
            )
        ).scalar_one()
        or 0
    )
    participant_idea_block_count = int(
        (
            await db.execute(
                select(func.count(IdeaBlock.id)).where(
                    IdeaBlock.session_name == session_name,
                    IdeaBlock.task_name == task_name,
                    IdeaBlock.user_id == _participant_id_to_int(participant_id),
                )
            )
        ).scalar_one()
        or 0
    )
    meeting_elapsed_ms = _datetime_delta_ms(first_transcript_at, transcript_saved_at)
    return PipelineSizeContext(
        transcript_saved_at=transcript_saved_at,
        segment_cut_at=segment_cut_at or transcript_saved_at,
        meeting_elapsed_ms=meeting_elapsed_ms,
        phase_elapsed_ms=None,
        session_transcript_count_before=max(0, session_transcript_count - max(0, transcript_count_in_batch)),
        session_idea_block_count_before=session_idea_block_count,
        participant_idea_block_count_before=participant_idea_block_count,
    )


def _duration_ms(started_perf: float) -> int:
    return max(0, round((time.perf_counter() - started_perf) * 1000))


def _normalize_duration_ms(value: int | None) -> int | None:
    if value is None:
        return None
    return max(0, int(value))


async def _transcript_saved_at(db: AsyncSession, transcript_id: int | None) -> datetime | None:
    if transcript_id is None:
        return None
    transcript = await db.get(Transcript, transcript_id)
    return transcript.time_stamp if transcript else None


def _datetime_delta_ms(started_at: datetime | None, ended_at: datetime | None) -> int | None:
    if started_at is None or ended_at is None:
        return None
    return max(0, round((ended_at - started_at).total_seconds() * 1000))


def _optional_int(value: int | str | None) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _participant_id_to_int(participant_id: str) -> int:
    try:
        return int(participant_id)
    except (TypeError, ValueError):
        return 0


def _infer_condition_token(session_name: str) -> str:
    session_key = session_name.lower().replace("-", "_")
    if "no_cue" in session_key or "nocue" in session_key or "control" in session_key:
        return "no_cue"
    if "with_cue" in session_key or "withcue" in session_key or "experimental" in session_key:
        return "with_cue"
    return "unknown"
