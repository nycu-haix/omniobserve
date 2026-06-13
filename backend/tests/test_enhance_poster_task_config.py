import unittest

from app.services.private_phase_task_item_service import _build_statement
from app.task_config.enhance_the_poster import (
    CUSTOM_DETAIL_ACTION_ID,
    PHASE1_ACTION_ITEMS,
    PHASE1_POSTER_COMPONENTS,
    REFERENCE_IMAGE_SRC,
    TASK_PHASES,
    TASK_TOPIC_DETAIL,
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

    def test_private_phases_show_task_instructions_on_the_right(self) -> None:
        phases_by_id = {phase["id"]: phase for phase in TASK_PHASES}

        expected_left_pane_by_phase = {
            "private_phase_1": {"type": "leaf", "content": "phase-task-items"},
            "private_phase_2": {"type": "leaf", "content": "private-ranking"},
        }

        for phase_id, expected_left_pane in expected_left_pane_by_phase.items():
            with self.subTest(phase_id=phase_id):
                layout = phases_by_id[phase_id]["default_layout"]

                self.assertEqual(layout["type"], "split")
                self.assertEqual(layout["ratio"], 58)
                self.assertEqual(layout["first"], expected_left_pane)
                self.assertEqual(layout["second"], {"type": "leaf", "content": "task-instructions"})

    def test_task_description_uses_pdf_page_three_asset_and_required_copy(self) -> None:
        self.assertEqual(REFERENCE_IMAGE_SRC, "/task-assets/enhance-poster-task-brief-page-3.png?v=20260613-main")
        self.assertIn("2026 NYCU 世界淨灘日｜南寮海岸淨灘行動", TASK_TOPIC_DETAIL)
        self.assertIn("背景不得留白，必須使用背景顏色或背景圖像", TASK_TOPIC_DETAIL)


if __name__ == "__main__":
    unittest.main()
