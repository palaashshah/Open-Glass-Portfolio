"""
Request timing.

WHY: the database is remote, so a request's time is mostly network round trips
to it. This logs, for every request, how long it took and how many SQL
statements it ran, so a slow screen can be traced to the request causing it.
"""
import logging
import time
from contextvars import ContextVar

from sqlalchemy import event

from database import engine

log = logging.getLogger("uvicorn.error")       # the logger uvicorn already prints
_queries: ContextVar = ContextVar("queries", default=None)


@event.listens_for(engine, "before_cursor_execute")
def _count_query(conn, cursor, statement, parameters, context, executemany):
    counter = _queries.get()
    if counter is not None:
        counter["count"] += 1


def add_timing(app) -> None:
    @app.middleware("http")
    async def log_timing(request, call_next):
        counter = {"count": 0}
        token = _queries.set(counter)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            _queries.reset(token)
        milliseconds = (time.perf_counter() - started) * 1000
        log.info("%s %s took %.0f ms, %d SQL statements",
                 request.method, request.url.path, milliseconds, counter["count"])
        response.headers["X-Process-Time-Ms"] = f"{milliseconds:.0f}"
        return response