from fastapi import APIRouter

from .chat_messages import router as chat_messages_router
from .idea_block_to_transcript import router as idea_block_to_transcript_router
from .idea_blocks import router as idea_blocks_router
from .phase_task_item_snapshots import router as phase_task_item_snapshots_router
from .poster_idea_block_task_items import router as poster_idea_block_task_items_router
from .private_phase_task_items import router as private_phase_task_items_router
from .ranking_moves import router as ranking_moves_router
from .ranking_phase_snapshots import router as ranking_phase_snapshots_router
from .ranking_states import router as ranking_states_router
from .similarities import router as similarities_router
from .task_items import router as task_items_router
from .transcripts import router as transcripts_router

router = APIRouter(prefix="/api")

router.include_router(transcripts_router)
router.include_router(chat_messages_router)
router.include_router(ranking_moves_router)
router.include_router(ranking_phase_snapshots_router)
router.include_router(ranking_states_router)
router.include_router(idea_blocks_router)
router.include_router(similarities_router)
router.include_router(private_phase_task_items_router)
router.include_router(phase_task_item_snapshots_router)
router.include_router(poster_idea_block_task_items_router)
router.include_router(task_items_router)
router.include_router(idea_block_to_transcript_router)
