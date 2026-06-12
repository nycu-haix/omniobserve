from __future__ import annotations

import csv
import io
import json
import os
import re
import subprocess
import zipfile
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..models import (
    ChatMessage,
    IdeaBlock,
    IdeaBlockToTranscript,
    PhaseTaskItemSnapshot,
    RankingPhaseSnapshot,
    Similarity,
    SimilarityCueEvent,
    Transcript,
)
from ..task_config import get_task_phases_for_session, resolve_task_id
from .participant_roles import OBSERVER_ROLE, PARTICIPANT_ROLE, list_session_participant_roles, normalize_participant_role

TASK_EXPORT_SCHEMA_VERSION = 1
APP_VERSION = "0.1.0"
TASK_TOKEN_BY_ID = {
    "lost-at-sea": "lost_at_sea",
    "enhance-the-poster": "enhance_poster",
}
VERSION_ENV_KEYS = (
    "OMNIOBSERVE_VERSION",
    "OMNIOBSERVE_COMMIT_SHA",
    "GIT_COMMIT",
    "SOURCE_COMMIT",
    "COMMIT_SHA",
    "DOKPLOY_COMMIT_SHA",
    "RENDER_GIT_COMMIT",
)


@dataclass(frozen=True)
class TaskExportFile:
    path: str
    artifact: str
    scope: str
    record_count: int
    required: bool
    media_type: str
    content: str | bytes


@dataclass(frozen=True)
class TaskExportBundle:
    filename: str
    zip_bytes: bytes
    manifest: dict[str, Any]


@dataclass(frozen=True)
class ExportCondition:
    condition: str
    cue_enabled: bool
    token: str
    source: str


@dataclass(frozen=True)
class ExportContext:
    session_name: str
    group_id: str
    group_token: str
    task_id: str
    task_token: str
    condition: ExportCondition
    generated_at: datetime
    package_root: str


async def build_task_export_bundle(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str | None = None,
    cue_condition: str | None = None,
) -> TaskExportBundle:
    resolved_task_id = resolve_task_id(
        session_name=session_name,
        task_id=_normalize_task_id(task_id),
    )
    ranking_snapshots = await _load_ranking_phase_snapshots(
        db,
        session_name=session_name,
        task_id=resolved_task_id,
    )
    condition = _resolve_export_condition(
        session_name=session_name,
        snapshots=ranking_snapshots,
        cue_condition=cue_condition,
    )
    group_id = _resolve_group_id(session_name=session_name, task_id=resolved_task_id)
    generated_at = _utc_now()
    context = ExportContext(
        session_name=session_name,
        group_id=group_id,
        group_token=_file_token(group_id, preserve_case=True),
        task_id=resolved_task_id,
        task_token=TASK_TOKEN_BY_ID.get(resolved_task_id, _file_token(resolved_task_id)),
        condition=condition,
        generated_at=generated_at,
        package_root=(
            f"{generated_at.date().isoformat()}_"
            f"{_file_token(group_id, preserve_case=True)}_"
            f"{TASK_TOKEN_BY_ID.get(resolved_task_id, _file_token(resolved_task_id))}_"
            f"{condition.token}"
        ),
    )

    transcripts = await _load_transcripts(db, session_name=session_name)
    chat_messages = await _load_chat_messages(db, session_name=session_name)
    idea_blocks = await _load_idea_blocks(
        db,
        session_name=session_name,
        task_id=resolved_task_id,
    )
    phase_task_snapshots = await _load_phase_task_item_snapshots(
        db,
        session_name=session_name,
        task_id=resolved_task_id,
    )
    similarities = await _load_task_similarities(db, idea_blocks=idea_blocks)
    cue_events = await _load_task_cue_events(
        db,
        session_name=session_name,
        task_id=resolved_task_id,
        similarities=similarities,
    )
    participant_roles = await list_session_participant_roles(db, session_name=session_name)

    phase_windows = _build_phase_windows(
        context=context,
        ranking_snapshots=ranking_snapshots,
    )
    participants = _collect_participants(
        context=context,
        participant_roles=participant_roles,
        transcripts=transcripts,
        chat_messages=chat_messages,
        idea_blocks=idea_blocks,
        ranking_snapshots=ranking_snapshots,
    )
    files = _build_data_files(
        context=context,
        participant_roles=participant_roles,
        participants=participants,
        transcripts=transcripts,
        chat_messages=chat_messages,
        idea_blocks=idea_blocks,
        similarities=similarities,
        cue_events=cue_events,
        ranking_snapshots=ranking_snapshots,
        phase_task_snapshots=phase_task_snapshots,
        phase_windows=phase_windows,
    )

    summary_placeholder = TaskExportFile(
        path=_package_path(context, f"{_artifact_prefix(context)}_session_summary_group.md"),
        artifact="session_summary",
        scope="group",
        record_count=1,
        required=False,
        media_type="text/markdown",
        content="",
    )
    manifest_placeholder = TaskExportFile(
        path=_package_path(context, f"{_artifact_prefix(context)}_manifest.json"),
        artifact="manifest",
        scope="group",
        record_count=1,
        required=True,
        media_type="application/json",
        content="",
    )
    files_with_placeholders = [*files, summary_placeholder, manifest_placeholder]
    manifest = _build_manifest(
        context=context,
        files=files_with_placeholders,
        participant_roles=participant_roles,
        participants=participants,
        ranking_snapshots=ranking_snapshots,
        transcripts=transcripts,
        chat_messages=chat_messages,
        idea_blocks=idea_blocks,
        similarities=similarities,
        cue_events=cue_events,
        phase_task_snapshots=phase_task_snapshots,
        phase_windows=phase_windows,
    )
    summary_file = replace(
        summary_placeholder,
        content=_build_session_summary_markdown(manifest),
    )
    manifest_file = replace(
        manifest_placeholder,
        content=_json_dumps(manifest),
    )
    final_files = [*files, summary_file, manifest_file]

    zip_bytes = _build_zip_bytes(final_files)
    return TaskExportBundle(
        filename=f"{context.package_root}_task_package.zip",
        zip_bytes=zip_bytes,
        manifest=manifest,
    )


async def _load_ranking_phase_snapshots(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
) -> list[RankingPhaseSnapshot]:
    result = await db.execute(
        select(RankingPhaseSnapshot)
        .options(selectinload(RankingPhaseSnapshot.items))
        .where(
            RankingPhaseSnapshot.session_name == session_name,
            RankingPhaseSnapshot.task_id == task_id,
        )
        .order_by(RankingPhaseSnapshot.created_at.asc(), RankingPhaseSnapshot.id.asc())
    )
    return list(result.scalars().all())


async def _load_phase_task_item_snapshots(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
) -> list[PhaseTaskItemSnapshot]:
    result = await db.execute(
        select(PhaseTaskItemSnapshot)
        .options(selectinload(PhaseTaskItemSnapshot.items))
        .where(
            PhaseTaskItemSnapshot.session_name == session_name,
            PhaseTaskItemSnapshot.task_id == task_id,
        )
        .order_by(PhaseTaskItemSnapshot.created_at.asc(), PhaseTaskItemSnapshot.id.asc())
    )
    return list(result.scalars().all())


async def _load_transcripts(db: AsyncSession, *, session_name: str) -> list[Transcript]:
    result = await db.execute(
        select(Transcript)
        .where(Transcript.session_name == session_name)
        .order_by(Transcript.time_stamp.asc(), Transcript.id.asc())
    )
    return list(result.scalars().all())


