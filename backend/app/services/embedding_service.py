import asyncio
import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import HTTPException

from ..config import OLLAMA_BASE_URL, OLLAMA_EMBED_MODEL, OLLAMA_TIMEOUT_SECONDS


async def create_title_embedding(title: str) -> list[float]:
    title = title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="title is required for embedding")

    return await asyncio.to_thread(_create_embedding_sync, title)


def _create_embedding_sync(title: str) -> list[float]:
    url = f"{OLLAMA_BASE_URL.rstrip('/')}/api/embed"
    body = json.dumps({"model": OLLAMA_EMBED_MODEL, "input": title}).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=OLLAMA_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Ollama embedding request failed: HTTP {exc.code}") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail="Ollama embedding service is unavailable") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Ollama embedding response is not valid JSON") from exc

    embedding = _extract_first_embedding(payload)
    if len(embedding) != 1024:
        raise HTTPException(status_code=502, detail=f"Ollama embedding dimension must be 1024, got {len(embedding)}")
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
