from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from .config import DATABASE_URL

engine = create_async_engine(DATABASE_URL, echo=False)
try:
    from sqlalchemy.ext.asyncio import async_sessionmaker

    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
except ImportError:
    # Backward compatibility for older SQLAlchemy versions.
    SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session
