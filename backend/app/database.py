"""SQLite engine and transaction helpers.

Two engines point at the same database file:

* the *read* engine starts ordinary deferred transactions;
* the *write* engine starts every transaction with ``BEGIN IMMEDIATE``, which takes
  SQLite's write lock up front. Mutations therefore run one at a time, and each one
  re-reads the latest committed state before checking its rules. Two requests racing
  for the same bed are serialized: the second sees the bed as occupied and gets a 409.

Partial unique indexes on ``allocations`` (one ACTIVE row per bed and per patient)
are a second line of defence enforced by the database itself.
"""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


class Database:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        url = f"sqlite:///{self.path.as_posix()}"
        self.read_engine = self._engine(url, immediate=False)
        self.write_engine = self._engine(url, immediate=True)
        self._read = sessionmaker(self.read_engine, expire_on_commit=False)
        self._write = sessionmaker(self.write_engine, expire_on_commit=False)

    @staticmethod
    def _engine(url: str, immediate: bool) -> Engine:
        engine = create_engine(url, connect_args={"timeout": 30, "check_same_thread": False})

        @event.listens_for(engine, "connect")
        def _on_connect(dbapi_conn, _record):  # noqa: ANN001
            dbapi_conn.isolation_level = None  # let SQLAlchemy emit BEGIN itself
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.close()

        @event.listens_for(engine, "begin")
        def _on_begin(conn):  # noqa: ANN001
            conn.exec_driver_sql("BEGIN IMMEDIATE" if immediate else "BEGIN")

        return engine

    def create_all(self) -> None:
        from . import models  # noqa: F401  (registers tables)

        Base.metadata.create_all(self.write_engine)

    def drop_all(self) -> None:
        from . import models  # noqa: F401

        Base.metadata.drop_all(self.write_engine)

    @contextmanager
    def read(self) -> Iterator[Session]:
        with self._read() as s:
            yield s

    @contextmanager
    def write(self) -> Iterator[Session]:
        """All-or-nothing unit of work. Any exception rolls everything back."""
        with self._write() as s:
            try:
                yield s
                s.commit()
            except BaseException:
                s.rollback()
                raise

    def dispose(self) -> None:
        self.read_engine.dispose()
        self.write_engine.dispose()