async def _load_chat_messages(db: AsyncSession, *, session_name: str) -> list[ChatMessage]:
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.session_name == session_name)
        .order_by(ChatMessage.time_stamp.asc(), ChatMessage.id.asc())
    )
    return list(result.scalars().all())


async def _load_idea_blocks(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
) -> list[IdeaBlock]:
    result = await db.execute(
        select(IdeaBlock)
        .options(
            selectinload(IdeaBlock.main_transcript),
            selectinload(IdeaBlock.task_items),
            selectinload(IdeaBlock.poster_task_items),
            selectinload(IdeaBlock.transcript_links).selectinload(IdeaBlockToTranscript.transcript),
        )
        .where(
            IdeaBlock.session_name == session_name,
            IdeaBlock.task_name == task_id,
        )
        .order_by(IdeaBlock.time_stamp.asc(), IdeaBlock.id.asc())
    )
    return list(result.scalars().all())


async def _load_task_similarities(
    db: AsyncSession,
    *,
    idea_blocks: list[IdeaBlock],
) -> list[Similarity]:
    idea_block_ids = [block.id for block in idea_blocks]
    if not idea_block_ids:
        return []
    result = await db.execute(
        select(Similarity)
        .where(
            Similarity.idea_block_id_1.in_(idea_block_ids),
            Similarity.idea_block_id_2.in_(idea_block_ids),
        )
        .order_by(Similarity.id.asc())
    )
    return list(result.scalars().all())


async def _load_task_cue_events(
    db: AsyncSession,
    *,
    session_name: str,
    task_id: str,
    similarities: list[Similarity],
) -> list[SimilarityCueEvent]:
    similarity_ids = [similarity.id for similarity in similarities]
    stmt = select(SimilarityCueEvent).where(
        SimilarityCueEvent.session_name == session_name,
        SimilarityCueEvent.task_id == task_id,
    )
    if similarity_ids:
        stmt = stmt.where(
            (SimilarityCueEvent.similarity_id.is_(None))
            | (SimilarityCueEvent.similarity_id.in_(similarity_ids))
        )
    result = await db.execute(
        stmt.order_by(SimilarityCueEvent.created_at.asc(), SimilarityCueEvent.id.asc())
    )
    return list(result.scalars().all())


def _build_data_files(
    *,
    context: ExportContext,
    participant_roles: dict[str, str],
    participants: list[dict[str, Any]],
    transcripts: list[Transcript],
    chat_messages: list[ChatMessage],
    idea_blocks: list[IdeaBlock],
    similarities: list[Similarity],
    cue_events: list[SimilarityCueEvent],
    ranking_snapshots: list[RankingPhaseSnapshot],
    phase_task_snapshots: list[PhaseTaskItemSnapshot],
    phase_windows: list[dict[str, Any]],
) -> list[TaskExportFile]:
    files: list[TaskExportFile] = []
    files.append(_participant_mapping_file(context, participants))
    files.extend(_ranking_snapshot_files(context, ranking_snapshots, participant_roles))
    files.extend(_phase_task_item_snapshot_files(context, phase_task_snapshots, participant_roles))
    files.extend(_transcript_files(context, participant_roles, participants, transcripts, phase_windows))
    files.append(_idea_blocks_file(context, participant_roles, idea_blocks, phase_windows))
    files.append(_public_chat_file(context, participant_roles, chat_messages, phase_windows))
    files.extend(_cue_files(context, idea_blocks, similarities, cue_events, phase_windows))
    files.append(_phase_timestamps_file(context, phase_windows))
    return files


def _participant_mapping_file(
    context: ExportContext,
    participants: list[dict[str, Any]],
) -> TaskExportFile:
    headers = [
        "system_id",
        "participant_code",
        "display_name",
        "participant_role",
        "participant_analysis_included",
        "group_id",
        "sources",
        "research_code_inferred",
        "notes",
    ]
    rows = [
        {
            "system_id": participant["system_id"],
            "participant_code": participant["participant_code"],
            "display_name": participant.get("display_name") or "",
            "participant_role": participant.get("participant_role") or PARTICIPANT_ROLE,
            "participant_analysis_included": participant.get("participant_analysis_included", True),
            "group_id": context.group_id,
            "sources": ";".join(participant.get("sources") or []),
            "research_code_inferred": "true",
            "notes": "Generated from system participant id. Confirm against the private formal-study mapping table.",
        }
        for participant in participants
    ]
    filename = f"{context.group_token}_all_all_participant_mapping_internal.csv"
    return TaskExportFile(
        path=_package_path(context, filename),
        artifact="participant_mapping_internal",
        scope="internal",
        record_count=len(rows),
        required=False,
        media_type="text/csv",
        content=_csv_content(headers, rows),
    )


def _ranking_snapshot_files(
    context: ExportContext,
    snapshots: list[RankingPhaseSnapshot],
    participant_roles: dict[str, str],
) -> list[TaskExportFile]:
    files: list[TaskExportFile] = []
    latest_snapshots = _latest_ranking_snapshots(snapshots)
    headers = _ranking_snapshot_headers()

    all_rows = [
        row
        for snapshot in snapshots
        for row in _ranking_snapshot_rows(context, snapshot, participant_roles)
    ]
    files.append(
        TaskExportFile(
            path=_package_path(context, f"{_artifact_prefix(context)}_ranking_snapshots_all.csv"),
            artifact="ranking_snapshots_all",
            scope="all",
            record_count=len(all_rows),
            required=True,
            media_type="text/csv",
            content=_csv_content(headers, all_rows),
        )
    )

    for snapshot in latest_snapshots:
        artifact = _ranking_artifact_name(snapshot, participant_roles)
        subject = _snapshot_subject_token(context, snapshot, participant_roles)
        filename = f"{_artifact_prefix(context)}_{artifact}_{subject}.csv"
        rows = _ranking_snapshot_rows(context, snapshot, participant_roles)
        files.append(
            TaskExportFile(
                path=_package_path(context, filename),
                artifact=artifact,
                scope="diagnostic" if artifact == "observer_ranking_diagnostic" else snapshot.scope,
                record_count=len(rows),
                required=artifact in {"initial_ranking", "group_ranking", "final_ranking"},
                media_type="text/csv",
                content=_csv_content(headers, rows),
            )
        )
    return files


def _phase_task_item_snapshot_files(
    context: ExportContext,
    snapshots: list[PhaseTaskItemSnapshot],
    participant_roles: dict[str, str],
) -> list[TaskExportFile]:
    if not snapshots:
        return []
    latest_snapshot = sorted(snapshots, key=lambda item: (_sort_datetime(item.created_at), item.id))[-1]
    headers = [
        "snapshot_id",
        "session_name",
        "group_id",
        "task",
        "condition",
        "from_phase",
        "to_phase",
        "snapshot_created_at",
        "position",
        "snapshot_item_id",
        "representative_private_phase_task_item_id",
        "component_id",
        "component_label",
        "action_id",
        "action_label",
        "detail",
        "statement",
        "source_user_ids",
        "source_participant_codes",
        "source_participant_roles",
        "source_priorities",
    ]
    rows = [
        {
            "snapshot_id": latest_snapshot.id,
            "session_name": context.session_name,
            "group_id": context.group_id,
            "task": context.task_token,
            "condition": context.condition.token,
            "from_phase": latest_snapshot.from_phase,
            "to_phase": latest_snapshot.to_phase,
            "snapshot_created_at": _isoformat(latest_snapshot.created_at),
            "position": item.position,
            "snapshot_item_id": f"snapshot-item:{item.id}",
            "representative_private_phase_task_item_id": item.representative_private_phase_task_item_id,
            "component_id": item.component_id,
            "component_label": item.component_label,
            "action_id": item.action_id,
            "action_label": item.action_label,
            "detail": item.detail,
            "statement": item.statement,
            "source_user_ids": item.source_user_ids,
            "source_participant_codes": [
                _participant_code(context.group_id, str(user_id))
                for user_id in item.source_user_ids
                if _is_real_participant_id(user_id)
            ],
            "source_participant_roles": [
                _participant_role_for_id(participant_roles, user_id)
                for user_id in item.source_user_ids
                if _is_real_participant_id(user_id)
            ],
            "source_priorities": item.source_priorities,
        }
        for item in latest_snapshot.items
    ]
    return [
        TaskExportFile(
            path=_package_path(context, f"{_artifact_prefix(context)}_private_phase_item_pool_all.csv"),
            artifact="private_phase_item_pool",
            scope="all",
            record_count=len(rows),
            required=False,
            media_type="text/csv",
            content=_csv_content(headers, rows),
        )
    ]


