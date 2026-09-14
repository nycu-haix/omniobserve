import base64
import unittest

from backend.app.services.spreadsheet_task_items import parse_spreadsheet_task_items


class SpreadsheetTaskItemsTests(unittest.TestCase):
    def test_topic_discription_header_row_is_not_imported(self) -> None:
        content = "topic,discription\nPrototype clarity,Evaluate how clear the demo is\nInteraction quality,Assess interaction design\n"
        encoded_content = base64.b64encode(content.encode("utf-8")).decode("ascii")

        items = parse_spreadsheet_task_items("items.csv", encoded_content)

        self.assertEqual([item["label"] for item in items], ["Prototype clarity", "Interaction quality"])
        self.assertEqual([item["description_zh"] for item in items], ["Evaluate how clear the demo is", "Assess interaction design"])
        self.assertNotIn("topic", [item["label"] for item in items])

    def test_two_row_topic_discription_sheet_imports_each_topic_column(self) -> None:
        content = "topic,Prototype clarity,Interaction quality\ndiscription,Evaluate how clear the demo is,Assess interaction design\n"
        encoded_content = base64.b64encode(content.encode("utf-8")).decode("ascii")

        items = parse_spreadsheet_task_items("items.csv", encoded_content)

        self.assertEqual([item["label"] for item in items], ["Prototype clarity", "Interaction quality"])
        self.assertEqual([item["description_zh"] for item in items], ["Evaluate how clear the demo is", "Assess interaction design"])


if __name__ == "__main__":
    unittest.main()
