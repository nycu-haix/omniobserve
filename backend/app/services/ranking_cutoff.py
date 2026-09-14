from collections.abc import Iterable
from typing import Any

RANKING_CUTOFF_MARKER = "__omniobserve_ranking_cutoff__"


def split_ranking_items(items: Iterable[Any]) -> tuple[list[str], int | None]:
    real_items: list[str] = []
    change_count: int | None = None
    for value in items:
        if not isinstance(value, str):
            continue
        if value == RANKING_CUTOFF_MARKER:
            if change_count is None:
                change_count = len(real_items)
            continue
        real_items.append(value)
    return real_items, change_count


def normalize_ranking_change_count(
    value: int | None,
    *,
    ranking_limit: int,
    item_count: int,
) -> int:
    max_change_count = min(max(ranking_limit, 0), max(item_count, 0))
    if value is None:
        return max_change_count
    return max(0, min(int(value), max_change_count))


def build_ranking_items_with_cutoff(items: list[str], change_count: int | None) -> list[str]:
    if change_count is None:
        return list(items)
    bounded_change_count = max(0, min(change_count, len(items)))
    return [
        *items[:bounded_change_count],
        RANKING_CUTOFF_MARKER,
        *items[bounded_change_count:],
    ]
