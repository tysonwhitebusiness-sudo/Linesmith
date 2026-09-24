# P3 · Matching: scraper games and players → app ids (B1, B2)

**Lane:** laptop (Python, line-buddy's venv). **Deploys:** none. **Needs:**
P2 (labels; P3 uses `prop_market_key` for the report), the operator's green
light.
**Goal:** every scraper game the app covers is linked to the app's own game
id, and every prop player to the app's athlete id, with **no wrong links**
(a miss is acceptable, a wrong match is not).

---

## What exists to build on (read 2026-09-24)

- **The scraper already clusters sources into one game.** `canon_games(game_key,
  sport, league_key, home_name, away_name, start_utc, women)` and
  `game_links(source, external_id → game_key, method, reversed)` link every
  source's event to one canonical game (`scraper/entities.py` `GameResolver`:
  both teams match in either orientation and starts within 120 min). So P3
  maps **each canonical game once**, not each source's event.
- **The app's games per sport, with rosters**
  (`python-odds-service/src/game_context.py`):
  - `load_mlb_games()`: from the `mlb:snapshot` cache; roster =
    `_roster_for_mlb_game`, the snapshot's subjects for that game;
    `game_id` = StatsAPI gamePk.
  - `load_sport_games(s)` for `nfl`, `cfb`, `nba`, `soccer_epl`,
    `soccer_mls`: ESPN scoreboard plus both teams' rosters (ESPN athlete ids);
    `game_id` = ESPN event id.
  - `load_nhl_games()`: NHL api-web.
  - `load_tennis_games('tennis_atp' | 'tennis_wta')`.
  - Each `Game` carries `game_id`, `home/away_team_name`, `home/away_abbr`,
    `game_date` (ISO start) and `roster: list[RosterEntry(subject_id,
    subject_name, team_abbr, position)]`.
- **Proven name matching:**
  - `harvester_scrape._match_game` (exact → ESPN abbreviation → containment
    ≥ `MIN_CONTAINMENT_LEN` → word-set → tennis "Surname F."), built on
    `entity_resolution.normalize_team_name` / `team_name_words`;
  - `entity_resolution.resolve_player` (exact normalized name, else last
    name + team, unique only, never a guess);
  - the scraper's `normalize_player` already turns "Last, First" around.
- **Not covered in this build: golf.** The app has no player props for golf
  (`prop_odds` holds none; golf uses its own tournament-lines pipeline), so
  Sleeper's golf props have no app home. They are counted `no-app-home` in
  the report and stay on the laptop (a D15 follow-up for the operator).

---

## Build

### 1. The bridge's own state DB — `odds-scraper/data/bridge.db` (new SQLite)

This is kept **separate from `scraper.db`** so the bridge never contends
with the scraper's single writer, which ran near capacity (~75% busy) on
2026-09-24. WAL mode is on. Tables:

```sql
CREATE TABLE game_links (
  game_key        TEXT PRIMARY KEY,          -- scraper canon_games.game_key
  app_sport       TEXT NOT NULL,             -- mlb|nfl|cfb|nba|nhl|soccer_epl|soccer_mls|tennis_atp|tennis_wta
  app_game_id     TEXT NOT NULL,
  reversed        INTEGER NOT NULL,          -- 1 = scraper home is the app's away
  method          TEXT NOT NULL,             -- exact|abbr|contain|words|person
  start_delta_min REAL,                      -- scraper start - app start
  app_start       TEXT,                      -- ISO, from Game.game_date
  linked_at       TEXT NOT NULL
);
CREATE INDEX game_links_app ON game_links(app_sport, app_game_id);
CREATE TABLE game_link_misses (              -- one row per canon game not linked, latest reason
  game_key TEXT PRIMARY KEY, app_sport TEXT, reason TEXT, detail TEXT, seen_at TEXT);
CREATE TABLE player_links (
  source        TEXT NOT NULL,
  player_norm   TEXT NOT NULL,               -- scraper prop_markets.player_norm
  app_game_id   TEXT NOT NULL,
  app_sport     TEXT NOT NULL,
  subject_id    TEXT NOT NULL,               -- app athlete id
  subject_name  TEXT NOT NULL,
  team_abbr     TEXT,
  position      TEXT,                        -- roster position (P2 position-dependent labels)
  method        TEXT NOT NULL,               -- exact|last_team
  linked_at     TEXT NOT NULL,
  PRIMARY KEY (source, player_norm, app_game_id)
);
CREATE TABLE player_link_misses (
  source TEXT, player_norm TEXT, app_game_id TEXT, reason TEXT, seen_at TEXT,
  PRIMARY KEY (source, player_norm, app_game_id));
```