def _transcript_files(
    context: ExportContext,
    participant_roles: dict[str, str],
    participants: list[dict[str, Any]],
    transcripts: list[Transcript],
    phase_windows: list[dict[str, Any]],
) -> list[TaskExportFile]:
    files: list[TaskExportFile] = []
    private_by_participant: dict[str, list[Transcript]] = {
        participant["system_id"]: []
        for participant in participants
        if participant.get("participant_analysis_included", True)
    }
    public_transcripts: list[Transcript] = []
    for transcript in transcripts:
        if transcript.visibility == "public":
            public_transcripts.append(transcript)
        elif _is_analysis_participant_id(participant_roles, transcript.user_id):
            private_by_participant.setdefault(str(transcript.user_id), []).append(transcript)

    for participant_id, participant_transcripts in sorted(private_by_participant.items(), key=lambda entry: _participant_sort_key(entry[0])):
        if not participant_transcripts:
            continue
        participant_token = _participant_code(context.group_id, participant_id)
        filename = f"{_artifact_prefix(context)}_private_transcript_{participant_token}.txt"
        files.append(
            TaskExportFile(
                path=_package_path(context, filename),
                artifact="private_transcript",
                scope="participant",
                record_count=len(participant_transcripts),
                required=True,
                media_type="text/plain",
                content=_transcript_text(context, participant_roles, participant_transcripts, phase_windows),
            )
        )

    files.append(
        TaskExportFile(
            path=_package_path(context, f"{_artifact_prefix(context)}_public_transcript_group.txt"),
            artifact="public_transcript",
            scope="group",
            record_count=len(public_transcripts),
            required=True,
            media_type="text/plain",
            content=_transcript_text(context, participant_roles, public_transcripts, phase_windows),
        )
    )
    return files


def _idea_blocks_file(
    context: ExportContext,
    participant_roles: dict[str, str],
    idea_blocks: list[IdeaBlock],
    phase_windows: list[dict[str, Any]],
) -> TaskExportFile:
    headers = [
        "idea_block_id",
        "session_name",
        "group_id",
        "task",
        "condition",
        "phase",
        "participant_id",
        "participant_code",
        "participant_role",
        "participant_analysis_included",
        "created_at",
        "title",
        "summary",
        "is_deleted",
        "source_type",
        "source_ref",
        "transcript_id",
        "transcript_visibility",
        "transcript_text",
        "linked_transcript_ids",
        "task_item_ids",
        "poster_component_ids",
        "poster_action_ids",
        "similarity_id",
    ]
    rows = []
    for block in idea_blocks:
        transcript_ids = _idea_block_transcript_ids(block)
        source_type = "speech" if transcript_ids else "unknown"
        source_ref = ";".join(f"transcript:{transcript_id}" for transcript_id in transcript_ids)
        phase = _infer_phase_for_timestamp(block.time_stamp, phase_windows)
        rows.append(
            {
                "idea_block_id": block.id,
                "session_name": context.session_name,
                "group_id": context.group_id,
                "task": context.task_token,
                "condition": context.condition.token,
                "phase": phase,
                "participant_id": block.user_id,
                "participant_code": _participant_code(context.group_id, str(block.user_id)),
                "participant_role": _participant_role_for_id(participant_roles, block.user_id),
                "participant_analysis_included": _is_analysis_participant_id(participant_roles, block.user_id),
                "created_at": _isoformat(block.time_stamp),
                "title": block.title,
                "summary": block.summary,
                "is_deleted": block.is_deleted,
                "source_type": source_type,
                "source_ref": source_ref,
                "transcript_id": block.transcript_id,
                "transcript_visibility": block.main_transcript.visibility if block.main_transcript else "",
                "transcript_text": block.transcript,
                "linked_transcript_ids": transcript_ids,
                "task_item_ids": [item.task_item_id for item in block.task_items],
                "poster_component_ids": [item.component_id for item in block.poster_task_items],
                "poster_action_ids": [item.action_id for item in block.poster_task_items],
                "similarity_id": block.similarity_id,
            }
        )
    return TaskExportFile(
        path=_package_path(context, f"{_artifact_prefix(context)}_idea_blocks_all.csv"),
        artifact="idea_blocks",
        scope="all",
        record_count=len(rows),
        required=True,
        media_type="text/csv",
        content=_csv_content(headers, rows),
    )


def _public_chat_file(
    context: ExportContext,
    participant_roles: dict[str, str],
    chat_messages: list[ChatMessage],
    phase_windows: list[dict[str, Any]],
) -> TaskExportFile:
    headers = [
        "chat_message_id",
        "session_name",
        "group_id",
        "task",
        "condition",
        "phase",
        "participant_id",
        "participant_code",
        "participant_role",
        "participant_analysis_included",
        "display_name",
        "timestamp",
        "message",
        "is_deleted",
    ]
    rows = [
        {
            "chat_message_id": message.id,
            "session_name": context.session_name,
            "group_id": context.group_id,
            "task": context.task_token,
            "condition": context.condition.token,
            "phase": _infer_phase_for_timestamp(message.time_stamp, phase_windows),
            "participant_id": message.user_id,
            "participant_code": _participant_code(context.group_id, str(message.user_id)) if _is_real_participant_id(message.user_id) else "admin",
            "participant_role": _participant_role_for_id(participant_roles, message.user_id) if _is_real_participant_id(message.user_id) else "admin",
            "participant_analysis_included": _is_analysis_participant_id(participant_roles, message.user_id) if _is_real_participant_id(message.user_id) else False,
            "display_name": message.display_name,
            "timestamp": _isoformat(message.time_stamp),
            "message": message.message,
            "is_deleted": message.is_deleted,
        }
        for message in chat_messages
    ]
    return TaskExportFile(
        path=_package_path(context, f"{_artifact_prefix(context)}_public_chat_group.csv"),
        artifact="public_chat",
        scope="group",
        record_count=len(rows),
        required=True,
        media_type="text/csv",
        content=_csv_content(headers, rows),
    )


