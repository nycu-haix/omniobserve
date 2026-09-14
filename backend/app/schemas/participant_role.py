from pydantic import BaseModel, Field


class ParticipantRoleUpdateRequest(BaseModel):
    role: str = Field(..., min_length=1)


class ParticipantRoleResponse(BaseModel):
    session_name: str
    participant_id: str
    participant_role: str
