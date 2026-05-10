from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..schemas import ChatMessageCreate, ChatMessageCreateRequest, ChatMessageResponse
from ..services.chat_message_service import create_chat_message, list_chat_messages_by_session

router = APIRouter(tags=["Chat Messages"])


@router.get(
    "/sessions/{session_name}/chat-messages",
    response_model=list[ChatMessageResponse],
    summary="List Chat Messages For Session",
)
async def read_session_chat_messages(
    session_name: str,
    limit: int = Query(200, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> list[ChatMessageResponse]:
    return await list_chat_messages_by_session(session_name, db, limit=limit)


@router.post(
    "/sessions/{session_name}/users/{user_id}/chat-messages",
    status_code=status.HTTP_201_CREATED,
    response_model=ChatMessageResponse,
    summary="Create Chat Message",
)
async def post_chat_message(
    session_name: str,
    user_id: int,
    payload: ChatMessageCreateRequest,
    db: AsyncSession = Depends(get_db),
) -> ChatMessageResponse:
    scoped_payload = ChatMessageCreate(
        session_name=session_name,
        user_id=user_id,
        message=payload.message,
        display_name=payload.display_name,
    )
    return await create_chat_message(scoped_payload, db)