The schema lives in `python-odds-service/src/bridge_state.py` (`open_state(path)`
creates it idempotently).

### 2. `python-odds-service/src/scraper_match.py` (new)

```python
SCRAPER_TO_APP_SPORT = {
    ("baseball", "mlb"): "mlb", ("football", "nfl"): "nfl", ("football", "ncaaf"): "cfb",
    ("basketball", "nba"): "nba", ("hockey", "nhl"): "nhl", ("soccer", "epl"): "soccer_epl",
    ("soccer", "mls"): "soccer_mls", ("tennis", "atp"): "tennis_atp", ("tennis", "wta"): "tennis_wta",
}
START_WINDOW_MIN = 180        # app vs scraper start; the scraper itself clusters at 120
DOUBLEHEADER_MARGIN_MIN = 60  # the nearest candidate must beat the next by this much

async def load_app_games(sport: str) -> list[Game]      # dispatch to the loaders above; cached 10 min
def link_game(canon: CanonGame, names: list[tuple[str, str]], games: list[Game]) -> GameLink | Miss
def link_player(source: str, player_norm: str, raw_name: str, game: Game) -> PlayerLink | Miss
async def run_matching(scraper_db: str, state_db: str, sports: list[str] | None = None) -> MatchSummary
```

**`link_game` rules, in order:**
1. `app_sport = SCRAPER_TO_APP_SPORT.get((canon.sport, canon.league_key))`.
   None → `Miss("no-app-sport")`. A women's game (`canon.women`) gets
   `Miss("women")` unless the sport is `tennis_wta`.
2. Candidates: games of that sport with `|canon.start_utc − game.game_date| ≤ START_WINDOW_MIN`.
   A canon game without a start is `Miss("no-start")`. None in the window →
   `Miss("no-game-in-window")`.
3. For each candidate, try every name pair the scraper has for the canonical
   game (`names`: the latest `(home_name, away_name)` of each linked source
   event, oriented by `game_links.reversed`, plus `canon.home_name/away_name`),
   in **both orientations**. The side test is `harvester_scrape._match_game`'s
   `side_matches` (exact normalized → ESPN abbreviation → containment ≥
   `MIN_CONTAINMENT_LEN`), then word-set equality on the whole pair. Tennis
   uses person matching: scraper `entities.person_match` on both players.
   **Move** `side_matches` and the word-set test out of `harvester_scrape.py`
   into `entity_resolution.py` (`match_team_pair(home, away, game) -> (method, reversed) | None`),
   and have `_match_game` call it, so one implementation serves both.
4. More than one candidate matches:
   - the one with the smallest `|Δstart|` wins **only if** the next one is
     at least `DOUBLEHEADER_MARGIN_MIN` further away;
   - otherwise `Miss("ambiguous", detail=<the ids>)`, never a guess.
5. A game already linked keeps its link. If a re-run links it to a
   **different** `app_game_id`, the old link stays, a
   `Miss("relink-conflict")` is recorded, and the report shows it.
   (Postponements get a new app game; a conflict is for a human.)

**`link_player` rules:**
1. The index is `build_roster_index(game.roster)`.
2. **Exact:** `normalize_name(raw_name)` in `index.by_full_name` → link
   (`method="exact"`).
3. **Last name + team:** the prop row carries no team, so try
   `resolve_player(raw_name, team, index)` for `team` in
   (`game.home_abbr`, `game.away_abbr`). Link only if **exactly one** team
   yields a match (`method="last_team"`); two → `Miss("ambiguous")`.
4. Otherwise `Miss("not-on-roster")`.
5. Position is copied from the roster entry (P2's position-dependent labels
   read it).

**MLB roster completeness.** `load_mlb_games` builds rosters from the
snapshot's subjects (players the app already tracks). If the report (§4)
shows MLB player links **< 95% of MLB prop rows**, add a fallback in
`scraper_match.load_app_games('mlb')`: merge each team's active roster from
`https://statsapi.mlb.com/api/v1/teams/{teamId}/roster?rosterType=active`
(`person.id` → subject_id, `person.fullName`, `position.abbreviation`),
cached 6 h, for players not already present. Record the before/after rates.

