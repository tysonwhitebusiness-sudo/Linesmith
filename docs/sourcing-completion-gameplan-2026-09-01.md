# Track F — finish the sourcing, then surface it

**Written 2026-09-01**, after Track E (6.25–6.28) closed. Everything below was
measured against the real files and the live database on that date, not
estimated. Where a number is an estimate it says so.

Two blocks with a **hard stop between them**:

```
6.30  complete the game-odds sourcing        six sources
6.31  NHL player_game_history backfill       unblocks the NHL prop grader
6.32  tennis player-id crosswalk             unblocks tennis player work
      ─────────── TRACK F GATE ───────────   operator review, nothing proceeds
6.33  market-history cards                   four cards, three shared components
```

Nothing in 6.33 begins until the operator has reviewed and approved the
sourcing block. That is the point of the gate, not a formality: 6.33's whole
value depends on the sourcing being real, and a card rendering a percentile off
285 games is a lie with a number on it.

---

## Why this track exists

`CURRENT.md` opened 2026-09-01 with **"The overnight sourcing + import run is
COMPLETE."** It was not, and the claim did not survive being tested. Asked the
only question that matters — *how many games have both a price and a result?* —
six of eight sports came back thin:

```
tennis 56,340   NBA 24,164   NHL 6,591   MLB 4,593
MLS 871   CFB 849   EPL 400   NFL 285
```

Three distinct causes, and only two were real gaps:

1. **A source ceiling, not a load failure.** NFL 285 is *exactly* one NFL season
   (272 + 13). CFB 849 ≈ one FBS season, EPL 400 ≈ one 380-game season. ESPN
   core publishes about one season of odds and those sports had no second
   source. Nothing was dropped.
2. **A silent loader bug.** `sbr_long_rows` reads the *NBA* file's column names,
   so NHL's entire 2007–2022 closing-moneyline history was skipped without an
   error.
3. **Sources listed in the plan and never fetched.** `USA.csv` sat on disk
   unread; nflverse and CFBD were in the source-priority table at 80 and had
   never been called.

**"Sourcing complete" meant "the sources we ingested were fully ingested."** It
was never tested against the question the model layer actually asks. That is
the same failure mode as `docs/model-rebuild-plan.md` §1 bar 1 — measuring the
thing that is easy to measure instead of the thing that decides the outcome.

### What Track F is worth

**~94,000 → ~174,000 trainable games**, and the shape matters more than the
total: NHL goes from unusable to level with NBA, NFL from one season to twenty,
MLS from one to fourteen, CFB from one to thirteen.

| Sport | Now | After 6.30 |
|---|---|---|
| Tennis ATP+WTA | 56,340 | 56,340 |
| MLB | 4,593 raw (37,907 incl. `historical_odds`) | **37,907**, of which 28,060 raw |
| NHL | 6,591 | **~24,150** |
| NBA | 24,164 | 24,164 |
| CFB | 849 | **13,728** spread · 13,223 total · 4,137 ML |
| NFL | 285 | **7,276** spread+total · 5,295 ML |
| MLS | 871 | **~6,150** |
| EPL | 400 | **~4,200** |

---

## 6.30 · Complete the game-odds sourcing

Six sources. All six are in hand — nothing is blocked on acquisition.

| Source | Delivers | Where it is |
|---|---|---|
| NHL SBR fix | 18,204 ML + 9,485 puck lines + 18,203 total prices | `nhl_odds/`, `nhl_odds_legacy/` (already read; wrong columns) |
| nflverse | 5,295 ML (2006+), 7,276 spread+total (1999+) | `github.com/nflverse/nfldata/raw/master/data/games.csv`, public |
| CFBD | 13,728 spread, 13,223 total (2013+), 4,137 ML (2021+) | API, `CFBD_API_KEY` in `.env.local`, verified working |
| EPL | 4,200 matches, 2015-08-08 → 2026-08-31 | 12 × `E0*.csv` in Downloads |
| MLS | 6,130 matches, 2012-03-10 → 2026-08-24 | `USA.csv` in Downloads |
| MLB raw | 28,060 games, 2010–2021 | 12 × `mlb-odds-YYYY.xlsx` in Downloads |

**Operator decision, settled:** MLB raw prices load into `odds_archive`;
`historical_odds` is left **untouched**. They are different semantics — one is
raw American prices, the other de-vigged consensus probabilities where every row
sums to 1.0000 — and `odds_archive`'s own migration argues at length against
merging them. Replacing `historical_odds` was considered and rejected.

