from fastapi import APIRouter

from .idea_block_to_transcript import router as idea_block_to_transcript_router
from .idea_blocks import router as idea_blocks_router
from .similarities import router as similarities_router
from .task_items import router as task_items_router
from .transcripts import router as transcripts_router

router = APIRouter(prefix="/api")

router.include_router(transcripts_router)
router.include_router(idea_blocks_router)
router.include_router(similarities_router)
router.include_router(task_items_router)
router.include_router(idea_block_to_transcript_router)