### 3. The CLI — `python-odds-service/scraper_match_run.py` (new)

```
python scraper_match_run.py [--sports mlb,nfl,...] [--report] [--sample 50]
```

- It opens `scraper.db` read-only (`mode=ro`) and `bridge.db` read-write,
  then runs `run_matching`.
- It links canonical games with `start_utc` in [now − 6 h, now + 14 d] and
  the player markets of linked games that were first seen in the last 3
  days.
- Output lines:
  - `sport · canon games · linked · ambiguous · no-game-in-window · other`
  - `sport · prop markets (rows) · players linked (% of rows) · not-on-roster · ambiguous`
- `--sample N` writes `docs/design/odds-build/results/p3-sample-<YYYY-MM-DD>.csv`
  with N random linked games and N random linked players per sport. Columns:
  scraper names, app names, start times, method. This is the file the hand
  check reads.
- It is the same entry point P6's bridge calls each cycle (P6 runs it every
  5 min for games starting in the next 36 h).

---

## Tests (these gate P4)

| test | kind | what it proves |
|---|---|---|
| `src/test_scraper_match.py` (new, hermetic → CI step) | Python | Fixtures, no network. **Game cases:** (1) exact names, same start → linked, `reversed=False`; (2) scraper home/away swapped → linked, `reversed=True`; (3) MLB doubleheader: app games 13:05 and 18:40, scraper start 18:35 → the 18:40 game; scraper 15:50 (both within 180, margin < 60) → `ambiguous`; (4) CFB "TCU" vs ESPN "TCU Horned Frogs"/abbr `TCU` → linked (`abbr`); (5) EPL "Man City" vs "Manchester City" → linked by word/contain rule, and "Man Utd" must NOT link to Manchester City; (6) start 5 h apart → `no-game-in-window`; (7) `('football','cfl')` → `no-app-sport`; (8) re-run finds another id → the old link is kept plus `relink-conflict`; (9) tennis "Sinner J." vs "Jannik Sinner" → `person`. **Player cases:** (10) "Ja'Marr Chase" / "JaMarr Chase" → exact after normalization; (11) "Ronald Acuña Jr." → exact; (12) "J. Smith" with one Smith on the away roster → `last_team`; (13) Smith on both rosters → `ambiguous`; (14) a name on neither roster → `not-on-roster`; (15) the position is copied |
| `src/test_harvester_scrape.py` (existing) | Python | unchanged after `side_matches` moves to `entity_resolution.match_team_pair` |
| live report | laptop | `scraper_match_run.py --report --sample 50` on a day with NFL + MLB + CFB slates: the linked share per sport and the not-on-roster list are recorded in this file's Result section |
| **hand check** | laptop | 50 linked games and 50 linked players per sport from the sample CSV, each read side by side: **zero wrong links**. One wrong link means fixing the rule and re-running, never accepting |

**Exit criteria:**
- the hermetic tests pass;
- the hand check shows zero wrong links;
- the match rates are recorded, including the MLB roster fallback decision
  (< 95% → added).

## Background checks (never gate P4)