def _cue_files(
    context: ExportContext,
    idea_blocks: list[IdeaBlock],
    similarities: list[Similarity],
    cue_events: list[SimilarityCueEvent],
    phase_windows: list[dict[str, Any]],
) -> list[TaskExportFile]:
    idea_by_id = {block.id: block for block in idea_blocks}
    headers = [
        "event_id",
        "cue_id",
        "event_type",
        "source",
        "session_name",
        "group_id",
        "task",
        "condition",
        "cue_enabled",
        "phase",
        "cue_type",
        "sender_participant_id",
        "sender_code",
        "recipient_participant_id",
        "recipient_code",
        "similarity_id",
        "own_idea_block_id",
        "own_participant_id",
        "own_participant_code",
        "other_idea_block_id",
        "other_participant_id",
        "other_participant_code",
        "reason",
        "delivery_status",
        "response_status",
        "created_at",
        "delivered_at",
        "shown_at",
        "responded_at",
        "accepted_at",
        "ignored_at",
        "dismissed_at",
        "shared_at",
        "updated_at",
        "metadata",
        "notes",
    ]
    rows = []
    if context.condition.cue_enabled or cue_events:
        if cue_events:
            rows.extend(_cue_event_row(context, event, idea_by_id) for event in cue_events)
        else:
            for similarity in similarities:
                block_1 = idea_by_id.get(similarity.idea_block_id_1)
                block_2 = idea_by_id.get(similarity.idea_block_id_2)
                phase = _infer_similarity_phase(block_1, block_2, phase_windows)
                rows.append(
                    {
                        "event_id": f"similarity:{similarity.id}",
                        "cue_id": "",
                        "event_type": "similarity_pair",
                        "source": "similarity_pair_fallback",
                        "session_name": context.session_name,
                        "group_id": context.group_id,
                        "task": context.task_token,
                        "condition": context.condition.token,
                        "cue_enabled": context.condition.cue_enabled,
                        "phase": phase,
                        "cue_type": "same_reason" if similarity.is_same_reason else "different_reason",
                        "sender_participant_id": "",
                        "sender_code": "",
                        "recipient_participant_id": "",
                        "recipient_code": "",
                        "similarity_id": similarity.id,
                        "own_idea_block_id": similarity.idea_block_id_1,
                        "own_participant_id": block_1.user_id if block_1 else "",
                        "own_participant_code": _participant_code(context.group_id, str(block_1.user_id)) if block_1 else "",
                        "other_idea_block_id": similarity.idea_block_id_2,
                        "other_participant_id": block_2.user_id if block_2 else "",
                        "other_participant_code": _participant_code(context.group_id, str(block_2.user_id)) if block_2 else "",
                        "reason": similarity.reason,
                        "delivery_status": "not_persisted",
                        "response_status": "not_persisted",
                        "notes": "Similarity pair predates durable cue lifecycle logs; no delivery/response row exists.",
                    }
                )

    cue_summary = {
        "session_name": context.session_name,
        "group_id": context.group_id,
        "task": context.task_token,
        "condition": context.condition.token,
        "cue_enabled": context.condition.cue_enabled,
        "condition_source": context.condition.source,
        "similarity_pair_count": len(similarities),
        "durable_cue_event_count": len(cue_events),
        "exported_cue_log_rows": len(rows),
        "zero_event_marker": not context.condition.cue_enabled and not cue_events,
        "durable_lifecycle_logs_available": bool(cue_events),
        "delivery_status_counts": _count_values(event.delivery_status for event in cue_events),
        "response_status_counts": _count_values(event.response_status or "none" for event in cue_events),
        "notes": (
            "cue_enabled=false, but durable cue events were found and exported for audit."
            if not context.condition.cue_enabled and cue_events
            else
            "cue_enabled=false; no cue events should exist for this task."
            if not context.condition.cue_enabled
            else "Durable cue lifecycle logs exported."
            if cue_events
            else "No durable cue lifecycle rows found; exported similarity pairs are partial legacy cue evidence."
        ),
    }
    return [
        TaskExportFile(
            path=_package_path(context, f"{_artifact_prefix(context)}_cue_logs_group.csv"),
            artifact="cue_logs",
            scope="group",
            record_count=len(rows),
            required=context.condition.cue_enabled,
            media_type="text/csv",
            content=_csv_content(headers, rows),
        ),
        TaskExportFile(
            path=_package_path(context, f"{_artifact_prefix(context)}_cue_summary_group.json"),
            artifact="cue_summary",
            scope="group",
            record_count=1,
            required=True,
            media_type="application/json",
            content=_json_dumps(cue_summary),
        ),
    ]


def _cue_event_row(
    context: ExportContext,
    event: SimilarityCueEvent,
    idea_by_id: dict[int, IdeaBlock],
) -> dict[str, Any]:
    own_block = idea_by_id.get(event.own_idea_block_id or -1)
    other_block = idea_by_id.get(event.other_idea_block_id or -1)
    sender_participant_id = str(event.sender_participant_id or "")
    recipient_participant_id = str(event.recipient_participant_id or "")
    own_participant_id = str(own_block.user_id) if own_block else recipient_participant_id
    other_participant_id = str(other_block.user_id) if other_block else sender_participant_id
    return {
        "event_id": event.id,
        "cue_id": event.cue_id,
        "event_type": event.event_type,
        "source": event.source,
        "session_name": event.session_name,
        "group_id": event.group_id or context.group_id,
        "task": TASK_TOKEN_BY_ID.get(event.task_id, _file_token(event.task_id)),
        "condition": "with_cue" if event.cue_enabled else "no_cue",
        "cue_enabled": event.cue_enabled,
        "phase": event.phase,
        "cue_type": event.cue_type,
        "sender_participant_id": sender_participant_id,
        "sender_code": _participant_code(context.group_id, sender_participant_id) if sender_participant_id else "",
        "recipient_participant_id": recipient_participant_id,
        "recipient_code": _participant_code(context.group_id, recipient_participant_id) if recipient_participant_id else "",
        "similarity_id": event.similarity_id,
        "own_idea_block_id": event.own_idea_block_id,
        "own_participant_id": own_participant_id,
        "own_participant_code": _participant_code(context.group_id, own_participant_id) if own_participant_id else "",
        "other_idea_block_id": event.other_idea_block_id,
        "other_participant_id": other_participant_id,
        "other_participant_code": _participant_code(context.group_id, other_participant_id) if other_participant_id else "",
        "reason": event.reason,
        "delivery_status": event.delivery_status,
        "response_status": event.response_status or "",
        "created_at": event.created_at,
        "delivered_at": event.delivered_at,
        "shown_at": event.shown_at,
        "responded_at": event.responded_at,
        "accepted_at": event.accepted_at,
        "ignored_at": event.ignored_at,
        "dismissed_at": event.dismissed_at,
        "shared_at": event.shared_at,
        "updated_at": event.updated_at,
        "metadata": event.event_metadata,
        "notes": "",
    }


