import unittest

from app.services.idea_block_generation_limits import (
    MAX_IDEA_BLOCKS_PER_TRANSCRIPT_BATCH,
    bound_generated_idea_blocks,
)


class TranscriptPipelineLimitTests(unittest.TestCase):
    def test_bounds_generated_idea_blocks_after_deduplication(self) -> None:
        blocks = [
            {"summary": "Repeat this", "content": "Repeat this"},
            {"summary": "Repeat this!", "content": "Repeat this"},
            *[
                {"summary": f"Unique {index}", "content": f"Unique content {index}"}
                for index in range(1, MAX_IDEA_BLOCKS_PER_TRANSCRIPT_BATCH + 3)
            ],
        ]

        bounded = bound_generated_idea_blocks(blocks)

        self.assertEqual(len(bounded), MAX_IDEA_BLOCKS_PER_TRANSCRIPT_BATCH)
        self.assertEqual(bounded[0]["summary"], "Repeat this")
        self.assertNotIn("Repeat this!", [block["summary"] for block in bounded])

    def test_skips_empty_generated_idea_blocks(self) -> None:
        self.assertEqual(
            bound_generated_idea_blocks(
                [
                    {"summary": "", "content": ""},
                    {"summary": "  ", "content": "  "},
                    {"summary": "Keep", "content": "Keep"},
                ]
            ),
            [{"summary": "Keep", "content": "Keep"}],
        )


if __name__ == "__main__":
    unittest.main()
