"""Thin, polite client for the public Fantasy Premier League API.

No auth or key required. All endpoints are read-only JSON. We add a small
delay between calls and retry on transient errors so a full league sweep
(~150 requests) doesn't trip rate limiting.
"""
from __future__ import annotations

import time

import requests

BASE = "https://fantasy.premierleague.com/api"

_session = requests.Session()
_session.headers.update(
    {
        "User-Agent": "fantasy-bros-fpl-site/1.0 (+https://github.com/fantasy-bros)",
        "Accept": "application/json",
    }
)

# Politeness knobs. Tuned for a full sweep without hammering the API.
DELAY_SECONDS = 0.35
MAX_RETRIES = 4
BACKOFF_BASE = 2.0


def get_json(path: str, params: dict | None = None) -> dict:
    """GET {BASE}{path} and return parsed JSON, retrying transient failures."""
    url = f"{BASE}{path}"
    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = _session.get(url, params=params, timeout=30)
            if resp.status_code == 429 or resp.status_code >= 500:
                raise requests.HTTPError(f"{resp.status_code} for {url}")
            resp.raise_for_status()
            time.sleep(DELAY_SECONDS)
            return resp.json()
        except (requests.RequestException, ValueError) as err:
            last_err = err
            wait = BACKOFF_BASE ** attempt
            print(f"  ! {url} failed ({err}); retry {attempt + 1}/{MAX_RETRIES} in {wait:.0f}s")
            time.sleep(wait)
    raise RuntimeError(f"giving up on {url}: {last_err}")


# --- endpoint helpers -------------------------------------------------------

def bootstrap() -> dict:
    return get_json("/bootstrap-static/")


def league_standings(league_id: int) -> dict:
    """Classic league standings, following pagination (50 entries / page)."""
    page = 1
    merged: dict | None = None
    while True:
        chunk = get_json(f"/leagues-classic/{league_id}/standings/", {"page_standings": page})
        if merged is None:
            merged = chunk
        else:
            merged["standings"]["results"].extend(chunk["standings"]["results"])
        if not chunk["standings"]["has_next"]:
            break
        page += 1
    return merged


def h2h_standings(league_id: int) -> dict:
    """Head-to-head league standings, following pagination."""
    page = 1
    merged: dict | None = None
    while True:
        chunk = get_json(f"/leagues-h2h/{league_id}/standings/", {"page_standings": page})
        if merged is None:
            merged = chunk
        else:
            merged["standings"]["results"].extend(chunk["standings"]["results"])
        if not chunk["standings"]["has_next"]:
            break
        page += 1
    return merged


def h2h_matches(league_id: int, gw: int) -> dict:
    """All head-to-head fixtures for one gameweek, following pagination."""
    page = 1
    merged: dict | None = None
    while True:
        chunk = get_json(
            f"/leagues-h2h-matches/league/{league_id}/", {"page": page, "event": gw}
        )
        if merged is None:
            merged = chunk
        else:
            merged["results"].extend(chunk["results"])
        if not chunk["has_next"]:
            break
        page += 1
    return merged


def entry(entry_id: int) -> dict:
    return get_json(f"/entry/{entry_id}/")


def entry_history(entry_id: int) -> dict:
    return get_json(f"/entry/{entry_id}/history/")


def entry_picks(entry_id: int, gw: int) -> dict:
    return get_json(f"/entry/{entry_id}/event/{gw}/picks/")


def event_live(gw: int) -> dict:
    return get_json(f"/event/{gw}/live/")
