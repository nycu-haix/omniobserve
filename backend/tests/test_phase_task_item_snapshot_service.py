import unittest
from types import SimpleNamespace

from app.models import PrivatePhaseTaskItem
from app.services.phase_task_item_snapshot_service import (
    _source_priorities_for_dedupe_key,
    _snapshot_dedupe_key,
    deduplicate_private_phase_items,
    serialize_snapshot_ranking_items,
)


def _private_item(
    item_id: int,
    *,
    user_id: int,
    action_id: str,
    detail: str,
    statement: str,
    priority: int,
) -> PrivatePhaseTaskItem:
    return PrivatePhaseTaskItem(
        id=item_id,
        session_name="enhance-the-poster-issue52",
        user_id=user_id,
        task_id="enhance-the-poster",
        component_id="headline",
        component_label="主標題",
        action_id=action_id,
        action_label="自訂動作" if action_id == "custom_detail" else "放大",
        detail=detail,
        statement=statement,
        priority=priority,
    )


class PhaseTaskItemSnapshotServiceTests(unittest.TestCase):
    def test_custom_details_are_deduplicated_by_canonical_text(self) -> None:
        first = _private_item(
            1,
            user_id=1,
            action_id="custom_detail",
            detail="改成更有活動邀請感的語氣！",
            statement="「主標題」：改成更有活動邀請感的語氣！",
            priority=1,
        )
        duplicate = _private_item(
            2,
            user_id=2,
            action_id="custom_detail",
            detail=" 改成 更有 活動邀請感 的語氣 ",
            statement="「主標題」：改成 更有 活動邀請感 的語氣",
            priority=2,
        )
        other = _private_item(
            3,
            user_id=3,
            action_id="custom_detail",
            detail="改成更正式的語氣",
            statement="「主標題」：改成更正式的語氣",
            priority=1,
        )

        deduplicated = deduplicate_private_phase_items([first, duplicate, other])

        self.assertEqual([item.id for item in deduplicated], [1, 3])

    def test_custom_dedupe_preserves_all_source_metadata(self) -> None:
        first = _private_item(
            1,
            user_id=1,
            action_id="custom_detail",
            detail="Change CTA text.",
            statement="「主標題」：Change CTA text.",
            priority=3,
        )
        duplicate = _private_item(
            2,
            user_id=2,
            action_id="custom_detail",
            detail="change cta text",
            statement="「主標題」：change cta text",
            priority=1,
        )

        source_priorities = _source_priorities_for_dedupe_key(
            [first, duplicate],
            _snapshot_dedupe_key(first),
        )

        self.assertEqual(
            source_priorities,
            [
                {"user_id": 1, "priority": 3, "private_phase_task_item_id": 1},
                {"user_id": 2, "priority": 1, "private_phase_task_item_id": 2},
            ],
        )

    def test_non_custom_details_keep_exact_dedupe_scope(self) -> None:
        first = _private_item(
            1,
            user_id=1,
            action_id="enlarge",
            detail="A",
            statement="放大「主標題」：A",
            priority=1,
        )
        second = _private_item(
            2,
            user_id=2,
            action_id="enlarge",
            detail="a",
            statement="放大「主標題」：a",
            priority=1,
        )

        deduplicated = deduplicate_private_phase_items([first, second])

        self.assertEqual([item.id for item in deduplicated], [1, 2])

    def test_snapshot_ranking_items_show_custom_statement_text(self) -> None:
        snapshot_item = SimpleNamespace(
            id=9,
            position=1,
            statement="「主標題」：改成更有活動邀請感的語氣",
            component_label="主標題",
            action_label="自訂動作",
            component_id="headline",
            action_id="custom_detail",
            source_user_ids=[1, 2],
        )

        [ranking_item] = serialize_snapshot_ranking_items([snapshot_item])

        self.assertEqual(ranking_item["label"], "「主標題」：改成更有活動邀請感的語氣")
        self.assertEqual(ranking_item["label_zh"], "「主標題」：改成更有活動邀請感的語氣")
        self.assertEqual(ranking_item["description_zh"], "主標題 / 自訂動作")
        self.assertEqual(ranking_item["source_user_ids"], [1, 2])


if __name__ == "__main__":
    unittest.main()
