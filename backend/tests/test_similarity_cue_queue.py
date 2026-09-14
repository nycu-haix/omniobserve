from types import SimpleNamespace as Obj
import unittest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from app.services import similarity_cue_queue as queue


def pair(pair_id=1, own_id=10, other_id=20):
    return Obj(id=pair_id, reason="same", is_same_reason=True,
               idea_block_1=Obj(id=own_id, user_id=1, title="Water", summary="Need water"),
               idea_block_2=Obj(id=other_id, user_id=2, title="Water", summary="Need water"))


def event(status=None, own=10, other=20, kind="similarity_cue"):
    return Obj(own_idea_block_id=own, other_idea_block_id=other, response_status=status,
               shown_at=1 if status else None, event_type=kind)


class QueueTests(unittest.IsolatedAsyncioTestCase):
    def test_pair_identity_survives_similarity_row_recreation(self):
        self.assertEqual(queue.pair_cue_id(10, 20), "pair-10-20")
        self.assertNotEqual(queue.pair_cue_id(10, 20), queue.pair_cue_id(20, 10))

    def test_late_shown_never_overrides_terminal_response(self):
        self.assertEqual(queue.response_for_pair([event("dismissed"), event("shown")], 10, 20), "dismissed")
        self.assertIsNone(queue.response_for_pair([event("shared", kind="similarity_reason_share")], 10, 20))
        self.assertIsNone(queue.response_for_pair([event("accepted", other=30)], 10, 20))

    async def test_snapshot_recovers_pair_status_and_existing_now_targets(self):
        db = Obj(execute=AsyncMock(return_value=Obj(scalars=lambda: Obj(all=lambda: [event("shown")]))))
        with patch.object(queue, "list_scoped_similarities", AsyncMock(return_value=[pair(), pair(99)])) as pairs, \
             patch("app.services.realtime.session_public_context_state", {"room": {"task_item_ids": [3]}}), \
             patch("app.services.public_context_matching.find_public_context_task_item_matches", AsyncMock(return_value=[Obj(idea_block_id=10, user_id=1), Obj(idea_block_id=20, user_id=2)])):
            result = await queue.list_cue_queue(db, session_name="room", user_id=1)
        pairs.assert_awaited_once_with(db=db, session_name="room", user_id=1)
        self.assertEqual(result["nowBlockIds"], ["10"])
        self.assertEqual(len(result["cues"]), 1)
        self.assertEqual(result["cues"][0]["responseStatus"], "shown")

    async def test_other_participants_cue_is_not_writable(self):
        with patch.object(queue, "list_scoped_similarities", AsyncMock(return_value=[])):
            with self.assertRaises(HTTPException) as error:
                await queue.save_cue_response(Obj(), session_name="room", user_id=3, cue_id="pair-10-20", response="shown")
        self.assertEqual(error.exception.status_code, 404)

    async def test_control_or_private_cannot_record_exposure(self):
        with patch.object(queue, "list_scoped_similarities", AsyncMock(return_value=[pair()])), \
             patch("app.services.realtime.is_similarity_cue_enabled", return_value=False):
            with self.assertRaises(HTTPException) as error:
                await queue.save_cue_response(Obj(), session_name="room", user_id=1, cue_id="pair-10-20", response="shown")
        self.assertEqual(error.exception.status_code, 409)

    async def test_retry_of_finished_cue_is_idempotent(self):
        db = Obj(execute=AsyncMock(side_effect=[None, Obj(scalar_one_or_none=lambda: event("accepted"))]))
        with patch.object(queue, "list_scoped_similarities", AsyncMock(return_value=[pair()])), \
             patch("app.services.realtime.is_similarity_cue_enabled", return_value=True):
            result = await queue.save_cue_response(db, session_name="room", user_id=1, cue_id="pair-10-20", response="shown")
        self.assertEqual(result["responseStatus"], "accepted")


if __name__ == "__main__":
    unittest.main()
