from typing import Any


MAX_IDEA_BLOCKS_PER_TRANSCRIPT_BATCH = 6


def bound_generated_idea_blocks(
    generated_blocks: list[dict[str, Any]],
    *,
    max_blocks: int = MAX_IDEA_BLOCKS_PER_TRANSCRIPT_BATCH,
) -> list[dict[str, Any]]:
    if max_blocks <= 0:
        return []
    return deduplicate_generated_idea_blocks(generated_blocks)[:max_blocks]


def deduplicate_generated_idea_blocks(generated_blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduplicated: list[dict[str, Any]] = []
    for block in generated_blocks:
        key = _generated_idea_block_key(block)
        if not key or key in seen:
            continue
        seen.add(key)
        deduplicated.append(block)
    return deduplicated


def _generated_idea_block_key(block: dict[str, Any]) -> str:
    text = " ".join(
        str(block.get(field, "")).strip()
        for field in ("summary", "content")
        if str(block.get(field, "")).strip()
    )
    return "".join(character.casefold() for character in text if character.isalnum())
