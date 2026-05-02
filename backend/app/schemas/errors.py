from typing import Any

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    error_code: str
    message: str
    details: Any | None = None


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        error_code: str,
        message: str,
        details: Any | None = None,
    ):
        self.status_code = status_code
        self.error_code = error_code
        self.message = message
        self.details = details
        super().__init__(message)