def _count_values(values: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        key = str(value or "none")
        counts[key] = counts.get(key, 0) + 1
    return counts


def _phase_timestamps_file(
    context: ExportContext,
    phase_windows: list[dict[str, Any]],
) -> TaskExportFile:
    headers = [
        "session_name",
        "group_id",
        "task",
        "condition",
        "phase",
        "started_at",
        "ended_at",
        "start_source",
        "end_source",
        "next_phase",
        "snapshot_count",
        "snapshot_ids",
    ]
    rows = [
        {
            "session_name": context.session_name,
            "group_id": context.group_id,
            "task": context.task_token,
            "condition": context.condition.token,
            "phase": window["phase"],
            "started_at": window.get("started_at"),
            "ended_at": window.get("ended_at"),
            "start_source": window.get("start_source"),
            "end_source": window.get("end_source"),
            "next_phase": window.get("next_phase"),
            "snapshot_count": window.get("snapshot_count", 0),
            "snapshot_ids": window.get("snapshot_ids", []),
        }
        for window in phase_windows
    ]
    return TaskExportFile(
        path=_package_path(context, f"{_artifact_prefix(context)}_phase_timestamps_group.csv"),
        artifact="phase_timestamps",
        scope="group",
        record_count=len(rows),
        required=True,
        media_type="text/csv",
        content=_csv_content(headers, rows),
    )


def _ranking_snapshot_headers() -> list[str]:
    return [
        "snapshot_id",
        "session_name",
        "group_id",
        "task",
        "condition",
        "cue_enabled",
        "phase",
        "scope",
        "subject_type",
        "subject_id",
        "participant_id",
        "participant_code",
        "participant_role",
        "participant_analysis_included",
        "snapshot_created_at",
        "source",
        "source_phase",
        "next_phase",
        "revision",
        "change_count",
        "ranking_move_id",
        "position",
        "item_id",
        "item_label",
        "item_source_metadata",
    ]


def _ranking_snapshot_rows(
    context: ExportContext,
    snapshot: RankingPhaseSnapshot,
    participant_roles: dict[str, str],
) -> list[dict[str, Any]]:
    participant_role = _participant_role_for_id(participant_roles, snapshot.participant_id)
    participant_analysis_included = _is_analysis_participant_id(participant_roles, snapshot.participant_id) if snapshot.participant_id else snapshot.scope == "public"
    participant_code = (
        _participant_code(context.group_id, snapshot.participant_id)
        if snapshot.participant_id
        else ""
    )
    if not snapshot.items:
        return [
            {
                "snapshot_id": snapshot.id,
                "session_name": snapshot.session_name,
                "group_id": context.group_id,
                "task": context.task_token,
                "condition": context.condition.token,
                "cue_enabled": snapshot.cue_enabled,
                "phase": snapshot.phase,
                "scope": snapshot.scope,
                "subject_type": snapshot.subject_type,
                "subject_id": snapshot.subject_id,
                "participant_id": snapshot.participant_id,
                "participant_code": participant_code,
                "participant_role": participant_role,
                "participant_analysis_included": participant_analysis_included,
                "snapshot_created_at": _isoformat(snapshot.created_at),
                "source": snapshot.source,
                "source_phase": snapshot.source_phase,
                "next_phase": snapshot.next_phase,
                "revision": snapshot.revision,
                "change_count": snapshot.change_count,
                "ranking_move_id": snapshot.ranking_move_id,
                "position": "",
                "item_id": "",
                "item_label": "",
                "item_source_metadata": {},
            }
        ]
    return [
        {
            "snapshot_id": snapshot.id,
            "session_name": snapshot.session_name,
            "group_id": context.group_id,
            "task": context.task_token,
            "condition": context.condition.token,
            "cue_enabled": snapshot.cue_enabled,
            "phase": snapshot.phase,
            "scope": snapshot.scope,
            "subject_type": snapshot.subject_type,
            "subject_id": snapshot.subject_id,
            "participant_id": snapshot.participant_id,
            "participant_code": participant_code,
            "participant_role": participant_role,
            "participant_analysis_included": participant_analysis_included,
            "snapshot_created_at": _isoformat(snapshot.created_at),
            "source": snapshot.source,
            "source_phase": snapshot.source_phase,
            "next_phase": snapshot.next_phase,
            "revision": snapshot.revision,
            "change_count": snapshot.change_count,
            "ranking_move_id": snapshot.ranking_move_id,
            "position": item.position,
            "item_id": item.item_id,
            "item_label": item.label,
            "item_source_metadata": item.source_metadata,
        }
        for item in snapshot.items
    ]


def _latest_ranking_snapshots(snapshots: list[RankingPhaseSnapshot]) -> list[RankingPhaseSnapshot]:
    latest_by_key: dict[tuple[str, str, str], RankingPhaseSnapshot] = {}
    for snapshot in sorted(snapshots, key=lambda item: (_sort_datetime(item.created_at), item.id)):
        latest_by_key[(snapshot.phase, snapshot.scope, snapshot.subject_id)] = snapshot
    return sorted(
        latest_by_key.values(),
        key=lambda item: (
            _phase_sort_index(item.phase),
            item.scope,
            _participant_sort_key(item.participant_id or item.subject_id),
            item.id,
        ),
    )


def _ranking_artifact_name(snapshot: RankingPhaseSnapshot, participant_roles: dict[str, str] | None = None) -> str:
    if snapshot.scope == "private" and snapshot.participant_id and _is_observer_participant_id(participant_roles or {}, snapshot.participant_id):
        return "observer_ranking_diagnostic"
    if snapshot.scope == "public" or snapshot.phase == "group":
        return "group_ranking"
    if snapshot.phase == "reflect" and snapshot.scope == "private":
        return "final_ranking"
    if snapshot.phase == "private_phase_1" and snapshot.source == "private_phase_task_items":
        return "private_phase_items"
    if snapshot.phase in {"private", "private_phase_2"} and snapshot.scope == "private":
        return "initial_ranking"
    return f"{_file_token(snapshot.phase)}_{_file_token(snapshot.scope)}_ranking"


def _snapshot_subject_token(context: ExportContext, snapshot: RankingPhaseSnapshot, participant_roles: dict[str, str] | None = None) -> str:
    if snapshot.scope == "public" or snapshot.subject_type == "group":
        return "group"
    subject_id = snapshot.participant_id or snapshot.subject_id
    subject_token = _participant_code(context.group_id, subject_id)
    if snapshot.scope == "private" and _is_observer_participant_id(participant_roles or {}, subject_id):
        return f"observer_{subject_token}"
    return subject_token


def _transcript_text(
    context: ExportContext,
    participant_roles: dict[str, str],
    transcripts: list[Transcript],
    phase_windows: list[dict[str, Any]],
) -> str:
    lines = [
        f"# {context.group_id} {context.task_token} {context.condition.token} transcript",
        f"session_name: {context.session_name}",
        f"generated_at: {_isoformat(context.generated_at)}",
        "",
    ]
    for transcript in transcripts:
        phase = _infer_phase_for_timestamp(transcript.time_stamp, phase_windows) or "unknown"
        participant_code = (
            _participant_code(context.group_id, str(transcript.user_id))
            if _is_real_participant_id(transcript.user_id)
            else "admin"
        )
        participant_role = _participant_role_for_id(participant_roles, transcript.user_id) if _is_real_participant_id(transcript.user_id) else "admin"
        speaker = transcript.display_name or participant_code
        lines.append(
            f"[{_isoformat(transcript.time_stamp)}] [{phase}] {speaker} "
            f"(system_id={transcript.user_id}, participant_role={participant_role}, transcript_id={transcript.id}, visibility={transcript.visibility})"
        )
        lines.append(transcript.transcript)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _idea_block_transcript_ids(block: IdeaBlock) -> list[int]:
    ids = []
    if block.transcript_id is not None:
        ids.append(int(block.transcript_id))
    for link in block.transcript_links:
        if link.transcript_id not in ids:
            ids.append(int(link.transcript_id))
    return ids


def _infer_similarity_phase(
    block_1: IdeaBlock | None,
    block_2: IdeaBlock | None,
    phase_windows: list[dict[str, Any]],
) -> str:
    phases = [
        _infer_phase_for_timestamp(block.time_stamp, phase_windows)
        for block in (block_1, block_2)
        if block is not None
    ]
    phases = [phase for phase in phases if phase]
    if not phases:
        return ""
    if len(set(phases)) == 1:
        return phases[0]
    return "mixed"


def _build_phase_windows(
    *,
    context: ExportContext,
    ranking_snapshots: list[RankingPhaseSnapshot],
) -> list[dict[str, Any]]:
    phase_ids = [phase["id"] for phase in get_task_phases_for_session(task_id=context.task_id)]
    if not phase_ids:
        phase_ids = ["private", "group", "reflect"]
    end_by_phase: dict[str, dict[str, Any]] = {}
    for snapshot in ranking_snapshots:
        phase = snapshot.phase
        current = end_by_phase.setdefault(
            phase,
            {
                "ended_at_dt": None,
                "next_phase": snapshot.next_phase,
                "snapshot_ids": [],
                "snapshot_count": 0,
            },
        )
        current["snapshot_ids"].append(snapshot.id)
        current["snapshot_count"] += 1
        if snapshot.next_phase:
            current["next_phase"] = snapshot.next_phase
        snapshot_created_at = _as_utc(snapshot.created_at)
        if snapshot_created_at and (
            current["ended_at_dt"] is None or snapshot_created_at > current["ended_at_dt"]
        ):
            current["ended_at_dt"] = snapshot_created_at

    windows: list[dict[str, Any]] = []
    previous_end: datetime | None = None
    for phase in phase_ids:
        end_info = end_by_phase.get(phase) or {}
        ended_at_dt = end_info.get("ended_at_dt")
        windows.append(
            {
                "phase": phase,
                "started_at": _isoformat(previous_end) if previous_end else "",
                "ended_at": _isoformat(ended_at_dt) if ended_at_dt else "",
                "started_at_dt": previous_end,
                "ended_at_dt": ended_at_dt,
                "start_source": "previous_phase_end" if previous_end else "missing",
                "end_source": "ranking_phase_snapshot" if ended_at_dt else "missing",
                "next_phase": end_info.get("next_phase") or "",
                "snapshot_ids": end_info.get("snapshot_ids") or [],
                "snapshot_count": end_info.get("snapshot_count", 0),
            }
        )
        if ended_at_dt:
            previous_end = ended_at_dt
    return windows


def _infer_phase_for_timestamp(
    timestamp: datetime | None,
    phase_windows: list[dict[str, Any]],
) -> str:
    if timestamp is None:
        return ""
    value = _as_utc(timestamp)
    for window in phase_windows:
        start = _as_utc(window.get("started_at_dt"))
        end = _as_utc(window.get("ended_at_dt"))
        if start is not None and value < start:
            continue
        if end is not None and value <= end:
            return str(window["phase"])
    for window in reversed(phase_windows):
        if window.get("started_at_dt") or window.get("ended_at_dt"):
            return str(window["phase"])
    return ""


def _collect_participants(
    *,
    context: ExportContext,
    participant_roles: dict[str, str],
    transcripts: list[Transcript],
    chat_messages: list[ChatMessage],
    idea_blocks: list[IdeaBlock],
    ranking_snapshots: list[RankingPhaseSnapshot],
) -> list[dict[str, Any]]:
    participant_sources: dict[str, set[str]] = {}
    display_names: dict[str, str] = {}

    def add(value: Any, source: str, display_name: str | None = None) -> None:
        if not _is_real_participant_id(value):
            return
        participant_id = str(value)
        participant_sources.setdefault(participant_id, set()).add(source)
        if display_name and participant_id not in display_names:
            display_names[participant_id] = display_name

    for transcript in transcripts:
        add(transcript.user_id, "transcript", transcript.display_name)
    for message in chat_messages:
        add(message.user_id, "public_chat", message.display_name)
    for block in idea_blocks:
        add(block.user_id, "idea_block")
    for snapshot in ranking_snapshots:
        add(snapshot.participant_id, "ranking_snapshot")
    for participant_id in participant_roles:
        add(participant_id, "participant_role")

    return [
        {
            "system_id": participant_id,
            "participant_code": _participant_code(context.group_id, participant_id),
            "display_name": display_names.get(participant_id),
            "participant_role": _participant_role_for_id(participant_roles, participant_id),
            "participant_analysis_included": _is_analysis_participant_id(participant_roles, participant_id),
            "sources": sorted(sources),
        }
        for participant_id, sources in sorted(
            participant_sources.items(),
            key=lambda entry: _participant_sort_key(entry[0]),
        )
    ]


def _build_manifest(
    *,
    context: ExportContext,
    files: list[TaskExportFile],
    participant_roles: dict[str, str],
    participants: list[dict[str, Any]],
    ranking_snapshots: list[RankingPhaseSnapshot],
    transcripts: list[Transcript],
    chat_messages: list[ChatMessage],
    idea_blocks: list[IdeaBlock],
    similarities: list[Similarity],
    cue_events: list[SimilarityCueEvent],
    phase_task_snapshots: list[PhaseTaskItemSnapshot],
    phase_windows: list[dict[str, Any]],
) -> dict[str, Any]:
    checklist = _build_checklist(
        context=context,
        files=files,
        participant_roles=participant_roles,
        participant_count=_analysis_participant_count(participants),
        ranking_snapshots=ranking_snapshots,
        transcripts=transcripts,
        chat_messages=chat_messages,
        idea_blocks=idea_blocks,
        similarities=similarities,
        cue_events=cue_events,
        phase_task_snapshots=phase_task_snapshots,
        phase_windows=phase_windows,
    )
    return {
        "schema_version": TASK_EXPORT_SCHEMA_VERSION,
        "generated_at": _isoformat(context.generated_at),
        "session_name": context.session_name,
        "group_id": context.group_id,
        "task_id": context.task_id,
        "task": context.task_token,
        "condition": context.condition.token,
        "source_condition": context.condition.condition,
        "condition_source": context.condition.source,
        "cue_enabled": context.condition.cue_enabled,
        "participants": participants,
        "participant_role_counts": _participant_role_counts(participants),
        "analysis_participant_count": _analysis_participant_count(participants),
        "system": _system_version_metadata(),
        "phase_timestamps": [
            {
                key: value
                for key, value in window.items()
                if key not in {"started_at_dt", "ended_at_dt"}
            }
            for window in phase_windows
        ],
        "files": [
            {
                "path": file.path,
                "artifact": file.artifact,
                "scope": file.scope,
                "record_count": file.record_count,
                "required": file.required,
                "media_type": file.media_type,
            }
            for file in files
        ],
        "checklist": checklist,
        "counts": {
            "participants": len(participants),
            "analysis_participants": _analysis_participant_count(participants),
            "observers": sum(1 for participant in participants if participant.get("participant_role") == OBSERVER_ROLE),
            "ranking_snapshots": len(ranking_snapshots),
            "phase_task_item_snapshots": len(phase_task_snapshots),
            "transcripts": len(transcripts),
            "private_transcripts": sum(1 for transcript in transcripts if transcript.visibility == "private"),
            "public_transcripts": sum(1 for transcript in transcripts if transcript.visibility == "public"),
            "idea_blocks": len(idea_blocks),
            "public_chat_messages": len(chat_messages),
            "cue_similarity_pairs": len(similarities),
            "cue_events": len(cue_events),
            "cue_events_delivered": sum(1 for event in cue_events if event.delivery_status == "delivered"),
            "cue_events_with_response": sum(1 for event in cue_events if event.response_status),
        },
        "scope_notes": [
            "Transcripts and public chat are session-scoped because those tables do not store task_id; this export assumes one task run per session URL.",
            "Idea block phase is inferred from persisted phase-boundary snapshot timestamps when available.",
            "Cue lifecycle export uses similarity_cue_events when available; older runs without durable event rows fall back to similarity-pair evidence.",
            "Manual participant_role metadata comes from session_participant_roles. Observer private ranking rows carry participant_analysis_included=false, latest observer private ranking files use the observer_ranking_diagnostic artifact, and observer rows are excluded from participant checklist denominators.",
        ],
    }


def _build_checklist(
    *,
    context: ExportContext,
    files: list[TaskExportFile],
    participant_roles: dict[str, str],
    participant_count: int,
    ranking_snapshots: list[RankingPhaseSnapshot],
    transcripts: list[Transcript],
    chat_messages: list[ChatMessage],
    idea_blocks: list[IdeaBlock],
    similarities: list[Similarity],
    cue_events: list[SimilarityCueEvent],
    phase_task_snapshots: list[PhaseTaskItemSnapshot],
    phase_windows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    latest_snapshots = _latest_ranking_snapshots(ranking_snapshots)
    initial_subjects = {
        snapshot.participant_id or snapshot.subject_id
        for snapshot in latest_snapshots
        if _ranking_artifact_name(snapshot, participant_roles) == "initial_ranking"
    }
    final_subjects = {
        snapshot.participant_id or snapshot.subject_id
        for snapshot in latest_snapshots
        if _ranking_artifact_name(snapshot, participant_roles) == "final_ranking"
    }
    group_ranking_count = sum(1 for snapshot in latest_snapshots if _ranking_artifact_name(snapshot, participant_roles) == "group_ranking")
    private_transcript_subjects = {
        str(transcript.user_id)
        for transcript in transcripts
        if transcript.visibility == "private" and _is_analysis_participant_id(participant_roles, transcript.user_id)
    }
    public_transcript_count = sum(1 for transcript in transcripts if transcript.visibility == "public")
    phase_end_count = sum(1 for window in phase_windows if window.get("ended_at"))
    system_version = _system_version_metadata().get("version")
    return [
        _checklist_item(
            "initial_personal_rankings",
            "Private-phase initial personal ranking snapshots",
            _participant_status(len(initial_subjects), participant_count),
            _files_for_artifacts(files, {"initial_ranking"}),
            len(initial_subjects),
            f"{len(initial_subjects)}/{participant_count or '?'} participant snapshots present.",
        ),
        _checklist_item(
            "public_group_ranking",
            "Public-phase group ranking snapshot",
            "present" if group_ranking_count > 0 else "missing",
            _files_for_artifacts(files, {"group_ranking"}),
            group_ranking_count,
            "Latest public/group ranking snapshot exported." if group_ranking_count > 0 else "No public/group ranking snapshot found.",
        ),
        _checklist_item(
            "reflection_final_rankings",
            "Reflection/final personal ranking snapshots",
            _participant_status(len(final_subjects), participant_count),
            _files_for_artifacts(files, {"final_ranking"}),
            len(final_subjects),
            f"{len(final_subjects)}/{participant_count or '?'} participant final snapshots present.",
        ),
        _checklist_item(
            "poster_private_phase_items",
            "Enhance-the-Poster Private Phase 1 item pool",
            "present" if phase_task_snapshots else ("not_applicable" if context.task_id != "enhance-the-poster" else "missing"),
            _files_for_artifacts(files, {"private_phase_item_pool", "private_phase_items"}),
            len(phase_task_snapshots),
            "Only required for Enhance-the-Poster runs.",
            required=context.task_id == "enhance-the-poster",
        ),
        _checklist_item(
            "private_transcripts",
            "Private transcripts",
            _participant_status(len(private_transcript_subjects), participant_count),
            _files_for_artifacts(files, {"private_transcript"}),
            len(private_transcript_subjects),
            f"{len(private_transcript_subjects)}/{participant_count or '?'} participant transcript files present.",
        ),
        _checklist_item(
            "public_transcripts",
            "Public transcripts",
            "present" if public_transcript_count > 0 else "missing",
            _files_for_artifacts(files, {"public_transcript"}),
            public_transcript_count,
            "Public transcript file is included even when it has zero rows.",
        ),
        _checklist_item(
            "idea_blocks",
            "Idea blocks",
            "present" if idea_blocks else "missing",
            _files_for_artifacts(files, {"idea_blocks"}),
            len(idea_blocks),
            "Task-scoped by idea_blocks.task_name.",
        ),
        _checklist_item(
            "public_chat",
            "Public chat messages",
            "present",
            _files_for_artifacts(files, {"public_chat"}),
            len(chat_messages),
            "Public chat log file is included; zero rows means no public chat messages were recorded.",
        ),
        _checklist_item(
            "cue_logs",
            "Cue logs / no-cue marker",
            _cue_log_status(context, similarities, cue_events),
            _files_for_artifacts(files, {"cue_logs", "cue_summary"}),
            len(cue_events),
            (
                "cue_enabled=false marker included."
                if not context.condition.cue_enabled
                else "Durable cue lifecycle logs are included."
                if cue_events
                else "No durable cue lifecycle logs found; exported similarity pairs are partial legacy cue evidence."
            ),
        ),
        _checklist_item(
            "phase_timestamps",
            "Phase start/end timestamps",
            "present" if phase_end_count > 0 else "missing",
            _files_for_artifacts(files, {"phase_timestamps"}),
            phase_end_count,
            "End timestamps come from ranking phase snapshots; starts are inferred from previous phase end when possible.",
        ),
        _checklist_item(
            "system_version",
            "System commit/version",
            "present" if system_version else "missing",
            _files_for_artifacts(files, {"manifest", "session_summary"}),
            1 if system_version else 0,
            "Read from environment or local git metadata.",
        ),
    ]


def _checklist_item(
    key: str,
    label: str,
    status: str,
    files: list[str],
    count: int,
    notes: str,
    *,
    required: bool = True,
) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "status": status,
        "present": status in {"present", "partial", "not_applicable"},
        "required": required,
        "files": files,
        "count": count,
        "notes": notes,
    }


def _participant_status(found_count: int, participant_count: int) -> str:
    if participant_count <= 0:
        return "missing"
    if found_count >= participant_count:
        return "present"
    if found_count > 0:
        return "partial"
    return "missing"


def _cue_log_status(
    context: ExportContext,
    similarities: list[Similarity],
    cue_events: list[SimilarityCueEvent],
) -> str:
    if not context.condition.cue_enabled:
        return "present"
    if cue_events:
        return "present"
    return "partial" if similarities else "missing"


def _files_for_artifacts(files: list[TaskExportFile], artifacts: set[str]) -> list[str]:
    return [file.path for file in files if file.artifact in artifacts]


def _build_session_summary_markdown(manifest: dict[str, Any]) -> str:
    checklist = manifest["checklist"]
    missing_or_partial = [
        item
        for item in checklist
        if item["status"] in {"missing", "partial"}
    ]
    lines = [
        f"# {manifest['group_id']} {manifest['task']} {manifest['condition']} Session Summary",
        "",
        f"- Session: `{manifest['session_name']}`",
        f"- Task: `{manifest['task_id']}`",
        f"- Condition: `{manifest['condition']}` (`cue_enabled={str(manifest['cue_enabled']).lower()}`)",
        f"- Generated at: `{manifest['generated_at']}`",
        f"- System version: `{manifest['system'].get('version') or 'unknown'}`",
        "",
        "## Participants",
        "",
    ]
    if manifest["participants"]:
        for participant in manifest["participants"]:
            role = participant.get("participant_role") or PARTICIPANT_ROLE
            included = bool(participant.get("participant_analysis_included", True))
            scope = "included in participant analysis" if included else "observer diagnostic only"
            lines.append(
                f"- `{participant['participant_code']}`: system id `{participant['system_id']}`, role `{role}`, {scope}"
            )
    else:
        lines.append("- No real participant ids were found in exported system data.")
    lines.extend(
        [
            "",
            "## Checklist",
            "",
        ]
    )
    for item in checklist:
        lines.append(f"- `{item['status']}` {item['label']}: {item['notes']}")
    lines.extend(["", "## Missing Or Partial", ""])
    if missing_or_partial:
        for item in missing_or_partial:
            lines.append(f"- `{item['status']}` {item['label']}: {item['notes']}")
    else:
        lines.append("- None in system-exported artifacts.")
    lines.extend(["", "## Scope Notes", ""])
    for note in manifest.get("scope_notes") or []:
        lines.append(f"- {note}")
    return "\n".join(lines) + "\n"


def _build_zip_bytes(files: list[TaskExportFile]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file in files:
            archive.writestr(file.path, file.content)
    return buffer.getvalue()


def _csv_content(headers: list[str], rows: list[dict[str, Any]]) -> str:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({header: _csv_value(row.get(header)) for header in headers})
    return "\ufeff" + buffer.getvalue()


def _csv_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return _isoformat(value)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list, tuple, set)):
        return _json_dumps(value)
    return str(value)