- The report re-runs daily for 7 days (`scraper_match_run.py --report`
  from P6's schedule once P6 exists, by hand before that). It watches for
  sources whose names drift: a sport's linked share dropping more than 5
  points is investigated.

## Files touched

- New:
  - `python-odds-service/src/scraper_match.py`,
    `python-odds-service/src/bridge_state.py`;
  - `python-odds-service/scraper_match_run.py`;
  - `python-odds-service/src/test_scraper_match.py`;
  - `docs/design/odds-build/results/` (samples).
- Edited: `python-odds-service/src/entity_resolution.py`
  (`match_team_pair`), `python-odds-service/src/harvester_scrape.py` (calls
  it), `.github/workflows/ci.yml`.

## Result

**Closed 2026-09-24 ~23:15 UTC.** Built as specified, with the notes below.

**Live report** (`scraper_match_run.py --report --sample 50`, 23:05 UTC,
151 s, after the MLB fallback):

| sport | canon games | linked | ambiguous | no game in window | other (no name match) |
|---|---|---|---|---|---|
| cfb | 432 | 171 (39.6%) | 0 | 0 | 261 |
| mlb | 66 | 12 (18.2%) | 0 | 52 | 2 |
| nba | 42 | 1 (2.4%) | 0 | 41 | 0 |
| nfl | 32 | 32 (100%) | 0 | 0 | 0 |
| nhl | 83 | 55 (66.3%) | 0 | 28 | 0 |
| soccer_mls | 25 | 16 (64.0%) | 0 | 1 | 8 |
| tennis_atp | 24 | 5 (20.8%) | 0 | 12 | 7 |
| tennis_wta | 14 | 4 (28.6%) | 0 | 7 | 3 |

1,383 canonical games were in leagues the app does not cover.

| sport | prop rows | linked (% of rows) | not on roster | ambiguous |
|---|---|---|---|---|
| cfb | 2,618,873 | 89.4% | 269,973 | 7,551 |
| mlb | 127,897 | **98.3%** (88.7% before the fallback) | 2,216 | 0 |
| nfl | 2,608,455 | 99.6% | 9,722 | 5 |
| nhl | 142 | 0% (no roster, see below) | 142 | 0 |
| soccer_mls | 403,427 | 95.8% | 15,778 | 1,334 |
| tennis_atp / wta | 67 / 42 | 100% / 83.3% | 0 / 7 | 0 |

- **Why games miss:**
  - `no-game-in-window` is the app's own horizon: MLB's loader holds
    today's slate only, NBA's season has not started, and ESPN's tennis
    lists only some matches. The bridge (P6) runs for games in the next
    36 h, which are in the app's window.
  - CFB's 261 name misses are mostly FCS games that are not on ESPN's FBS
    scoreboard (Brown–Harvard, Duquesne–Rio Grande), plus name forms no
    safe rule bridges ("Sam Houston State" vs "Sam Houston Bearkats").
    Misses are accepted; no rule was loosened to catch them.
- **MLB roster fallback: added** (88.7% < 95%). The snapshot roster is the
  ~20 tracked players a game, **with no positions**, so the fallback also
  fills a missing position from StatsAPI. Without it, P2's
  position-dependent labels ("Strikeouts") could never resolve for MLB.
  98.3% after.
- **NHL:** `load_nhl_games` has no roster by design, so NHL players cannot
  link. It is 142 rows today (preseason). Routed to P6: add an api-web
  roster fetch in `load_app_games('nhl')` before NHL props matter.
- **Hand check (`results/p3-sample-2026-09-24.csv`): zero wrong links**
  in 170 games and 215 players. That is 50 per sport, or every link where
  a sport had fewer (NBA 1, ATP 5, WTA 4).
  - Games read side by side, including "Louisiana-Monroe" → UL Monroe,
    "Dallas vs Los Angeles FC" → FC Dallas vs LAFC, "Wang Xinyu" /
    "Xinyu Wang", and swapped tennis orientations.
  - Of the players, 208 are identical names. The 7 others are the same
    person: Gio/Giovanni Richardson, Benjamin/Ben Rice, Sam/Samuel Junqua,
    Baker-Whiting, Ajani "Jay" Fortune, Dorde/Djordje Mihailovic,
    Cheikh/Cheick Sabaly.
- **Rule changes and why:**
  - **Team matching** lives in `entity_resolution` (`team_side_match`,
    `team_words_match`, `surname_initial_matches`, `match_team_pair`), and
    the harvester's `_match_game` calls it with its pass order unchanged
    (`test_harvester_scrape` passes). Where the two sides matched by
    different rules, the pair's method is the **weaker** side, so case (4)
    tests the abbreviation rule with the other side exact.
  - **Tennis:** the scraper's `person_match` fails "Sinner J." (it reads
    "j" as the surname). `person_names_match` is that rule **or** the
    harvester's "Surname F." parse. It is ported, not imported, so CI can
    run it without the scraper repo.
  - **"Man City":** no rule bridged it, so `TEAM_NAME_ALIASES` gains an
    anchored `^man` → "manchester". "Man Utd" becomes "manchester
    united" and still never matches City (tested).
- **Tests:** `test_scraper_match` 21/21 (a CI step) and
  `test_harvester_scrape` pass.
- **Background check started:** the Windows task `OddsBridgeMatchReport`
  runs the report daily at 05:15 local into
  `odds-scraper\data\match_report.log` for 7 days. It watches for a
  sport's linked share dropping more than 5 points. Delete the task after
  2026-10-01, or when P6 schedules the report.
