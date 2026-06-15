import unittest

from app.task_config.lost_at_sea import TASK_PHASES


class LostAtSeaTaskConfigTests(unittest.TestCase):
    def test_reflect_phase_shows_public_ranking_reference(self) -> None:
        phases_by_id = {phase["id"]: phase for phase in TASK_PHASES}
        layout = phases_by_id["reflect"]["default_layout"]

        self.assertEqual(layout["type"], "split")
        self.assertEqual(layout["direction"], "horizontal")
        self.assertEqual(layout["first"], {"type": "leaf", "content": "private-ranking"})
        self.assertEqual(layout["second"], {"type": "leaf", "content": "public-ranking"})


if __name__ == "__main__":
    unittest.main()
