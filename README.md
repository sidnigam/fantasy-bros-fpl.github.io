# Fantasy Bros FPL

Analytics site for our Fantasy Premier League mini-leagues, published with GitHub Pages.
Standings, position tracker, captaincy, chips, bench pain, group/club leaderboards and
auto-generated gameweek awards — refreshed daily, including partway through a gameweek.

Live site: **https://fantasy-bros-fpl.github.io/** (or your Pages URL)

## How it works

```
config/leagues.yml        which leagues get a page
data/<slug>/roster.csv     manager -> friend-group + club (you maintain this)
data/<slug>/punishments.yml  optional: gameweek blocks + dares for the punishment tracker
data/<slug>/raw/           cached FPL API responses (committed, so rebuilds are offline)
data/<slug>/metrics.json   everything the page renders, computed by build.py
scripts/fetch.py           pull the public FPL API (settled GWs cached, live GW refetched)
scripts/build.py           raw/ + roster.csv -> metrics.json -> static HTML
scripts/update.py          cron entrypoint: rebuild when a GW finishes or is in progress
templates/ assets/         Jinja templates, CSS, Plotly chart code
index.html  leagues/*.html generated — do not edit by hand
```

No API key, no scraping — everything comes from the public
`fantasy.premierleague.com/api` endpoints.

## Updating after (and during) a gameweek

Automatic: `.github/workflows/update.yml` runs daily at 07:00 UTC. `scripts/update.py`
refetches, rebuilds and commits when either a gameweek has finished (bonus points
confirmed) since the last build, **or** a gameweek is currently in progress — so a
2–3 day gameweek gets a fresh "GW N so far" build each morning it's live. Between
gameweeks it does nothing. Trigger it manually from the **Actions** tab (`Run workflow`).

While a gameweek is live, the standings, hero tiles, awards and head-to-head section
show **provisional** numbers (the h2h table is projected as if the GW ended now).
The per-gameweek charts and the group/club cohorts only move once the GW is settled,
so a half-played gameweek never distorts a trend line.

Manual:

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/update.py          # or --force to rebuild regardless
git add -A && git commit -m "GW update" && git push
```

## Filling in the roster (unlocks Group + Club charts)

`scripts/build.py --seed-roster` writes `data/<slug>/roster.csv` with every manager, their
name, and a best-guess `club` from their FPL "favourite team". Edit it to add the `group`
column (from the friend-group poll) and fix any wrong clubs, then rebuild. Managers left
blank just don't appear in those two charts.

```csv
entry_id,team_name,real_name,group,club
1423084,Califiorication,Jeet Baru,India Gang,Arsenal
```

## Punishment tracker (optional, per league)

Drop a `data/<slug>/punishments.yml` with the gameweek blocks:

```yaml
blocks:
  - { start: 1, end: 5,  dare: "" }
  - { start: 6, end: 10, dare: "loser sings karaoke" }
```

The page then shows a "Punishment tracker" section: whoever is top of the table at
the end of each block owes the bottom manager a dare. Only the block containing the
current gameweek is scored (top 3 / bottom 3, since positions move fast); finished
blocks show their final result, future blocks just show when they run. Fill in
`dare:` once it's been decided.

## Adding another league

1. Add an entry to `config/leagues.yml` (`slug`, `name`, `league_id`, `blurb`).
   Optionally add `h2h_id:` to also show that head-to-head league's table + weekly
   fixtures on the page.
2. `.venv/bin/python scripts/update.py --force` — fetches it and seeds its `roster.csv`.
3. Commit. It gets its own page at `leagues/<slug>.html` and shows up in the switcher.

The Group wars section only appears when the roster has a `group` column filled in,
so a league without friend-groups just omits it.

## Local preview

```bash
.venv/bin/python -m http.server 8000    # then open http://localhost:8000
```
