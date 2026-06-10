from typing import Any


def _created_at_ms(block: Any) -> int | None:
    value = getattr(block, "created_at", None)
    if value is None:
        value = getattr(block, "time_stamp", None)
    if value is None:
        return None
    return int(value.timestamp() * 1000)


def serialize_frontend_board_idea_block(block: Any) -> dict[str, Any]:
    transcript_line_id = getattr(block, "transcript_id", None)
    source_transcript_ids = getattr(block, "source_transcript_ids", [])
    return {
        "id": block.id,
        "summary": block.content,
        "aiSummary": block.summary,
        "transcript": block.transcript,
        "transcriptLineId": str(transcript_line_id) if transcript_line_id is not None else None,
        "sourceTranscriptIds": source_transcript_ids,
        "isDeleted": block.is_deleted,
        "is_deleted": block.is_deleted,
        "createdAtMs": _created_at_ms(block),
        "status": "ready",
    }


def serialize_frontend_board_idea_block_update(block: Any) -> dict[str, Any]:
    transcript_line_id = getattr(block, "transcript_id", None)
    source_transcript_ids = getattr(block, "source_transcript_ids", [])
    return {
        "id": block.id,
        "summary": block.content,
        "aiSummary": block.summary,
        "transcript": block.transcript,
        "transcriptLineId": str(transcript_line_id) if transcript_line_id is not None else None,
        "sourceTranscriptIds": source_transcript_ids,
        "isDeleted": block.is_deleted,
        "is_deleted": block.is_deleted,
        "createdAtMs": _created_at_ms(block),
        "status": "ready",
    }
