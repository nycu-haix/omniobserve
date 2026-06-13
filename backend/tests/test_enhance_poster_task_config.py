import unittest

from app.services.private_phase_task_item_service import _build_statement
from app.task_config.enhance_the_poster import (
    CUSTOM_DETAIL_ACTION_ID,
    PHASE1_ACTION_ITEMS,
    PHASE1_POSTER_COMPONENTS,
)


def _option_by_id(options, option_id: str):
    return next(item for item in options if item["id"] == option_id)


class EnhancePosterTaskConfigTests(unittest.TestCase):
    def test_custom_detail_statement_omits_action_words(self) -> None:
        component = {"label_zh": "Component"}
        action = _option_by_id(PHASE1_ACTION_ITEMS, CUSTOM_DETAIL_ACTION_ID)

        self.assertEqual(_build_statement(component, action, "留言"), "「Component」：留言")

    def test_background_component_supports_color_changes(self) -> None:
        background = _option_by_id(PHASE1_POSTER_COMPONENTS, "background")

        self.assertEqual(background["label_zh"], "背景")
        self.assertIn("change_color", background["allowed_action_ids"])
        self.assertIn("move", background["allowed_action_ids"])
        self.assertIn("transparency", background["allowed_action_ids"])
        self.assertIn(CUSTOM_DETAIL_ACTION_ID, background["allowed_action_ids"])


if __name__ == "__main__":
    unittest.main()
