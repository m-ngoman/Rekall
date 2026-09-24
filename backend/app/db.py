from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

# Spend rows are written while the request that incurred them still holds a connection from the
# pool above, and waits on the write. Drawing from the same pool, a busy moment would make that
# write queue for a connection behind the very requests waiting on it — up to the pool's 30s
# checkout timeout, stalling each of them. A few connections of its own, given up on after two
# seconds, cost at most a lost row. See core/spend.py.
_spend_engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=2, max_overflow=3, pool_timeout=2)
SpendSession = sessionmaker(bind=_spend_engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
