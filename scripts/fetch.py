"""Pull raw FPL API responses for a league into data/<slug>/raw/.

Caching rule:
  * bootstrap / standings / per-entry history+summary -> always refetched (they grow).
  * picks + live for a finished, data-checked GW -> immutable, fetched once.
  * picks + live + h2h for the in-progress GW -> always refetched (they change
    daily as matches finish), so mid-gameweek builds show provisional numbers.
"""
from __future__ import annotations

import json
from pathlib import Path

import fpl_api as api


def _save(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")))


def finished_gameweeks(bootstrap: dict) -> list[int]:
    return sorted(
        e["id"] for e in bootstrap["events"] if e["finished"] and e["data_checked"]
    )


def current_gameweek(bootstrap: dict) -> int | None:
    """The in-progress gameweek: started (is_current) but not yet settled.

    Returns None between gameweeks and before the season kicks off. Its picks /
    live / h2h data changes every day until the GW is finished and data-checked.
    """
    cur = next((e for e in bootstrap["events"] if e["is_current"]), None)
    if cur and not (cur["finished"] and cur["data_checked"]):
        return cur["id"]
    return None


def fetch_league(league_cfg: dict, raw_dir: Path, force: bool = False) -> list[int]:
    """Fetch everything needed to build one league. Returns finished GW ids."""
    raw_dir.mkdir(parents=True, exist_ok=True)

    bootstrap = api.bootstrap()
    _save(raw_dir / "bootstrap.json", bootstrap)
    finished = finished_gameweeks(bootstrap)
    live_gw = current_gameweek(bootstrap)
    # GWs whose per-event data we need: settled ones (cached) + the live one
    # (refetched every run). `live_gw` may equal a value already in `finished`
    # in the brief window before it's data-checked — de-dupe.
    gws = finished + ([live_gw] if live_gw and live_gw not in finished else [])

    def stale(gw: int, path: Path) -> bool:
        return force or gw == live_gw or not path.exists()

    standings = api.league_standings(int(league_cfg["league_id"]))
    _save(raw_dir / "standings.json", standings)
    entry_ids = [r["entry"] for r in standings["standings"]["results"]]
    print(f"  {len(entry_ids)} managers, finished GWs: {finished or 'none yet'}"
          f"{f', live GW {live_gw}' if live_gw else ''}")

    for gw in gws:
        target = raw_dir / f"live_{gw}.json"
        if stale(gw, target):
            _save(target, api.event_live(gw))

    if live_gw:
        # fixture finished-flags, so a mid-gameweek build knows which matches
        # are done (for provisional scoring + auto-subs).
        _save(raw_dir / f"fixtures_{live_gw}.json", api.event_fixtures(live_gw))

    h2h_id = league_cfg.get("h2h_id")
    if h2h_id:
        _save(raw_dir / "h2h_standings.json", api.h2h_standings(int(h2h_id)))
        for gw in gws:
            target = raw_dir / f"h2h_matches_{gw}.json"
            if stale(gw, target):
                _save(target, api.h2h_matches(int(h2h_id), gw))

    for i, eid in enumerate(entry_ids, 1):
        _save(raw_dir / f"entry_{eid}.json", api.entry(eid))
        _save(raw_dir / f"history_{eid}.json", api.entry_history(eid))
        for gw in gws:
            picks_path = raw_dir / f"picks_{eid}_{gw}.json"
            if not stale(gw, picks_path):
                continue
            try:
                _save(picks_path, api.entry_picks(eid, gw))
            except RuntimeError:
                # Manager joined after this GW, or had no valid team.
                _save(picks_path, {"missing": True})
        if i % 10 == 0:
            print(f"    ...{i}/{len(entry_ids)} managers fetched")

    return finished
