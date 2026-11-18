"""
Measures how far away the database is.

WHY: every SQL statement is one round trip to the database host. If a round
trip takes a quarter of a second, a screen that makes twenty of them takes
five seconds whatever the code does. This prints the numbers so the cause of
a slow screen is known, not guessed.

Usage (from backend/):  python scripts/check_latency.py
"""
import os
import statistics
import sys
import time

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from database import engine


def main():
    started = time.perf_counter()
    connection = engine.connect()
    connect_ms = (time.perf_counter() - started) * 1000
    try:
        trips = []
        for _ in range(10):
            started = time.perf_counter()
            connection.execute(text("SELECT 1"))
            trips.append((time.perf_counter() - started) * 1000)
        started = time.perf_counter()
        rows = connection.execute(text("SELECT asset_symbol, date, close_price FROM market_data")).fetchall()
        prices_ms = (time.perf_counter() - started) * 1000
    finally:
        connection.close()

    trip = statistics.median(trips)
    print(f"Host                       : {engine.url.host}:{engine.url.port}")
    print(f"Opening a connection       : {connect_ms:.0f} ms (paid once per pooled connection)")
    print(f"One round trip (SELECT 1)  : {trip:.0f} ms (median of 10)")
    print(f"Reading all {len(rows)} prices  : {prices_ms:.0f} ms (paid once, then kept in memory)")
    print()
    if trip < 30:
        print("The database is close. Round trips are not what makes a screen slow.")
    elif trip < 120:
        print("Each SQL statement costs a noticeable fraction of a second. Screens should use the")
        print("single-request endpoints (GET /overview, GET /investors/{id}/overview).")
    else:
        print("The database is far away (probably hosted in another continent). Every statement is slow,")
        print("so the number of requests per screen decides how long it takes. Use the single-request")
        print("endpoints; if it is still too slow, the Supabase project's region is the cause.")


if __name__ == "__main__":
    main()