def _json_dumps(value: Any) -> str:
    return json.dumps(_jsonable(value), ensure_ascii=False, indent=2, sort_keys=True)


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return _isoformat(value)
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    return value


def _resolve_export_condition(
    *,
    session_name: str,
    snapshots: list[RankingPhaseSnapshot],
    cue_condition: str | None,
) -> ExportCondition:
    if snapshots:
        latest_snapshot = sorted(snapshots, key=lambda item: (_sort_datetime(item.created_at), item.id))[-1]
        condition = latest_snapshot.condition
        cue_enabled = latest_snapshot.cue_enabled
        return ExportCondition(
            condition,
            cue_enabled,
            "with_cue" if cue_enabled else "no_cue",
            "ranking_phase_snapshot",
        )

    explicit = str(cue_condition or "").strip().lower().replace("-", "_")
    if explicit in {"control", "no_cue", "nocue", "no"}:
        return ExportCondition("control", False, "no_cue", "query")
    if explicit in {"experimental", "with_cue", "withcue", "yes"}:
        return ExportCondition("experimental", True, "with_cue", "query")

    session_key = session_name.lower().replace("-", "_")
    if "no_cue" in session_key or "nocue" in session_key or "control" in session_key:
        return ExportCondition("control", False, "no_cue", "session_name")
    if "with_cue" in session_key or "withcue" in session_key or "experimental" in session_key:
        return ExportCondition("experimental", True, "with_cue", "session_name")
    return ExportCondition("experimental", True, "with_cue", "default")


