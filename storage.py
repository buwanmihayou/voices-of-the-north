"""Database connection adapter for Supabase PostgreSQL and local SQLite tests."""

from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from typing import Any


def _load_env_file() -> None:
    explicit = os.environ.get("VTN_ENV_FILE")
    path = Path(explicit) if explicit else Path(__file__).with_name(".env")
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key:
            os.environ.setdefault(key, value)


_load_env_file()

DATABASE_URL = (
    os.environ.get("VTN_DATABASE_URL")
    or os.environ.get("SUPABASE_DB_URL")
    or os.environ.get("DATABASE_URL")
    or ""
).strip()
DATABASE_REQUIRED = os.environ.get("VTN_DATABASE_REQUIRED", "0") == "1"
SQLITE_PATH = Path(os.environ.get("VTN_DB_PATH", "records.db"))
_HAS_SUPABASE_URL = "supabase.co" in DATABASE_URL.lower() or "supabase.com" in DATABASE_URL.lower()
if DATABASE_URL:
    BACKEND = "supabase" if _HAS_SUPABASE_URL else "postgres"
else:
    BACKEND = "unconfigured" if DATABASE_REQUIRED else "sqlite"


class StorageConfigurationError(RuntimeError):
    pass


class Connection:
    def __init__(self, raw: Any, *, postgres: bool):
        self.raw = raw
        self.postgres = postgres

    def execute(self, sql: str, params: tuple[Any, ...] | None = None):
        statement = sql if not self.postgres else sql.replace("?", "%s")
        if params is None:
            return self.raw.execute(statement)
        return self.raw.execute(statement, params)

    def executescript(self, script: str) -> None:
        if not self.postgres:
            self.raw.executescript(script)
            return
        for statement in re.split(r";\s*(?=\S|$)", script):
            if statement.strip():
                self.raw.execute(statement)

    def commit(self) -> None:
        self.raw.commit()

    def close(self) -> None:
        self.raw.close()


def schema_for(sqlite_schema: str) -> str:
    if not is_postgres():
        return sqlite_schema
    return sqlite_schema.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGSERIAL PRIMARY KEY")


def is_postgres() -> bool:
    return bool(DATABASE_URL)


def backend_name() -> str:
    return BACKEND


def connect() -> Connection:
    if DATABASE_URL:
        if not DATABASE_URL.startswith(("postgres://", "postgresql://")):
            raise StorageConfigurationError("Supabase database URL must use postgresql://")
        try:
            import psycopg
        except ImportError as exc:
            raise StorageConfigurationError("psycopg is not installed") from exc
        url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
        return Connection(psycopg.connect(url, connect_timeout=5), postgres=True)
    if DATABASE_REQUIRED:
        raise StorageConfigurationError("DATABASE_URL is required but not configured")
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    return Connection(sqlite3.connect(SQLITE_PATH, timeout=5), postgres=False)


def safe_error(error: BaseException) -> str:
    text = str(error).strip() or error.__class__.__name__
    text = re.sub(r"postgres(?:ql)?://[^\s]+", "postgresql://[redacted]", text, flags=re.I)
    text = re.sub(r"(password=)[^\s]+", r"\1[redacted]", text, flags=re.I)
    return text[:300]
