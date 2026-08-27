"""Pull raw FPL API responses for a league into data/<slug>/raw/.

Caching rule:
  * bootstrap / standings / per-entry history+summary -> always refetched (they grow).
  * picks + live for a finished, data-checked GW -> immutable, fetched once.
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


def fetch_league(league_cfg: dict, raw_dir: Path, force: bool = False) -> list[int]:
    """Fetch everything needed to build one league. Returns finished GW ids."""
    raw_dir.mkdir(parents=True, exist_ok=True)

    bootstrap = api.bootstrap()
    _save(raw_dir / "bootstrap.json", bootstrap)
    finished = finished_gameweeks(bootstrap)

    standings = api.league_standings(int(league_cfg["league_id"]))
    _save(raw_dir / "standings.json", standings)
    entry_ids = [r["entry"] for r in standings["standings"]["results"]]
    print(f"  {len(entry_ids)} managers, finished GWs: {finished or 'none yet'}")

    for gw in finished:
        target = raw_dir / f"live_{gw}.json"
        if force or not target.exists():
            _save(target, api.event_live(gw))

    for i, eid in enumerate(entry_ids, 1):
        _save(raw_dir / f"entry_{eid}.json", api.entry(eid))
        _save(raw_dir / f"history_{eid}.json", api.entry_history(eid))
        for gw in finished:
            picks_path = raw_dir / f"picks_{eid}_{gw}.json"
            if not force and picks_path.exists():
                continue
            try:
                _save(picks_path, api.entry_picks(eid, gw))
            except RuntimeError:
                # Manager joined after this GW, or had no valid team.
                _save(picks_path, {"missing": True})
        if i % 10 == 0:
            print(f"    ...{i}/{len(entry_ids)} managers fetched")

    return finished