def _resolve_group_id(*, session_name: str, task_id: str) -> str:
    suffix = re.sub(rf"^{re.escape(task_id)}[-_]*", "", session_name, flags=re.IGNORECASE)
    for candidate in (suffix, session_name):
        match = re.search(r"(?i)(?:^|[^a-z0-9])(G\d{1,3})(?:[^a-z0-9]|$)", candidate)
        if match:
            return match.group(1).upper()
    return suffix.strip("-_") or session_name


def _normalize_task_id(task_id: str | None) -> str | None:
    if task_id is None:
        return None
    normalized = task_id.strip().lower().replace("_", "-")
    if normalized == "enhance-poster":
        return "enhance-the-poster"
    if normalized == "lost-at-sea":
        return "lost-at-sea"
    return normalized


def _artifact_prefix(context: ExportContext) -> str:
    return f"{context.group_token}_{context.task_token}_{context.condition.token}"


def _package_path(context: ExportContext, filename: str) -> str:
    return f"{context.package_root}/{filename}"


def _file_token(value: Any, *, preserve_case: bool = False) -> str:
    text = str(value or "").strip()
    if not preserve_case:
        text = text.lower()
    text = re.sub(r"[^A-Za-z0-9]+", "_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    return text or "unknown"


def _participant_code(group_id: str, participant_id: str | int | None) -> str:
    participant_text = str(participant_id or "").strip()
    if not participant_text:
        return "unknown"
    if re.fullmatch(r"\d+", participant_text):
        if re.fullmatch(r"(?i)G\d+", group_id.strip()):
            return f"{group_id.upper()}P{participant_text}"
        return f"P{participant_text}"
    return _file_token(participant_text, preserve_case=True)


def _is_real_participant_id(value: Any) -> bool:
    if value is None:
        return False
    participant_id = str(value).strip().lower()
    if not participant_id or participant_id == "0":
        return False
    return participant_id != "admin" and not participant_id.startswith("admin-")


def _participant_role_for_id(participant_roles: dict[str, str], participant_id: Any) -> str:
    if not _is_real_participant_id(participant_id):
        return ""
    return normalize_participant_role(participant_roles.get(str(participant_id), PARTICIPANT_ROLE))


def _is_observer_participant_id(participant_roles: dict[str, str], participant_id: Any) -> bool:
    return _participant_role_for_id(participant_roles, participant_id) == OBSERVER_ROLE


def _is_analysis_participant_id(participant_roles: dict[str, str], participant_id: Any) -> bool:
    return _is_real_participant_id(participant_id) and not _is_observer_participant_id(participant_roles, participant_id)


def _analysis_participant_count(participants: list[dict[str, Any]]) -> int:
    return sum(1 for participant in participants if participant.get("participant_analysis_included", True))


def _participant_role_counts(participants: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for participant in participants:
        role = str(participant.get("participant_role") or PARTICIPANT_ROLE)
        counts[role] = counts.get(role, 0) + 1
    return counts


def _participant_sort_key(value: Any) -> tuple[int, str]:
    text = str(value or "")
    return (int(text), text) if text.isdigit() else (999999, text)


def _phase_sort_index(phase: str) -> int:
    order = {
        "private": 10,
        "private_phase_1": 11,
        "private_phase_2": 12,
        "group": 20,
        "reflect": 30,
    }
    return order.get(phase, 999)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _isoformat(value: datetime | None) -> str:
    if value is None:
        return ""
    return _as_utc(value).isoformat().replace("+00:00", "Z")


def _as_utc(value: Any) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _sort_datetime(value: datetime | None) -> datetime:
    return _as_utc(value) or datetime.min.replace(tzinfo=timezone.utc)


def _system_version_metadata() -> dict[str, Any]:
    env_values = {
        key: os.getenv(key)
        for key in VERSION_ENV_KEYS
        if os.getenv(key)
    }
    git_commit = _local_git_commit()
    version = next(iter(env_values.values()), None) or git_commit or APP_VERSION
    return {
        "version": version,
        "app_version": APP_VERSION,
        "git_commit": git_commit,
        "env": env_values,
    }


def _local_git_commit() -> str | None:
    for parent in Path(__file__).resolve().parents:
        if not (parent / ".git").exists():
            continue
        try:
            result = subprocess.run(
                ["git", "-C", str(parent), "rev-parse", "--short=12", "HEAD"],
                check=True,
                capture_output=True,
                text=True,
                timeout=2,
            )
        except Exception:
            return None
        return result.stdout.strip() or None
    return None
