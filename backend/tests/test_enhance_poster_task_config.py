import unittest

from fastapi import HTTPException

from app.services.private_phase_task_item_service import _build_statement, _resolve_component_action
from app.services.task_item_generation import (
    _format_builder_option_line,
    build_poster_component_ids_by_keyword,
)
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
        self.assertIn("transparency", background["allowed_action_ids"])
        self.assertNotIn("remove", background["allowed_action_ids"])
        self.assertNotIn("move", background["allowed_action_ids"])
        self.assertNotIn("enlarge", background["allowed_action_ids"])
        self.assertNotIn("shrink", background["allowed_action_ids"])
        self.assertNotIn(CUSTOM_DETAIL_ACTION_ID, background["allowed_action_ids"])

    def test_background_component_rejects_fixed_context_actions(self) -> None:
        for action_id in ("remove", "move", CUSTOM_DETAIL_ACTION_ID):
            with self.subTest(action_id=action_id), self.assertRaises(HTTPException) as raised:
                _resolve_component_action(
                    session_name="enhance-the-poster-issue95",
                    task_id="enhance-the-poster",
                    component_id="background",
                    action_id=action_id,
                )

            self.assertEqual(raised.exception.status_code, 422)
            self.assertEqual(raised.exception.detail, "Action item is not available for this poster component")

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

    def test_public_phase_keeps_task_instructions_available(self) -> None:
        phases_by_id = {phase["id"]: phase for phase in TASK_PHASES}
        layout = phases_by_id["group"]["default_layout"]

        self.assertEqual(layout["type"], "split")
        self.assertEqual(layout["direction"], "horizontal")
        self.assertEqual(layout["first"], {"type": "leaf", "content": "public-ranking"})
        self.assertEqual(layout["second"]["type"], "split")
        self.assertEqual(layout["second"]["direction"], "vertical")
        self.assertEqual(layout["second"]["first"], {"type": "leaf", "content": "private-ranking"})
        self.assertEqual(layout["second"]["second"], {"type": "leaf", "content": "task-instructions"})

    def test_task_description_uses_pdf_page_three_asset_and_required_copy(self) -> None:
        self.assertEqual(REFERENCE_IMAGE_SRC, "/task-assets/enhance-poster-task-brief-page-3.png?v=20260613-main")
        self.assertIn("2026 NYCU 世界淨灘日｜南寮海岸淨灘行動", TASK_TOPIC_DETAIL)
        self.assertIn("背景不得留白，必須使用背景顏色或背景圖像", TASK_TOPIC_DETAIL)

    def test_poster_components_include_detection_metadata(self) -> None:
        components_by_id = {component["id"]: component for component in PHASE1_POSTER_COMPONENTS}

        for component in PHASE1_POSTER_COMPONENTS:
            with self.subTest(component_id=component["id"]):
                self.assertIsInstance(component.get("description_zh"), str)
                self.assertTrue(component["description_zh"].strip())
                self.assertIsInstance(component.get("aliases"), list)
                self.assertTrue(component["aliases"])

        self.assertIn("右下角報名區", components_by_id["qr_code_group"]["aliases"])
        self.assertIn("左上角那張圖", components_by_id["activity_icon1"]["aliases"])
        self.assertIn("底部資訊", components_by_id["info_group2"]["aliases"])

    def test_poster_component_keyword_matching_uses_aliases_and_descriptions(self) -> None:
        cases = [
            ("右下角報名區應該靠近參與資訊", "qr_code_group"),
            ("左上角那張圖可以換成更像淨灘的圖", "activity_icon1"),
            ("下面那個單位資訊不要太搶眼", "info_group2"),
            ("第一個場次的時間地點說明需要更好讀", "description1"),
        ]

        for text, expected_component_id in cases:
            with self.subTest(text=text):
                self.assertIn(
                    expected_component_id,
                    build_poster_component_ids_by_keyword(
                        text,
                        task_name="enhance-the-poster",
                    ),
                )

    def test_builder_prompt_lines_include_component_descriptions_and_aliases(self) -> None:
        qr_group = _option_by_id(PHASE1_POSTER_COMPONENTS, "qr_code_group")

        line = _format_builder_option_line(qr_group)

        self.assertIn('id="qr_code_group"', line)
        self.assertIn('description="QR code 與其說明文字形成的報名區塊。"', line)
        self.assertIn('aliases="報名區, QR 區塊, QR 碼區, 右下角報名區, 掃碼區, QR 和文字"', line)


if __name__ == "__main__":
    unittest.main()
