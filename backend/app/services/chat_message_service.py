from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ChatMessage
from ..schemas import ChatMessageCreate

MAX_CHAT_HISTORY_LIMIT = 200


def normalize_chat_message_text(value: str) -> str:
    return value.strip()


async def create_chat_message(payload: ChatMessageCreate, db: AsyncSession) -> ChatMessage:
    message_text = normalize_chat_message_text(payload.message)
    if not message_text:
        raise HTTPException(status_code=400, detail="message cannot be empty")

    chat_message = ChatMessage(
        session_name=payload.session_name,
        user_id=payload.user_id,
        display_name=payload.display_name.strip() if payload.display_name else None,
        message=message_text,
    )
    db.add(chat_message)
    await db.commit()
    await db.refresh(chat_message)
    return chat_message


async def list_chat_messages_by_session(
    session_name: str,
    db: AsyncSession,
    *,
    limit: int = MAX_CHAT_HISTORY_LIMIT,
) -> list[ChatMessage]:
    bounded_limit = min(max(limit, 1), MAX_CHAT_HISTORY_LIMIT)
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.session_name == session_name, ChatMessage.is_deleted.is_(False))
        .order_by(ChatMessage.time_stamp.desc(), ChatMessage.id.desc())
        .limit(bounded_limit)
    )
    result = await db.execute(stmt)
    return list(reversed(result.scalars().all()))