**Operator decision, settled:** use the full depth of every market. Do not
truncate a market to another's availability. CFB's total goes back to 2013 even
though its moneyline starts in 2021.

### The hazard in each, and every one of them is a silent failure

None of these throw. Each produces a smaller, wronger dataset that looks fine.

**NHL — it is four markets, not one.** `sbr_long_rows` reads `home_ml`,
`away_ml`, `close_home_spread`, `open_home_spread`. Those are the **NBA** file's
columns. The NHL file uses `home_close_ml` / `away_close_ml` /
`home_puck_line` / `home_puck_line_price` / `close_total_price`. Every `.get()`
returns `None`, the rows are dropped by the `if price is None and line is None`
guard, and only totals survive — because `close_total` happens to be spelled the
same in both files. The loaded NHL SBR totals currently carry **zero prices**.

**NFL — 35 team codes for 32 franchises.** `OAK`/`LV`, `SD`/`LAC`, `STL`/`LA`
are the same clubs under old and new cities. And **`LA` is the Rams, not the
Chargers**: a naive match files Rams games under Chargers, which is the
Montreal-under-Toronto failure in NFL form. Use the explicit `RELOCATED` pattern
already in `import_odds_staging.py`, never an inferred match.

**CFB — CFBD ships its own team ids.** Our CFB team ids *are* ESPN's (147/147
confirmed). CFBD's are not, so a 147-team name crosswalk is required. Also:
2026 returns 933 games but only **53 results** — exclude unfinished games from
`game_result` or the season poisons every rate computed from it.

**EPL — the schema drifts mid-history.** 2015–2019 files carry `PSCH`/`PSH`/
`B365H`; 2020+ add `MaxCH`/`AvgCH`/`B365CH`. Measured fill: `PSCH` 4,010 of
4,200, `MaxCH`/`AvgCH`/`B365CH` only 2,680. **`PSCH` (Pinnacle closing) is the
only closing column present in all eleven seasons** — a loader keyed on `AvgCH`
silently drops six of them and looks correct doing it.

**MLS — 31 club names in football-data spelling**, including **Chivas USA**,
defunct since 2014. Handle it explicitly the way `RELOCATED` handles Seattle:
either map it or refuse it, never infer. 854 of 6,130 rows overlap ESPN's
existing window; 5,276 are net new.

**MLB — the OU price columns are literally unnamed.** The header row reads
`Open OU`, `Unnamed: 18`, `Close OU`, `Unnamed: 20`, and the *prices* live in
the unnamed columns. This is the SBR `CloseOU` trap already documented in
`CURRENT.md` §5, where `CloseOU` was the *opening* total and the close sat in
`Unnamed: 14`. **Identify these columns by value distribution, not by name.**
2020 is 949 games — that is the COVID season, not a gap.

### Four things folded into scope

**1. Results, not just odds.** Every source carries its own scores — nflverse
`home_score`, CFBD `homeScore`, E0 `FTHG`/`FTAG`, USA.csv `HG`/`AG`, MLB xlsx
`Final`, NHL SBR `home_score`. **Odds without results are not trainable**, which
is the entire definition Track F is measured on. `game_result` gets all six.

**2. The team crosswalks are the actual work.** Four of six need one — NFL,
CFB, EPL, MLS. This is where games vanish: an unresolved row never promotes and
never errors. Hold each to the **shuffled-control** standard gate 7 uses, not a
coverage percentage. The control is the point: on the athlete crosswalk, a date
join alone accepted 35% of deliberately wrong mappings and 728 of 806 wrong NHL
pairs, and only requiring the right *entity* on that date brought both to ~2%.

**3. Gate coverage per source.** Extend gates 1/4/5 in place rather than adding
five new ones, plus one new gate for the team crosswalks. Without this we are
back to a "sourcing complete" claim that nothing tests.

**4. The NHL overlap anomaly.** 1,740 SBR games sit inside ESPN's date window
and only **340** match on (team, date±1). For ~1.8 seasons of genuine overlap
that is too low. Either SBR's 2021–22 coverage is sparse or team resolution is
silently dropping matches — and if it is the latter, the same failure is costing
games elsewhere. Resolve it while the file is open.

### Cost

~540,000 new `odds_archive` rows and ~58,500 new `game_result` rows. At the
measured 543 and 430 bytes/row that is **~287 MB**: DB **4,401 → ~4,690 MB** of
8,192. Roughly 170 MB is reclaimable at any time (`odds_import_staging` 126 MB,
four dated backup tables, `team_elo_history` bloat at 14 MB for 98 rows) but
reclaiming needs `VACUUM FULL`, which takes an ACCESS EXCLUSIVE lock — deferred
deliberately, not forgotten.

