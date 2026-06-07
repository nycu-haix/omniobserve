import asyncio
import hashlib
import json
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import HTTPException

from ..config import (
    OLLAMA_BASE_URL,
    OLLAMA_EMBED_MODEL,
    OLLAMA_EMBED_RETRY_ATTEMPTS,
    OLLAMA_EMBED_RETRY_DELAY_SECONDS,
    OLLAMA_TIMEOUT_SECONDS,
    logger,
)


async def create_text_embedding(text: str) -> list[float]:
    text = text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="text is required for embedding")

    attempts = max(1, OLLAMA_EMBED_RETRY_ATTEMPTS)
    logger.info(
        (
            "embedding_request_start provider=ollama url=%s model=%s text_chars=%s "
            "timeout_seconds=%s retry_attempts=%s input_hash=%s"
        ),
        OLLAMA_BASE_URL,
        OLLAMA_EMBED_MODEL,
        len(text),
        OLLAMA_TIMEOUT_SECONDS,
        attempts,
        _hash_text(text),
    )

    last_error: HTTPException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await asyncio.to_thread(_create_embedding_sync, text, attempt=attempt)
        except HTTPException as exc:
            if exc.status_code < 500 or attempt >= attempts:
                raise
            last_error = exc
            logger.warning(
                (
                    "embedding_request_retry provider=ollama url=%s model=%s attempt=%s "
                    "next_attempt=%s delay_seconds=%s status=%s detail=%s input_hash=%s"
                ),
                OLLAMA_BASE_URL,
                OLLAMA_EMBED_MODEL,
                attempt,
                attempt + 1,
                OLLAMA_EMBED_RETRY_DELAY_SECONDS,
                exc.status_code,
                exc.detail,
                _hash_text(text),
            )
            await asyncio.sleep(max(0, OLLAMA_EMBED_RETRY_DELAY_SECONDS))

    raise last_error or HTTPException(status_code=502, detail="Ollama embedding request failed")


async def warm_up_embedding_model() -> None:
    try:
        logger.info(
            "embedding_warmup_start provider=ollama url=%s model=%s",
            OLLAMA_BASE_URL,
            OLLAMA_EMBED_MODEL,
        )
        embedding = await create_text_embedding("warmup")
        logger.info(
            "embedding_warmup_done provider=ollama url=%s model=%s dimensions=%s",
            OLLAMA_BASE_URL,
            OLLAMA_EMBED_MODEL,
            len(embedding),
        )
    except Exception as exc:
        logger.warning(
            "embedding_warmup_failed provider=ollama url=%s model=%s error_type=%s error=%s",
            OLLAMA_BASE_URL,
            OLLAMA_EMBED_MODEL,
            exc.__class__.__name__,
            exc,
        )


def _create_embedding_sync(text: str, *, attempt: int) -> list[float]:
    url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/embed"
    text_hash = _hash_text(text)
    started_at = time.perf_counter()
    body = json.dumps({"model": OLLAMA_EMBED_MODEL, "input": text}).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=OLLAMA_TIMEOUT_SECONDS) as response:
            raw_response = response.read().decode("utf-8")
            payload = json.loads(raw_response)
    except HTTPError as exc:
        response_body = _read_http_error_body(exc)
        logger.exception(
            (
                "embedding_request_failed provider=ollama stage=http_status url=%s model=%s attempt=%s "
                "status=%s duration_ms=%.1f text_chars=%s input_hash=%s response_body=%s"
            ),
            url,
            OLLAMA_EMBED_MODEL,
            attempt,
            exc.code,
            _duration_ms(started_at),
            len(text),
            text_hash,
            response_body,
        )
        detail = f"Ollama embedding failed with HTTP {exc.code}"
        if response_body:
            detail = f"{detail}: {response_body}"
        raise HTTPException(status_code=502, detail=detail) from exc
    except (URLError, TimeoutError) as exc:
        logger.exception(
            (
                "embedding_request_failed provider=ollama stage=network url=%s model=%s attempt=%s "
                "duration_ms=%.1f timeout_seconds=%s text_chars=%s input_hash=%s error_type=%s error=%s"
            ),
            url,
            OLLAMA_EMBED_MODEL,
            attempt,
            _duration_ms(started_at),
            OLLAMA_TIMEOUT_SECONDS,
            len(text),
            text_hash,
            exc.__class__.__name__,
            exc,
        )
        raise HTTPException(status_code=502, detail="Ollama embedding service is unavailable") from exc
    except json.JSONDecodeError as exc:
        logger.exception(
            (
                "embedding_request_failed provider=ollama stage=json_parse url=%s model=%s attempt=%s "
                "duration_ms=%.1f text_chars=%s input_hash=%s response_body=%s"
            ),
            url,
            OLLAMA_EMBED_MODEL,
            attempt,
            _duration_ms(started_at),
            len(text),
            text_hash,
            _truncate(raw_response),
        )
        raise HTTPException(status_code=502, detail="Ollama embedding response is not valid JSON") from exc

    embedding = _extract_first_embedding(payload)
    if len(embedding) != 1024:
        raise HTTPException(status_code=502, detail=f"Ollama embedding dimension must be 1024, got {len(embedding)}")
    logger.info(
        "embedding_request_done provider=ollama url=%s model=%s attempt=%s dimensions=%s duration_ms=%.1f input_hash=%s",
        url,
        OLLAMA_EMBED_MODEL,
        attempt,
        len(embedding),
        _duration_ms(started_at),
        text_hash,
    )
    return embedding


def _extract_first_embedding(payload: dict[str, Any]) -> list[float]:
    embeddings = payload.get("embeddings")
    if not isinstance(embeddings, list) or not embeddings:
        raise HTTPException(status_code=502, detail="Ollama embedding response missing embeddings")

    first_embedding = embeddings[0]
    if not isinstance(first_embedding, list):
        raise HTTPException(status_code=502, detail="Ollama embedding response has invalid embedding shape")

    try:
        return [float(value) for value in first_embedding]
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Ollama embedding contains non-numeric values") from exc


def _duration_ms(started_at: float) -> float:
    return (time.perf_counter() - started_at) * 1000


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def _read_http_error_body(exc: HTTPError) -> str:
    try:
        return _truncate(exc.read().decode("utf-8", errors="replace").strip())
    except Exception:
        return ""


def _truncate(text: str, limit: int = 1000) -> str:
    return text[:limit]
