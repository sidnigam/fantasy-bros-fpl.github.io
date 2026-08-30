"""Turn cached raw FPL data into metrics.json + rendered static pages.

Usage:
  python scripts/build.py               # build every league from cached raw/
  python scripts/build.py --seed-roster # (re)create data/<slug>/roster.csv stubs
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path

import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "templates"

CHIP_LABELS = {
    "wildcard": "Wildcard",
    "bboost": "Bench Boost",
    "3xc": "Triple Captain",
    "freehit": "Free Hit",
    "manager": "Assistant Manager",
}
HAUL_THRESHOLD = 6  # a captain scoring >= this counts as "delivered"
PODIUM_SIZE = 3

GROUP_EMOJI = {
    "UNH Wildcats": "\U0001F63B",
    "CU Boulder Buffs": "\U0001F9AC",
    "Boston gang": "\U0001F306",
    "India squad": "\U0001F1EE\U0001F1F3",
    "Midwesterners": "\U0001F3D4️",
    "West coast fam": "\U0001F309",
    "Just here for shits and giggles": "\U0001F92D",
    "Bedford High School Bulldogs": "\U0001F436",
}
# Dark-surface-legible takes on each club's identity colour.
CLUB_COLORS = {
    "Man Utd": "#E4483B",
    "Man City": "#6CABDD",
    "Liverpool": "#E23D4C",
    "Arsenal": "#FB5A5C",
    "Chelsea": "#2F7BEA",
    "Spurs": "#C7D2EC",
    "Tottenham": "#C7D2EC",
    "Newcastle": "#BFBFBF",
    "Leeds": "#F2C94C",
    "Real Madrid": "#ECE8DA",
    "Everton": "#4C7DE0",
    "Aston Villa": "#9FC6EA",
    "Messi Fan": "#75AADB",
}
CLUB_COLOR_DEFAULT = "#8A897E"
# Short codes for "clubs" that aren't Premier League teams (roster-only labels).
CLUB_SHORT = {
    "Cricket Fans": "CRI",
    "Messi Fan": "MSI",
}


# --------------------------------------------------------------------------- io

def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def load_leagues() -> list[dict]:
    return yaml.safe_load((ROOT / "config" / "leagues.yml").read_text())["leagues"]


# ---------------------------------------------------------------------- roster

ROSTER_FIELDS = ["entry_id", "team_name", "real_name", "phone", "group", "club"]


def seed_roster(slug: str, standings: list[dict], raw_dir: Path, teams: dict) -> None:
    """Write roster.csv pre-filled with names + club guessed from favourite_team."""
    path = ROOT / "data" / slug / "roster.csv"
    rows = []
    for row in standings:
        eid = row["entry"]
        fav = load_json(raw_dir / f"entry_{eid}.json").get("favourite_team")
        rows.append(
            {
                "entry_id": eid,
                "team_name": row["entry_name"],
                "real_name": row["player_name"],
                "phone": "",
                "group": "",
                "club": teams[fav]["name"] if fav in teams else "",
            }
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=ROSTER_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    print(f"  wrote {path.relative_to(ROOT)} ({len(rows)} managers). "
          f"Fill in the 'group' column (and fix 'club') from the polls.")


def load_roster(slug: str) -> dict[int, dict]:
    path = ROOT / "data" / slug / "roster.csv"
    if not path.exists():
        return {}
    with path.open(newline="") as fh:
        return {int(r["entry_id"]): r for r in csv.DictReader(fh)}


# --------------------------------------------------------------------- metrics

def total_through(hist_by_gw: dict[int, dict], gw: int) -> int | None:
    """Cumulative total_points (already net of hits) at or before `gw`."""
    seen = [g for g in hist_by_gw if g <= gw]
    return hist_by_gw[max(seen)]["total_points"] if seen else None


def build_managers(standings: list[dict], raw_dir: Path, roster: dict, teams: dict) -> list[dict]:
    name_to_short = {t["name"]: t["short_name"] for t in teams.values()}
    managers = []
    for row in standings:
        eid = row["entry"]
        history = load_json(raw_dir / f"history_{eid}.json")
        r = roster.get(eid, {})
        fav = load_json(raw_dir / f"entry_{eid}.json").get("favourite_team")
        groups = [g.strip() for g in re.split(r"[;|]", r.get("group") or "") if g.strip()]
        roster_club = (r.get("club") or "").strip()
        if roster_club.lower() in {"none", "n/a", "na", "-", "—"}:
            roster_club = "—"  # explicitly "supports no club" — excluded from the club chart
        club = roster_club or (teams[fav]["name"] if fav in teams else "")
        fav_short = teams[fav]["short_name"] if fav in teams else ""
        # short code for the pill: prefer the (possibly roster-overridden) club,
        # fall back to the FPL favourite team. Non-PL clubs just get no pill.
        club_short = "" if club in ("", "—") else (
            CLUB_SHORT.get(club) or name_to_short.get(club) or fav_short
        )
        managers.append(
            {
                "entry_id": eid,
                "team_name": row["entry_name"],
                "real_name": row["player_name"],
                "group": "; ".join(groups),
                "groups": groups,
                "club": club,
                "club_short": club_short,
                "history": history["current"],
                "hist_by_gw": {h["event"]: h for h in history["current"]},
                "chips": history["chips"],
            }
        )
    return managers


def attach_league_ranks(managers: list[dict], finished: list[int]) -> None:
    for gw in finished:
        ordered = sorted(
            managers,
            key=lambda m: (total_through(m["hist_by_gw"], gw) or -1),
            reverse=True,
        )
        for i, m in enumerate(ordered, 1):
            has_row = any(g <= gw for g in m["hist_by_gw"])
            m.setdefault("league_rank", {})[gw] = i if has_row else None


def attach_captains(managers: list[dict], finished: list[int], raw_dir: Path, elements: dict) -> None:
    live = {}
    for gw in finished:
        data = load_json(raw_dir / f"live_{gw}.json")
        live[gw] = {e["id"]: e["stats"]["total_points"] for e in data["elements"]}
    for m in managers:
        caps = []
        for gw in finished:
            picks = load_json(raw_dir / f"picks_{m['entry_id']}_{gw}.json")
            if picks.get("missing"):
                continue
            cap = next((p for p in picks["picks"] if p["is_captain"]), None)
            if not cap:
                continue
            base = live[gw].get(cap["element"], 0)
            mult = cap["multiplier"] or 2
            el = elements.get(cap["element"], {})
            caps.append(
                {
                    "gw": gw,
                    "element": cap["element"],
                    "name": el.get("web_name", "?"),
                    "multiplier": mult,
                    "base_points": base,
                    "points": base * mult,
                    "hauled": base >= HAUL_THRESHOLD,
                    "chip": picks.get("active_chip"),
                }
            )
        m["captains"] = caps
        m["caps_by_gw"] = {c["gw"]: c for c in caps}


# ------------------------------------------------------------------ chart data

def chart_bump(managers, finished):
    return {
        "gws": finished,
        "series": [
            {
                "name": m["team_name"],
                "real_name": m["real_name"],
                "group": m["group"],
                "ranks": [m["league_rank"].get(gw) for gw in finished],
            }
            for m in managers
        ],
    }


def chart_points_race(managers, finished):
    leader = {gw: max((total_through(m["hist_by_gw"], gw) or 0) for m in managers) for gw in finished}
    series = []
    for m in managers:
        totals = [total_through(m["hist_by_gw"], gw) for gw in finished]
        series.append(
            {
                "name": m["team_name"],
                "real_name": m["real_name"],
                "totals": totals,
                "gap": [None if t is None else leader[gw] - t for gw, t in zip(finished, totals)],
            }
        )
    return {"gws": finished, "series": series}


def _mgr_label(team: str, manager: str) -> str:
    """Two-line Plotly axis label: team on top, manager name muted beneath."""
    return f'{team}<br><span style="font-size:0.8em;color:#8a897e">{manager}</span>'


def chart_podium(managers, finished):
    firsts, podiums = {}, {}
    for gw in finished:
        ranked = sorted(
            (m for m in managers if m["hist_by_gw"].get(gw)),
            key=lambda m: m["hist_by_gw"][gw]["points"],
            reverse=True,
        )
        for pos, m in enumerate(ranked, 1):
            if pos == 1:
                firsts[m["team_name"]] = firsts.get(m["team_name"], 0) + 1
            if pos <= PODIUM_SIZE:
                podiums[m["team_name"]] = podiums.get(m["team_name"], 0) + 1
    tm2mgr = {m["team_name"]: m["real_name"] for m in managers}
    names = sorted(podiums, key=lambda n: (podiums[n], firsts.get(n, 0)), reverse=True)
    return {
        "managers": names,
        "labels": [_mgr_label(n, tm2mgr.get(n, "")) for n in names],
        "firsts": [firsts.get(n, 0) for n in names],
        "podiums": [podiums.get(n, 0) - firsts.get(n, 0) for n in names],  # 2nd/3rd only, stacks on firsts
    }


def chart_bench(managers):
    ranked = sorted(managers, key=lambda m: sum(h["points_on_bench"] for h in m["history"]), reverse=True)
    return {
        "managers": [m["team_name"] for m in ranked],
        "labels": [_mgr_label(m["team_name"], m["real_name"]) for m in ranked],
        "points": [sum(h["points_on_bench"] for h in m["history"]) for m in ranked],
    }


def chart_hits(managers):
    ranked = sorted(managers, key=lambda m: sum(h["event_transfers_cost"] for h in m["history"]), reverse=True)
    return {
        "managers": [m["team_name"] for m in ranked],
        "labels": [_mgr_label(m["team_name"], m["real_name"]) for m in ranked],
        "hits": [sum(h["event_transfers_cost"] for h in m["history"]) for m in ranked],
        "counts": [sum(h["event_transfers_cost"] // 4 for h in m["history"]) for m in ranked],
    }


def chart_consistency(managers, finished):
    rows = []
    for m in managers:
        scores = [m["hist_by_gw"][gw]["points"] for gw in finished if m["hist_by_gw"].get(gw)]
        if scores:
            rows.append({"name": m["team_name"], "scores": scores, "median": statistics.median(scores)})
    rows.sort(key=lambda r: r["median"], reverse=True)
    return {"managers": [r["name"] for r in rows], "scores": [r["scores"] for r in rows]}


def chart_captaincy(managers, finished, elements):
    rows = []
    season_counts: dict[str, int] = {}
    for gw in finished:
        picks = [m["caps_by_gw"][gw] for m in managers if m.get("caps_by_gw", {}).get(gw)]
        if not picks:
            continue
        tally: dict[str, int] = {}
        for c in picks:
            tally[c["name"]] = tally.get(c["name"], 0) + 1
            season_counts[c["name"]] = season_counts.get(c["name"], 0) + 1
        top_name = max(tally, key=tally.get)
        best = max(picks, key=lambda c: c["points"])
        best_mgr = next(m for m in managers if m.get("caps_by_gw", {}).get(gw) is best)
        rows.append(
            {
                "gw": gw,
                "top_captain": top_name,
                "count": tally[top_name],
                "pct": round(100 * tally[top_name] / len(picks)),
                "avg_points": round(statistics.mean(c["points"] for c in picks), 1),
                "haul_rate": round(100 * sum(c["hauled"] for c in picks) / len(picks)),
                "best_manager": best_mgr["team_name"],
                "best_points": best["points"],
            }
        )
    ordered = sorted(season_counts, key=season_counts.get, reverse=True)[:12]
    return {
        "rows": rows,
        "season": {"names": ordered, "counts": [season_counts[n] for n in ordered]},
    }


def _cohort_stats(members, finished):
    total = statistics.mean(
        [total_through(m["hist_by_gw"], finished[-1]) or 0 for m in members]
    )
    ranks = [m["league_rank"].get(finished[-1]) for m in members if m["league_rank"].get(finished[-1])]
    return round(total, 1), (round(statistics.mean(ranks), 1) if ranks else None)


def _cohort_members(members, finished):
    """Members sorted by current league rank (best first)."""
    gw = finished[-1]
    ordered = sorted(members, key=lambda m: m["league_rank"].get(gw) or 999)
    return [
        {"manager": m["real_name"], "team": m["team_name"], "rank": m["league_rank"].get(gw)}
        for m in ordered
    ]


def chart_groups(managers, finished):
    grouped: dict[str, list] = {}
    for m in managers:
        for g in m["groups"]:
            grouped.setdefault(g, []).append(m)
    if not grouped or not finished:
        return {"empty": True}
    leaderboard = []
    for name, members in grouped.items():
        avg_pts, avg_rank = _cohort_stats(members, finished)
        leaderboard.append({
            "group": name,
            "emoji": GROUP_EMOJI.get(name, "\U0001F3F3️"),
            "n": len(members),
            "avg_points": avg_pts,
            "avg_rank": avg_rank,
            "members": _cohort_members(members, finished),
        })
    leaderboard.sort(key=lambda r: r["avg_points"], reverse=True)
    trajectory = []
    for name, members in grouped.items():
        series = []
        for gw in finished:
            rr = [m["league_rank"].get(gw) for m in members if m["league_rank"].get(gw)]
            series.append(round(statistics.mean(rr), 2) if rr else None)
        trajectory.append({"group": name, "emoji": GROUP_EMOJI.get(name, ""), "avg_rank": series})
    return {"empty": False, "leaderboard": leaderboard, "gws": finished, "trajectory": trajectory}


def chart_clubs(managers, finished):
    grouped: dict[str, list] = {}
    for m in managers:
        if m["club"] and m["club"] != "—":
            grouped.setdefault(m["club"], []).append(m)
    if not grouped or not finished:
        return {"empty": True}
    rows = []
    for name, members in grouped.items():
        avg_pts, avg_rank = _cohort_stats(members, finished)
        rows.append(
            {
                "club": name,
                "short": members[0]["club_short"] or name,
                "color": CLUB_COLORS.get(name, CLUB_COLOR_DEFAULT),
                "n": len(members),
                "avg_points": avg_pts,
                "avg_rank": avg_rank,
                "members": _cohort_members(members, finished),
            }
        )
    rows.sort(key=lambda r: r["avg_points"], reverse=True)
    return {"empty": False, "leaderboard": rows}


# ----------------------------------------------------------------------- h2h

def build_h2h(cfg: dict, managers: list[dict], finished: list[int], raw_dir: Path) -> dict | None:
    """Standings + latest-gameweek fixtures for an optional head-to-head league."""
    h2h_id = cfg.get("h2h_id")
    std_path = raw_dir / "h2h_standings.json"
    if not h2h_id or not std_path.exists():
        return None

    raw = load_json(std_path)
    by_entry = {m["entry_id"]: m for m in managers}
    gw = finished[-1] if finished else None

    # each manager's chronological W/D/L run, from the per-gameweek match files
    form: dict[int, list] = {}
    for g in finished:
        mp = raw_dir / f"h2h_matches_{g}.json"
        if not mp.exists():
            continue
        for x in load_json(mp)["results"]:
            if x.get("is_bye") or not x.get("entry_2_entry"):
                continue
            e1, e2 = x["entry_1_entry"], x["entry_2_entry"]
            p1, p2 = x["entry_1_points"], x["entry_2_points"]
            r1, r2 = ("D", "D") if p1 == p2 else ("W", "L") if p1 > p2 else ("L", "W")
            form.setdefault(e1, []).append({"gw": g, "r": r1, "gf": p1, "ga": p2, "opp": x["entry_2_name"]})
            form.setdefault(e2, []).append({"gw": g, "r": r2, "gf": p2, "ga": p1, "opp": x["entry_1_name"]})

    table = []
    for r in raw["standings"]["results"]:
        m = by_entry.get(r["entry"])
        last = r.get("last_rank") or 0
        table.append(
            {
                "rank": r["rank"],
                "move": (last - r["rank"]) if last else 0,
                "team_name": r["entry_name"],
                "real_name": r["player_name"],
                "club_short": m["club_short"] if m else "",
                "played": r["matches_played"],
                "won": r["matches_won"],
                "drawn": r["matches_drawn"],
                "lost": r["matches_lost"],
                "points": r["total"],
                "points_for": r["points_for"],
                "form": form.get(r["entry"], [])[-6:],
            }
        )

    fixtures = []
    if gw is not None and (raw_dir / f"h2h_matches_{gw}.json").exists():
        for x in load_json(raw_dir / f"h2h_matches_{gw}.json")["results"]:
            if x.get("is_bye") or not x.get("entry_2_entry"):
                continue
            p1, p2 = x["entry_1_points"], x["entry_2_points"]
            fixtures.append(
                {
                    "home": {"team": x["entry_1_name"], "name": x["entry_1_player_name"], "points": p1},
                    "away": {"team": x["entry_2_name"], "name": x["entry_2_player_name"], "points": p2},
                    "result": "home" if p1 > p2 else "away" if p2 > p1 else "draw",
                }
            )
        fixtures.sort(key=lambda f: max(f["home"]["points"], f["away"]["points"]), reverse=True)

    return {
        "id": h2h_id,
        "name": raw["league"]["name"],
        "gw": gw,
        "n": len(table),
        "table": table,
        "fixtures": fixtures,
    }


# --------------------------------------------------------------------- awards

def build_awards(managers, finished):
    if not finished:
        return {"gw": None, "cards": []}
    gw = finished[-1]
    playing = [m for m in managers if m["hist_by_gw"].get(gw)]
    if not playing:
        return {"gw": gw, "cards": []}

    def hist(m):
        return m["hist_by_gw"][gw]

    def winner(m, note=""):
        return {"team": m["team_name"], "manager": m["real_name"],
                "rank": m["league_rank"].get(gw), "note": note}

    def card(emoji, title, detail, winners):
        return {"emoji": emoji, "title": title, "detail": detail, "winners": winners}

    def all_matching(pool, key, value):
        return [m for m in pool if key(m) == value]

    gw_scores = sorted({hist(m)["points"] for m in playing}, reverse=True)
    top_score = gw_scores[0]
    bench_max = max(hist(m)["points_on_bench"] for m in playing)
    low_score = gw_scores[-1]

    cards = [
        card("\U0001F451", "Manager of the Week", f"{top_score} pts",
             [winner(m) for m in all_matching(playing, lambda m: hist(m)["points"], top_score)]),
    ]
    if len(gw_scores) > 1:
        second = gw_scores[1]
        cards.append(card("\U0001F454", "Assistant to the Regional Manager of the Week", f"{second} pts",
                          [winner(m) for m in all_matching(playing, lambda m: hist(m)["points"], second)]))
    cards += [
        card("\U0001F944", "Wooden Spoon", f"{low_score} pts",
             [winner(m) for m in all_matching(playing, lambda m: hist(m)["points"], low_score)]),
        card("\U0001FA91", "Bench Warmer", f"{bench_max} pts left on the bench",
             [winner(m) for m in all_matching(playing, lambda m: hist(m)["points_on_bench"], bench_max)]),
    ]

    caps = [(m, m["caps_by_gw"][gw]) for m in playing if m.get("caps_by_gw", {}).get(gw)]
    if caps:
        best = max(c["points"] for _, c in caps)
        worst = min(c["points"] for _, c in caps)
        cards.append(card("\U0001F9B8", "Captain Marvel", f"{best} pts from the armband",
                          [winner(m, f'(C) {c["name"]}') for m, c in caps if c["points"] == best]))
        cards.append(card("\U0001F921", "Captain Blunder", f"{worst} pts from the armband",
                          [winner(m, f'(C) {c["name"]}') for m, c in caps if c["points"] == worst]))

    if len(finished) >= 2:
        prev = finished[-2]
        movers = [
            (m, m["league_rank"][prev] - m["league_rank"][gw])
            for m in playing
            if m["league_rank"].get(prev) and m["league_rank"].get(gw)
        ]
        best_climb = max((d for _, d in movers), default=0)
        if best_climb > 0:
            plural = "s" if best_climb != 1 else ""
            cards.append(card("\U0001F680", "Biggest Climb", f"up {best_climb} place{plural} this week",
                              [winner(m) for m, d in movers if d == best_climb]))
    return {"gw": gw, "cards": cards}


# --------------------------------------------------------------- standings/chips

def build_hero(managers, finished):
    if not finished:
        return {}
    gw = finished[-1]
    playing = [m for m in managers if m["hist_by_gw"].get(gw)]
    scores = [m["hist_by_gw"][gw]["points"] for m in playing]
    leader = min(managers, key=lambda m: m["league_rank"].get(gw) or 999)
    top = max(playing, key=lambda m: m["hist_by_gw"][gw]["points"])
    return {
        "gw": gw,
        "leader": leader["team_name"],
        "leader_total": leader["hist_by_gw"][gw]["total_points"],
        "top_score": max(scores),
        "top_name": top["team_name"],
        "avg_score": round(statistics.mean(scores), 1),
    }


def build_standings_table(managers, finished):
    if not finished:
        return []
    gw = finished[-1]
    prev = finished[-2] if len(finished) >= 2 else None
    rows = []
    for m in sorted(managers, key=lambda m: m["league_rank"].get(gw) or 999):
        rank = m["league_rank"].get(gw)
        prev_rank = m["league_rank"].get(prev) if prev else None
        move = (prev_rank - rank) if (prev_rank and rank) else 0
        h = m["hist_by_gw"].get(gw, {})
        rows.append(
            {
                "rank": rank,
                "move": move,
                "team_name": m["team_name"],
                "real_name": m["real_name"],
                "group": m["group"],
                "club_short": m["club_short"],
                "gw_points": h.get("points"),
                "total": h.get("total_points"),
            }
        )
    return rows


def build_chip_grid(managers, finished):
    gw = finished[-1] if finished else None
    used = []
    for m in managers:
        if not m["chips"]:
            continue
        used.append(
            {
                "team_name": m["team_name"],
                "real_name": m["real_name"],
                "rank": m["league_rank"].get(gw) if gw else None,
                "chips": [
                    {
                        "label": CHIP_LABELS.get(c["name"], c["name"].title()),
                        "gw": c["event"],
                        "points": (m["hist_by_gw"].get(c["event"], {}) or {}).get("points"),
                    }
                    for c in sorted(m["chips"], key=lambda c: c["event"])
                ],
            }
        )
    used.sort(key=lambda r: r["chips"][0]["gw"])
    return used


# ------------------------------------------------------------------ orchestrate

def build_league(cfg: dict, seed: bool) -> dict:
    slug = cfg["slug"]
    raw_dir = ROOT / "data" / slug / "raw"
    print(f"building {slug}...")

    bootstrap = load_json(raw_dir / "bootstrap.json")
    events = {e["id"]: e for e in bootstrap["events"]}
    elements = {el["id"]: el for el in bootstrap["elements"]}
    teams = {t["id"]: t for t in bootstrap["teams"]}
    finished = sorted(gw for gw, e in events.items() if e["finished"] and e["data_checked"])
    standings = load_json(raw_dir / "standings.json")["standings"]["results"]

    if seed or not (ROOT / "data" / slug / "roster.csv").exists():
        seed_roster(slug, standings, raw_dir, teams)

    roster = load_roster(slug)
    managers = build_managers(standings, raw_dir, roster, teams)
    attach_league_ranks(managers, finished)
    attach_captains(managers, finished, raw_dir, elements)

    started = [e["id"] for e in bootstrap["events"] if e["is_current"] or e["finished"]]
    current_gw = max(started) if started else 0

    league_info = {k: cfg[k] for k in ("slug", "name", "league_id", "blurb")}
    if cfg.get("h2h_id"):
        league_info["h2h_id"] = cfg["h2h_id"]

    metrics = {
        "league": league_info,
        "meta": {
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "current_gw": current_gw,
            "last_built_gw": finished[-1] if finished else 0,
            "n_managers": len(managers),
            "n_gws": len(finished),
            "has_groups": any(m["group"] for m in managers),
            "has_clubs": any(m["club"] for m in managers),
            "has_hits": any(h["event_transfers_cost"] for m in managers for h in m["history"]),
        },
        "hero": build_hero(managers, finished),
        "h2h": build_h2h(cfg, managers, finished, raw_dir),
        "standings": build_standings_table(managers, finished),
        "chips": build_chip_grid(managers, finished),
        "awards": build_awards(managers, finished),
        "charts": {
            "bump": chart_bump(managers, finished),
            "points_race": chart_points_race(managers, finished),
            "podium": chart_podium(managers, finished),
            "bench": chart_bench(managers),
            "hits": chart_hits(managers),
            "consistency": chart_consistency(managers, finished),
            "captaincy": chart_captaincy(managers, finished, elements),
            "groups": chart_groups(managers, finished),
            "clubs": chart_clubs(managers, finished),
        },
    }

    out = ROOT / "data" / slug / "metrics.json"
    out.write_text(json.dumps(metrics, separators=(",", ":")))
    print(f"  wrote {out.relative_to(ROOT)} (GW {metrics['meta']['last_built_gw']}, {len(managers)} managers)")
    return metrics


def render_site(all_metrics: list[dict]) -> None:
    env = Environment(
        loader=FileSystemLoader(TEMPLATES),
        autoescape=select_autoescape(["html"]),
    )
    leagues = [
        {"slug": m["league"]["slug"], "name": m["league"]["name"],
         "blurb": m["league"]["blurb"], "meta": m["meta"]}
        for m in all_metrics
    ]

    league_tpl = env.get_template("league.html")
    (ROOT / "leagues").mkdir(exist_ok=True)
    for m in all_metrics:
        html = league_tpl.render(
            m=m,
            metrics_json=json.dumps(m),
            leagues=leagues,
            current_slug=m["league"]["slug"],
            base_prefix="../",
        )
        (ROOT / "leagues" / f"{m['league']['slug']}.html").write_text(html)

    index_html = env.get_template("index.html").render(leagues=leagues, base_prefix="")
    (ROOT / "index.html").write_text(index_html)
    print(f"  rendered index.html + {len(all_metrics)} league page(s)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed-roster", action="store_true", help="(re)write roster.csv stubs and exit early if raw data is missing")
    args = parser.parse_args()

    all_metrics = [build_league(cfg, seed=args.seed_roster) for cfg in load_leagues()]
    render_site(all_metrics)


if __name__ == "__main__":
    main()