---

## 6.31 · NHL `player_game_history` backfill

**The one that actually blocks 6.29.** Fixing NHL's SBR odds gives NHL a game
model and does **nothing** for the prop grader — and the grader is what
`docs/model-rebuild-plan.md` §7 says to build *first*.

Measured: NHL prop player-games with a real stat line to grade against = **0**.
Not because the crosswalk failed — 17,965 NHL prop player-games resolve to a
player perfectly — but because `player_game_history` stops at **2025-04-17** and
every NHL prop is **2025-10-01 or later**. Zero date overlap.

```
mlb   73,711      nfl 6,991      nba 4,480      cfb 3,778
epl    1,671      mls    44      nhl     0   <--
```

**The plan's own premise is wrong here.** §7 item 3 says "NBA, NHL and MLB need
no new data." True for MLB, thin but true for NBA, **false for NHL** — and it
stays false after all six of 6.30's loads land, because they are game-level.

Scope: backfill `player_game_history` for `nhl` from 2025-04-17 to present via
the existing `backfill_player_game_history.py` path. Roughly 1.5 NHL seasons.

Done when: NHL prop player-games with a stat line is a five-figure number and
gate 7's coverage check reports NHL reaching a player above its floor **on the
prop window**, not just overall.

---

## 6.32 · Tennis player-id crosswalk

**Cheaper than previously scoped — it is one hop, not two.** Verified
2026-09-01: `player_game_history`'s tennis `athlete_id` values **are ESPN
athlete ids**. Id 2375 resolves to Alexander Zverev on
`sports.core.api.espn.com/v2/sports/tennis/leagues/atp/athletes/2375`, and
`game_context.py:422` confirms it by construction — tennis subjects are minted
as `espn:tennis:{athleteId}`.

An earlier note in this project called these "4-digit ids from a different
provider" and treated the crosswalk as a two-hop problem through the
`YYYY-atp-season.csv` files. That was wrong, and the correction removes the hard
half of the job.

So it is **the same shape as the MLB/NHL athlete crosswalk already built**:
ESPN id → ESPN full name + date of birth → match to tennis-data's name. One
genuine difference: tennis-data abbreviates (`"Zverev A."`, `"Carreno-Busta P."`)
rather than publishing full names, so the matcher needs last-name-plus-initial
logic instead of full-name normalization — and that raises the collision risk,
which makes the verification step more important, not less.

**Verification is available and strong**, unlike NHL's. `player_game_history`
tennis spans **2016-01-03 → 2026-08-29** (8,163 ATP + 9,683 WTA athletes)
against tennis-data's 2015-01-04 → 2026-08-30 — ten of eleven years overlap. So
every candidate pair can be proven on a real match date, and scored against a
deliberately shuffled control exactly as gate 7 does.

Also closes: `odds_archive`'s 449,796 tennis rows currently carry NULL entity
ids, protected only by the partial index added in migration `20260901180000`.

---

## ─── TRACK F GATE ─── operator review, hard stop

**Nothing in 6.33 starts until the operator has reviewed and approved.**

Must all be true:

- Gates 1, 2, 2.7, 3, 4, 5, 6, 7, 8 pass, plus the new crosswalk gate.
- Every one of the four new team crosswalks passes a **shuffled-control** test,
  not a coverage percentage.
- Trainable games measured and reported **per sport**, by the same query used to
  find the gap — priced games that also have a result — not by row counts.
- No duplicates: each source idempotent, proven by running it twice and getting
  the same count.
- `tsc` clean, full test suite green.
- DB size measured and reported against the 8 GB ceiling.
- `CURRENT.md` rewritten with the real numbers.

**The claim to avoid making again:** "sourcing complete." State what was
measured, per sport, and what remains thin.

---

## 6.33 · Market-history cards

Four cards across the three shared detail components. **Not started until the
gate above clears.**

**Why these are safe to render while 6.29 is unbuilt.** The Phase 6 gate says no
model output renders until it clears bar 3, and nothing has. But every card
below is a **market fact, not a model claim** — a closing line that genuinely
existed and a result that genuinely happened. Same category as the unit grades,
the one part of this app never caught being wrong: it makes no claim about the
future, so it cannot be wrong about one.

**1. `GameDetailData.marketHistory`** — where tonight's line sits in history.
> *"Tonight's total is 9. These two have played 47 times since 2015; the
> market's median total was 8.5, and tonight is the 84th percentile. The over
> hit 22 of 47."*

