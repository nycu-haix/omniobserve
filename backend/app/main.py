from fastapi import FastAPI
from sqlalchemy import text as sql_text

from .config import SKIP_DB_STARTUP, logger
from .db import engine
from .error_handlers import register_exception_handlers
from .models import Base
from .routes.http import router as http_router
from .routes.ws import router as ws_router

app = FastAPI(title="OmniObserve API", version="0.1.0")
register_exception_handlers(app)
app.include_router(http_router)
app.include_router(ws_router)


@app.on_event("startup")
async def startup() -> None:
    if SKIP_DB_STARTUP:
        logger.warning("Skipping database startup initialization because SKIP_DB_STARTUP is enabled")
        return

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(sql_text("ALTER TABLE idea_blocks ADD COLUMN IF NOT EXISTS transcript TEXT"))
