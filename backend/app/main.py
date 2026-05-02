from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text as sql_text

from .config import CORS_ALLOW_CREDENTIALS, CORS_ALLOWED_ORIGINS, RESET_DB_ON_STARTUP, SKIP_DB_STARTUP, logger
from .db import engine
from .error_handlers import register_exception_handlers
from .models import Base
from .routes.api_spec import router as api_spec_router
from .routes.http import router as http_router
from .routes.ws import router as ws_router

OPENAPI_TAGS = [
    {"name": "Transcripts", "description": "Create and read transcript records."},
    {"name": "Idea Blocks", "description": "CRUD operations for generated idea blocks."},
    {"name": "Similarities", "description": "Manage similarity clusters and assign idea blocks to clusters."},
    {"name": "Task Items", "description": "Map idea blocks to external task item ids."},
    {"name": "Idea Block To Transcript", "description": "Map idea blocks to one or more transcripts."},
]

app = FastAPI(title="OmniObserve API", version="0.1.0", openapi_tags=OPENAPI_TAGS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)
register_exception_handlers(app)
app.include_router(http_router)
app.include_router(api_spec_router)
app.include_router(ws_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.on_event("startup")
async def startup() -> None:
    if SKIP_DB_STARTUP:
        logger.warning("Skipping database startup initialization because SKIP_DB_STARTUP is enabled")
        return

    async with engine.begin() as conn:
        await conn.execute(sql_text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.execute(sql_text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
        if RESET_DB_ON_STARTUP:
            logger.warning("RESET_DB_ON_STARTUP is enabled; dropping all metadata tables before startup create_all")
            await conn.run_sync(Base.metadata.drop_all)
            await conn.execute(sql_text("DROP TABLE IF EXISTS bullet_points CASCADE"))
            await conn.execute(sql_text("DROP TABLE IF EXISTS transcript_segments CASCADE"))
            await conn.execute(sql_text("DROP TYPE IF EXISTS visibility_enum CASCADE"))
            await conn.execute(sql_text("DROP TYPE IF EXISTS idea_visibility_enum CASCADE"))
            await conn.execute(sql_text("DROP TYPE IF EXISTS bullet_visibility_enum CASCADE"))
        await conn.execute(
            sql_text(
                """
                DO $$
                BEGIN
                    IF to_regclass('public.transcript') IS NOT NULL THEN
                        IF EXISTS (
                            SELECT 1
                            FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name = 'transcript'
                              AND column_name = 'session_id'
                        ) AND NOT EXISTS (
                            SELECT 1
                            FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name = 'transcript'
                              AND column_name = 'session_name'
                        ) THEN
                            ALTER TABLE transcript RENAME COLUMN session_id TO session_name;
                        END IF;

                        IF NOT EXISTS (
                            SELECT 1
                            FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name = 'transcript'
                              AND column_name = 'session_name'
                        ) THEN
                            ALTER TABLE transcript ADD COLUMN session_name varchar(255);
                            UPDATE transcript SET session_name = 'default_session' WHERE session_name IS NULL;
                            ALTER TABLE transcript ALTER COLUMN session_name SET NOT NULL;
                        END IF;

                        ALTER TABLE transcript
                        ALTER COLUMN session_name TYPE varchar(255)
                        USING session_name::text;
                    END IF;
                END $$;
                """
            )
        )
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(sql_text("DROP INDEX IF EXISTS idx_transcript_session_id"))
        await conn.execute(sql_text("CREATE INDEX IF NOT EXISTS idx_transcript_session_name ON transcript(session_name)"))