**2. `TeamDetailData.marketRecord`** — how the market has priced this team.
> *"As a favourite: 31-14 (market implied 68%, realised 69%). As a dog: 9-28
> (implied 27%, realised 24%)."*

Calibration of the **book**, not of us.

**3. `PlayerDetailData.propLineHistory`** — the strongest, and newly possible.
> *"Strikeout line: 5.5 or higher in 12 of 18 starts, median 5.5. Cleared it 11
> times (61%); the market priced it at −125 (56%)."*

This exists **only because of 6.28's athlete crosswalk**. Before it, MLB and NHL
props could not reach a player at all. MLB alone has 73,711 prop player-games
with a real stat line behind them.

**4. Open→close movement.**
> *"Opened 8.5 (−110), closed 9 (−105)."*

Steam direction with no interpretation attached. Available on a solid subset —
11,924 MLB, 37,572 NBA, 39,138 NHL rows carry both open and close.

### Architecture constraints — read before writing any of it

- **These are the first TypeScript readers of `odds_archive`.** There are
  currently zero in `lib/` or `app/`. CLAUDE.md's caching convention therefore
  applies from the very first route: `cachedRoute()`, a TTL grounded in how fast
  the data actually changes (it is an archive — very long), and **grep the cache
  key before choosing it**. The golf `getSeasonSchedule` collision, where a
  route read back a constituent function's internal cache and served a bare
  array, is exactly this failure.
- **Precompute, do not query live.** These are aggregates over a 1.5M-row table.
  Per-team and per-player rollups refreshed on a schedule are almost certainly
  better than hitting the archive on page load. If a rollup table is added, it
  is Python-owned per `docs/table-ownership.md`.
- **One nullable field per shared interface, rendered behind a presence check** —
  never a `sport === 'x'` branch. That is the sport-adapter rule in CLAUDE.md
  §4, and Phase 6's own gate greps for violations.
- **The honest empty state does real work here.** A card saying *"only one
  season of market history for this sport"* is correct and useful; a percentile
  computed off 285 games is a lie with a number on it. Every card needs a
  minimum-sample threshold below which it renders the empty state instead.

---

## Not in scope, deliberately

**Deferred by operator decision 2026-09-01:**

- **Retention and the Parquet export path.** `prop_odds_history` wrote **265,771
  rows on 2026-09-01 alone** and has no retention rule; `injury_report` is
  ~11 MB/day, also unbounded. Neither is urgent against 3.3 GB of headroom, and
  the design depends on an open commercial question (whether the archive becomes
  a sellable dataset), so building it now risks building it twice.
- **`VACUUM FULL`** — ~170 MB reclaimable, needs a lock window.
- **Render deploy** — `venueFactorsJob` and `injurySnapshotJob` still report
  NEVER RUN.
- **The odds-API pacing problem.** `propline` and `oddsapiio` burn their entire
  daily cap within ~20–70 minutes of the 04:00 UTC reset, so both contribute
  zero prices during US game hours and everything they capture is 12–20 hours
  pre-game. Does not affect the archive, which holds real closes. Affects
  anything trained to run live.
- **`refreshTennisAtpJob`** failing on `prop_odds_side_valid`, and
  **`refreshSportsGameOddsJob`** stale.

**Not fixable — flagged so nobody hunts for them:**

- **NBA SBR total prices.** The file has no price columns for totals. Source
  limitation, not a bug.
- **CFB moneyline before 2021.** Does not exist at CFBD.
- **MLS prop grader.** 44 player-games. Game model only.
- **EPL/MLS/NFL/CFB prop depth** generally — Track F is a *game-odds* round.

---

## Appendix — the measured baseline, 2026-09-01

Every figure here came from the real file or the live DB on this date.

```
odds_archive        1,084,987 rows   9 league keys   2007-09-29 → 2026-09-02
prop_odds_archive   1,805,340 rows   7 sports        550,669 two-sided
game_result           113,323 rows   9 league keys
athlete_crosswalk       5,166 rows   7 sports
player_game_history 2,755,868 rows   9 sports        1,589 MB, largest table
DB                      4,401 MB of 8,192
```

Bytes per row, measured: `odds_archive` 543, `game_result` 430,
`prop_odds_archive` 292, `player_game_history` 605.

CFBD line density, measured on 2023: 1,350 games, 2,934 line objects =
**2.17 providers/game**, ≈ 10.7 archive rows/game. Providers seen: Bovada,
Caesars, DraftKings, ESPN Bet, William Hill, consensus, teamrankings.
