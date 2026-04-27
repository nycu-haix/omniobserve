"""Backward-compatible entrypoint.

Keeps `uvicorn omniobserve_api:app` and
`uvicorn omniobserve.backend.omniobserve_api:app` working after refactor.
"""

try:
    from .app.main import app
except ImportError:
    from app.main import app
