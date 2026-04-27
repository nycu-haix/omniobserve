from openai import AsyncOpenAI

from .config import OPENAI_API_KEY, OPENAI_BASE_URL

openai_client = AsyncOpenAI(
    api_key=OPENAI_API_KEY or "dummy",
    base_url=OPENAI_BASE_URL,
)
