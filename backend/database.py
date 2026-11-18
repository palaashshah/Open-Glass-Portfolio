import contextvars
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor

from dotenv import load_dotenv
from sqlalchemy import create_engine, event, exc
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv()  # reads the .env file

DATABASE_URL = os.getenv("DATABASE_URL")  # gets the URL
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set. Add it to backend/.env (see the README).")

# SQLAlchemy 2.1 reads a bare "postgresql://" as the psycopg 3 driver, which
# requirements.txt does not install. Name the driver that is installed.
for prefix in ("postgresql://", "postgres://"):
    if DATABASE_URL.startswith(prefix):
        DATABASE_URL = "postgresql+psycopg2://" + DATABASE_URL[len(prefix):]

# The engine is the raw connection to your database. You set it once and then its used as needed.
#
# WHY these settings: the database is hosted remotely, so every SQL statement
# is a network round trip and opening a new connection costs about ten of
# them. The pool therefore keeps connections open and reuses them.
#   pool_size / max_overflow - 5 connections, kept open, and never more. A
#                              request that finds all five busy waits a moment
#                              for one, which is far quicker than opening a
#                              sixth. Kept small on purpose: everyone on the
#                              team connects to the same hosted database, and
#                              its pooler limits how many clients it accepts.
#   pool_recycle             - replace a connection after 30 minutes
#   keepalives               - the operating system keeps idle connections
#                              alive, so routers in between do not drop them
POOL_SIZE = 5
engine = create_engine(
    DATABASE_URL,
    pool_size=POOL_SIZE,
    max_overflow=0,
    pool_recycle=1800,
    connect_args=(
        {"keepalives": 1, "keepalives_idle": 30, "keepalives_interval": 10, "keepalives_count": 3}
        if DATABASE_URL.startswith("postgresql") else {}
    ),
)

# A connection that sat unused may have been closed by the database host. One
# that has been idle for longer than this is tested before it is used, and
# replaced if it is dead, so the user never sees the failure. Connections in
# steady use are not tested, which saves a round trip on every request.
IDLE_CHECK_SECONDS = 60


@event.listens_for(engine, "connect")
@event.listens_for(engine, "checkin")
def _remember_last_use(dbapi_connection, connection_record):
    connection_record.info["last_used"] = time.monotonic()


@event.listens_for(engine, "checkout")
def _test_if_idle(dbapi_connection, connection_record, connection_proxy):
    if time.monotonic() - connection_record.info.get("last_used", 0.0) < IDLE_CHECK_SECONDS:
        return
    previous = dbapi_connection.autocommit
    try:
        dbapi_connection.autocommit = True          # so the test leaves no transaction open
        cursor = dbapi_connection.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        dbapi_connection.autocommit = previous
    except Exception:
        raise exc.DisconnectionError()              # the pool discards it and opens a new one


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
# Each request gets its own DB session, then it closes. This is the standard pattern.

Base = declarative_base()


def get_db():
    db = SessionLocal()   # open a session
    try:
        yield db          # hands it over, but PAUSES here
                          # return db hands it over, function is DONE, no cleanup possible
    finally:
        db.close()        # ALWAYS close it, even if an error occurred, "run this no matter what — success or crash."


# -------------------------------------------------------------
# READING SEVERAL THINGS AT ONCE
# -------------------------------------------------------------
# A screen usually needs several unrelated lookups (investors, assessments,
# portfolios, ...). Run one after another, their round trips add up. Run at
# the same time, each on its own pooled connection, they take about as long
# as the slowest one. Read-only, so no transaction is opened: that saves the
# BEGIN and ROLLBACK round trips as well.
ReadSession = sessionmaker(autoflush=False, bind=engine.execution_options(isolation_level="AUTOCOMMIT"))
_readers = ThreadPoolExecutor(max_workers=POOL_SIZE)


def read_together(**lookups) -> dict:
    """Each lookup is a function that takes a session and returns its result.
    Returns {name: result}. For reading only; never use it to change data."""
    def run(lookup):
        with ReadSession() as db:
            return lookup(db)

    futures = {name: _readers.submit(contextvars.copy_context().run, run, lookup)
               for name, lookup in lookups.items()}
    return {name: future.result() for name, future in futures.items()}


def warm_pool(connections: int = POOL_SIZE - 1) -> None:
    """Open connections when the server starts, at the same time, so the first
    screen does not wait for each one to be opened. If that fails the server
    still starts; connections are then opened as requests need them."""
    opened = []
    try:
        for future in [_readers.submit(engine.connect) for _ in range(connections)]:
            opened.append(future.result())
    except Exception as error:
        logging.getLogger("uvicorn.error").warning("Could not open database connections early: %s", error)
    finally:
        for connection in opened:
            connection.close()      # back to the pool, still open



# from sqlalchemy import create_engine
# from sqlalchemy.orm import sessionmaker, declarative_base
# from dotenv import load_dotenv
# import os

# load_dotenv()  # reads the .env file

# DATABASE_URL = os.getenv("DATABASE_URL") # gets the URL

# engine = create_engine(DATABASE_URL) 
# # The engine is the raw connection to your database. You set it once and then its used as needed

# SessionLocal = sessionmaker(autocommit = False, autoflush= False, bind= engine)
# # Each request gets its own DB session, then it closes. This is the standard pattern.

# Base = declarative_base()

# def get_db():
#     db = SessionLocal()   # open a session
#     try:
#         yield db          # hands it over, but PAUSES here
#                           # return db hands it over, function is DONE, no cleanup possible
#     finally:
#         db.close()        # ALWAYS close it, even if an error occurred, "run this no matter what — success or crash."