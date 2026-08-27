# Fantasy Bros FPL

Analytics site for our Fantasy Premier League mini-leagues, published with GitHub Pages.
Standings, position tracker, captaincy, chips, bench pain, group/club leaderboards and
auto-generated gameweek awards — refreshed after every gameweek.

Live site: **https://fantasy-bros-fpl.github.io/** (or your Pages URL)

## How it works

```
config/leagues.yml        which leagues get a page
data/<slug>/roster.csv     manager -> friend-group + club (you maintain this)
data/<slug>/raw/           cached FPL API responses (committed, so rebuilds are offline)
data/<slug>/metrics.json   everything the page renders, computed by build.py
scripts/fetch.py           pull the public FPL API
scripts/build.py           raw/ + roster.csv -> metrics.json -> static HTML
scripts/update.py          cron entrypoint: rebuild only when a new GW has finished
templates/ assets/         Jinja templates, CSS, Plotly chart code
index.html  leagues/*.html generated — do not edit by hand
```

No API key, no scraping — everything comes from the public
`fantasy.premierleague.com/api` endpoints.

## Updating after a gameweek

Automatic: `.github/workflows/update.yml` runs daily at 07:00 UTC. `scripts/update.py`
checks whether a gameweek has finished (and its bonus points are confirmed) since the
last build; if so it refetches, rebuilds and commits. Otherwise it does nothing. You can
also trigger it manually from the **Actions** tab (`Run workflow`).

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

## Adding another league

1. Add an entry to `config/leagues.yml` (`slug`, `name`, `league_id`, `blurb`).
2. `.venv/bin/python scripts/update.py --force` — fetches it and seeds its `roster.csv`.
3. Commit. It gets its own page at `leagues/<slug>.html` and shows up in the switcher.

## Local preview

```bash
.venv/bin/python -m http.server 8000    # then open http://localhost:8000
```
