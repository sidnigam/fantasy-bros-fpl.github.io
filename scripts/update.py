"""Gameweek orchestrator, safe to run on a daily cron.

For each league, refetch and rebuild when either:
  * a gameweek has finished (and its bonus/data is confirmed) since the last
    build — the settled numbers changed, or
  * a gameweek is currently in progress — its provisional numbers move every
    day until it's done, so we refresh daily to keep "GW N so far" current.

Otherwise (between gameweeks) it does nothing, so the cron produces no commit.

Usage:
  python scripts/update.py            # normal cron run
  python scripts/update.py --force    # rebuild even if nothing has changed
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build as build_mod
import fpl_api as api
from fetch import current_gameweek, fetch_league, finished_gameweeks

ROOT = Path(__file__).resolve().parent.parent


def last_built_gw(slug: str) -> int:
    path = ROOT / "data" / slug / "metrics.json"
    if not path.exists():
        return 0
    return json.loads(path.read_text()).get("meta", {}).get("last_built_gw", 0)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    bootstrap = api.bootstrap()
    latest_finished = max(finished_gameweeks(bootstrap), default=0)
    live_gw = current_gameweek(bootstrap)
    live = bool(live_gw and live_gw > latest_finished)
    print(f"latest finished + checked GW: {latest_finished or 'none'}"
          f"{f'; GW {live_gw} in progress' if live else ''}")

    leagues = build_mod.load_leagues()
    to_build = []
    for cfg in leagues:
        built = last_built_gw(cfg["slug"])
        if args.force or latest_finished > built or live:
            reason = "GW in progress" if live and latest_finished <= built else "new finished GW"
            print(f"{cfg['slug']}: built through GW {built} -> refetch ({reason})")
            fetch_league(cfg, ROOT / "data" / cfg["slug"] / "raw", force=args.force)
            to_build.append(cfg)
        else:
            print(f"{cfg['slug']}: already current at GW {built}, skipping")

    if not to_build:
        print("nothing new — no rebuild")
        return 0

    buildable = [c for c in leagues if (ROOT / "data" / c["slug"] / "raw" / "bootstrap.json").exists()]
    all_metrics = [build_mod.build_league(cfg, seed=False) for cfg in buildable]
    build_mod.render_site(all_metrics)
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
