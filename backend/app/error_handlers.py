from typing import Any

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import logger
from .schemas import ApiError


def error_payload(error_code: str, message: str, details: Any | None = None) -> dict[str, Any]:
    return {"error_code": error_code, "message": message, "details": details}


async def handle_api_error(_: Any, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(exc.error_code, exc.message, exc.details),
    )


async def handle_validation_error(_: Any, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content=error_payload("INVALID_PAYLOAD", "Request validation failed", details=exc.errors()),
    )


async def handle_unexpected_error(_: Any, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled server error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content=error_payload("INTERNAL_SERVER_ERROR", "Unexpected server error"),
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, handle_api_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(Exception, handle_unexpected_error)
