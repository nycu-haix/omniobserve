from types import SimpleNamespace
import unittest

from app.models import Visibility
from app.services.streaming import _is_completed_private_generation


class StreamingGenerationCompletionTests(unittest.TestCase):
    def test_requires_successful_private_pipeline_result(self) -> None:
        transcript_segments = [SimpleNamespace(segment_id=1)]

        self.assertTrue(
            _is_completed_private_generation(
                Visibility.PRIVATE,
                transcript_segments,
                SimpleNamespace(),
            )
        )
        self.assertFalse(
            _is_completed_private_generation(
                Visibility.PRIVATE,
                transcript_segments,
                None,
            )
        )
        self.assertFalse(
            _is_completed_private_generation(
                Visibility.PUBLIC,
                transcript_segments,
                SimpleNamespace(),
            )
        )
        self.assertFalse(
            _is_completed_private_generation(
                Visibility.PRIVATE,
                [],
                SimpleNamespace(),
            )
        )


if __name__ == "__main__":
    unittest.main()
