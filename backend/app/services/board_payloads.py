from typing import Any


def serialize_frontend_board_idea_block(block: Any) -> dict[str, Any]:
    return {
        "id": block.id,
        "summary": block.content,
        "aiSummary": block.summary,
        "transcript": block.transcript,
        "status": "ready",
    }


def serialize_frontend_board_idea_block_update(block: Any) -> dict[str, Any]:
    return {
        "id": block.id,
        "summary": block.content,
        "aiSummary": block.summary,
        "transcript": block.transcript,
        "status": "ready",
    }
