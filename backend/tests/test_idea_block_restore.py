from types import SimpleNamespace
import unittest

from app.services import idea_block_service


class FakeAsyncSession:
    def __init__(self) -> None:
        self.commit_count = 0

    async def commit(self) -> None:
        self.commit_count += 1


class RestoreIdeaBlockTests(unittest.IsolatedAsyncioTestCase):
    async def test_restore_scoped_idea_block_marks_deleted_block_active(self) -> None:
        block = SimpleNamespace(is_deleted=True)
        fake_db = FakeAsyncSession()
        original_get_scoped_idea_block = idea_block_service.get_scoped_idea_block

        async def fake_get_scoped_idea_block(idea_block_id, *, session_name, user_id, db):
            self.assertEqual(idea_block_id, 42)
            self.assertEqual(session_name, "lost-at-sea-session")
            self.assertEqual(user_id, 7)
            self.assertIs(db, fake_db)
            return block

        try:
            idea_block_service.get_scoped_idea_block = fake_get_scoped_idea_block
            restored = await idea_block_service.restore_scoped_idea_block(
                42,
                session_name="lost-at-sea-session",
                user_id=7,
                db=fake_db,
            )
        finally:
            idea_block_service.get_scoped_idea_block = original_get_scoped_idea_block

        self.assertIs(restored, block)
        self.assertFalse(block.is_deleted)
        self.assertEqual(fake_db.commit_count, 1)

    async def test_restore_scoped_idea_block_leaves_active_block_unchanged(self) -> None:
        block = SimpleNamespace(is_deleted=False)
        fake_db = FakeAsyncSession()
        original_get_scoped_idea_block = idea_block_service.get_scoped_idea_block

        async def fake_get_scoped_idea_block(idea_block_id, *, session_name, user_id, db):
            return block

        try:
            idea_block_service.get_scoped_idea_block = fake_get_scoped_idea_block
            restored = await idea_block_service.restore_scoped_idea_block(
                42,
                session_name="lost-at-sea-session",
                user_id=7,
                db=fake_db,
            )
        finally:
            idea_block_service.get_scoped_idea_block = original_get_scoped_idea_block

        self.assertIs(restored, block)
        self.assertFalse(block.is_deleted)
        self.assertEqual(fake_db.commit_count, 0)


if __name__ == "__main__":
    unittest.main()
