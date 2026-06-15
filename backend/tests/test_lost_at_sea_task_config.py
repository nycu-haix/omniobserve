import unittest

from app.task_config.lost_at_sea import TASK_PHASES


class LostAtSeaTaskConfigTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
