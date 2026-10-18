"""Postgres access (psycopg 3, async) and the migration runner."""

import pathlib

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .config import settings

MIGRATIONS_DIR = pathlib.Path(__file__).resolve().parent.parent / "migrations"


def make_pool(min_size: int = 1, max_size: int = 5) -> AsyncConnectionPool:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not set")
    return AsyncConnectionPool(
        settings.database_url,
        min_size=min_size,
        max_size=max_size,
        kwargs={"row_factory": dict_row, "autocommit": True},
        open=False,
    )


async def migrate(pool: AsyncConnectionPool) -> list[str]:
    """Apply every migrations/*.sql not yet recorded, in filename order, each in its own transaction."""
    applied_now = []
    async with pool.connection() as conn:
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS public.capture_schema_migrations "
            "(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        rows = await (await conn.execute("SELECT name FROM public.capture_schema_migrations")).fetchall()
        done = {r["name"] for r in rows}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in done:
                continue
            async with conn.transaction():
                await conn.execute(path.read_text(encoding="utf-8"))
                await conn.execute("INSERT INTO public.capture_schema_migrations (name) VALUES (%s)", (path.name,))
            applied_now.append(path.name)
    return applied_now
