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
    {"name": "Similarities", "description": "Manage similarity pairs between idea blocks."},
    {"name": "Task Items", "description": "Map idea blocks to external task item ids."},
    {"name": "Poster Task Items", "description": "CRUD operations for enhance-the-poster private task items."},
    {"name": "Idea Block To Transcript", "description": "Map idea blocks to one or more transcripts."},
    {"name": "Chat Messages", "description": "Public text chat messages for a session."},
    {"name": "Ranking Moves", "description": "Read ranking move history for a session."},
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

                        IF NOT EXISTS (
                            SELECT 1
                            FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name = 'transcript'
                              AND column_name = 'visibility'
                        ) THEN
                            ALTER TABLE transcript ADD COLUMN visibility varchar(16) NOT NULL DEFAULT 'public';
                            ALTER TABLE transcript ALTER COLUMN visibility SET DEFAULT 'private';
                        END IF;
                    END IF;
                END $$;
                """
            )
        )
        logger.info("startup_similarity_schema_compat_check_start")
        await conn.execute(
            sql_text(
                """
                DO $$
                DECLARE
                    similarity_id_type text;
                    fk_name text;
                BEGIN
                    IF to_regclass('public.idea_blocks') IS NOT NULL THEN
                        IF NOT EXISTS (
                            SELECT 1
                            FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name = 'idea_blocks'
                              AND column_name = 'is_deleted'
                        ) THEN
                            ALTER TABLE idea_blocks ADD COLUMN is_deleted boolean NOT NULL DEFAULT false;
                        END IF;

                        IF NOT EXISTS (
                            SELECT 1
                            FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name = 'idea_blocks'
                              AND column_name = 'task_name'
                        ) THEN
                            ALTER TABLE idea_blocks ADD COLUMN task_name varchar(64) NOT NULL DEFAULT 'lost-at-sea';
                        END IF;

                        SELECT data_type
                        INTO similarity_id_type
                        FROM information_schema.columns
                        WHERE table_schema = 'public'
                          AND table_name = 'idea_blocks'
                          AND column_name = 'similarity_id';

                        IF similarity_id_type = 'uuid' THEN
                            SELECT tc.constraint_name
                            INTO fk_name
                            FROM information_schema.table_constraints tc
                            JOIN information_schema.key_column_usage kcu
                              ON tc.constraint_name = kcu.constraint_name
                             AND tc.table_schema = kcu.table_schema
                            WHERE tc.table_schema = 'public'
                              AND tc.table_name = 'idea_blocks'
                              AND tc.constraint_type = 'FOREIGN KEY'
                              AND kcu.column_name = 'similarity_id'
                            LIMIT 1;

                            IF fk_name IS NOT NULL THEN
                                EXECUTE format('ALTER TABLE idea_blocks DROP CONSTRAINT %I', fk_name);
                            END IF;

                            DROP INDEX IF EXISTS idx_idea_blocks_similarity_id;
                            ALTER TABLE idea_blocks DROP COLUMN similarity_id;
                            ALTER TABLE idea_blocks ADD COLUMN similarity_id bigint;
                            CREATE INDEX IF NOT EXISTS idx_idea_blocks_similarity_id ON idea_blocks(similarity_id);

                            DROP TABLE IF EXISTS similarities CASCADE;
                        END IF;
                    END IF;

                    IF to_regclass('public.similarities') IS NOT NULL THEN
                        IF EXISTS (
                            SELECT 1
                            FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name = 'similarities'
                              AND column_name = 'similarity_reason'
                        ) THEN
                            DROP TABLE similarities CASCADE;
                        ELSIF NOT EXISTS (
                            SELECT 1
                            FROM information_schema.columns
                            WHERE table_schema = 'public'
                              AND table_name = 'similarities'
                              AND column_name = 'is_same_reason'
                        ) THEN
                            ALTER TABLE similarities ADD COLUMN is_same_reason boolean NOT NULL DEFAULT true;
                        END IF;
                    END IF;
                END $$;
                """
            )
        )
        logger.info("startup_similarity_schema_compat_check_done")
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(sql_text("DROP INDEX IF EXISTS idx_transcript_session_id"))
        await conn.execute(sql_text("CREATE INDEX IF NOT EXISTS idx_transcript_session_name ON transcript(session_name)"))
        await conn.execute(sql_text("CREATE INDEX IF NOT EXISTS idx_transcript_visibility ON transcript(visibility)"))
        await conn.execute(sql_text("CREATE INDEX IF NOT EXISTS idx_idea_blocks_task_name ON idea_blocks(task_name)"))
        await conn.execute(sql_text("CREATE INDEX IF NOT EXISTS idx_idea_blocks_session_task ON idea_blocks(session_name, task_name)"))
        await conn.execute(sql_text("CREATE INDEX IF NOT EXISTS idx_similarities_idea_block_id_1 ON similarities(idea_block_id_1)"))
        await conn.execute(sql_text("CREATE INDEX IF NOT EXISTS idx_similarities_idea_block_id_2 ON similarities(idea_block_id_2)"))
        await conn.execute(
            sql_text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_similarities_pair "
                "ON similarities (LEAST(idea_block_id_1, idea_block_id_2), GREATEST(idea_block_id_1, idea_block_id_2))"
            )
        )
