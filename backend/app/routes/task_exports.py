import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..services.task_export_service import build_task_export_bundle

router = APIRouter(tags=["Task Exports"])


@router.get(
    "/sessions/{session_name}/task-package/manifest",
    summary="Preview Task Export Package Manifest",
    description=(
        "Build the task-scoped export manifest for a session without downloading the ZIP. "
        "The manifest lists present and missing artifacts for the completed task package."
    ),
)
async def read_task_package_manifest(
    session_name: str,
    task_id: str | None = Query(None, description="Task id override. Defaults to the task resolved from session_name."),
    cue_condition: str | None = Query(
        None,
        description="Fallback cue condition when no persisted phase snapshot exists. Use experimental/with_cue or control/no_cue.",
    ),
    db: AsyncSession = Depends(get_db),
) -> dict:
    bundle = await build_task_export_bundle(
        db,
        session_name=session_name,
        task_id=task_id,
        cue_condition=cue_condition,
    )
    return bundle.manifest


@router.get(
    "/sessions/{session_name}/task-package.zip",
    summary="Download Task Export Package",
    description=(
        "Download a task-scoped ZIP package with ranking snapshots, transcripts, idea blocks, "
        "public chat, cue metadata, phase timestamps, and a manifest/checklist."
    ),
)
async def download_task_package(
    session_name: str,
    task_id: str | None = Query(None, description="Task id override. Defaults to the task resolved from session_name."),
    cue_condition: str | None = Query(
        None,
        description="Fallback cue condition when no persisted phase snapshot exists. Use experimental/with_cue or control/no_cue.",
    ),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    bundle = await build_task_export_bundle(
        db,
        session_name=session_name,
        task_id=task_id,
        cue_condition=cue_condition,
    )
    return StreamingResponse(
        io.BytesIO(bundle.zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{bundle.filename}"'},
    )
