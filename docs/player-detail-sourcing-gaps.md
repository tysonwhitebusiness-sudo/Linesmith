# Player Detail — the 48 cells, measured

**Written 2026-08-30**, after `docs/design/player-detail-per-sport.html` was
compared against what the eight adapters actually render. Task 6.13 was marked
**DONE**; it is not. This is the real inventory.

The mockup's verdict is *"the same eighteen blocks in the same order… nothing is
nulled for a real sport."* The six universal roles are the part that carries
per-sport content, so this measures all **48 cells (8 sports × 6 roles)** against
data that exists **today, in this database**.

Every number here came from a live query on 2026-08-30. Re-measure before acting
— that is this repo's standing rule and it has caught eight wrong premises so far.

## RESOLVED 2026-08-30 — operator decisions and the attached repos

**Five of the nine SOURCE cells are closed or waived. Four remain and are ACCEPTED
as permanent gaps — they render an honest empty state and Phase 6 does not wait
on them.**

| Cell | Outcome |
|---|---|
| Tennis `usageMix`, `spatialGrid` | **Waived** by operator. Point-level data stays cut. |
| Soccer `conditions` | **Waived** by operator. No roof list. |
| Golf `usageMix`, `spatialGrid` | **CLOSED** — `golfR`'s bundled `data/pbp/` carries `lie`, `distance`, `left` (proximity), `from_x/y/z`. 40 tournaments, 333 MB, 2020-2023. Becomes an ingest task, not a sourcing one. |
| **NFL `usageMix`, NFL `binarySplit`, CFB `usageMix`, CFB `spatialGrid`** | **ACCEPTED GAPS.** Route running and coverage need a tracking feed. |

**What the attached repos actually contained**, measured rather than assumed:

- **`ngs-data`** — an 11 KB scaffold; data lives at `nflverse/nflverse-data`
  releases (MIT). `R/ngs_functions.R` lists every column: three WEEKLY
  per-player aggregates (passing/rushing/receiving). **No route running, no
  coverage shell.** Does not close the NFL cells. Worth knowing it does carry
  `percent_attempts_gte_eight_defenders` (a real stacked-box split) and
  `avg_separation`/`avg_cushion`.
- **`cfbfastR-cfb-data`** — 1.5 GB of real data. Play-by-play has `target` and
  `receiver_player_id` but **no pass location, no pass direction, no air
  yards** — only field position. Does not close the CFB target map.
- **`golfR`** — its scraper is DEAD: `tourcastdata.pgatour.com` no longer
  resolves (verified against a control — `www.pgatour.com` returns 200 from the
  same machine). `orchestrator.pgatour.com` returns 503, so PGA's current
  GraphQL API exists and a modern path would need endpoint rediscovery. **But
  the repo ships the data**, which is what closes the golf cells. No LICENSE
  file — all-rights-reserved by default; the underlying data is PGA Tour's.
- **`golfastr`** — ESPN leaderboards, hole scores and AGGREGATE strokes-gained.
  Not shot-level. Largely duplicates what this repo already pulls.

## Legend

| | Meaning |
|---|---|
| **DONE** | Renders today |
| **BUILD** | Buildable now — the data is already in this database or already on the page. No new source, no purchase. |
| **BACKFILL** | Source and code already exist; a free operator script has not been run. |
| **SOURCE** | Needs data we do not have. **This is the list to go shopping against.** |

---

## The grid

| Role | MLB | NFL | CFB | NBA | NHL | Soccer | Tennis | Golf |
|---|---|---|---|---|---|---|---|---|
| **opponentUnit** | DONE | BUILD | BUILD | BUILD | BUILD | BUILD | BUILD | BUILD |
| **usageMix** | DONE | SOURCE | SOURCE | BACKFILL | BACKFILL | BUILD | SOURCE | SOURCE |
| **spatialGrid** | DONE | DONE | SOURCE | BACKFILL | BACKFILL | DONE (EPL) / SOURCE (MLS) | SOURCE | SOURCE |
| **binarySplit** | **BUILD** | SOURCE | DONE | DONE | DONE | DONE | BUILD | BUILD |
| **conditions** | DONE | DONE | DONE | BUILD | BUILD | SOURCE | BUILD | BUILD |
| **careerH2H** | DONE | DONE | BUILD | BUILD | BUILD | BUILD | BUILD | BUILD |

**Totals: 14 DONE · 21 BUILD · 4 BACKFILL · 9 SOURCE.**

Two thirds of the remaining work needs nothing from you.

---

## 1. What I need you to find — the SOURCE list

Nine cells. Grouped by what would actually close them.

### A. NFL / CFB route running and coverage — **4 cells**
*(NFL usageMix, CFB usageMix, NFL binarySplit, and CFB spatialGrid)*

- **Route mix** (`usageMix`) and **man/zone coverage** (`binarySplit`) do not
  exist in play-by-play. `nfl_target_events` is built from nflverse PBP, and
  that release carries pass length and location but **no route running and no
  coverage shell** — already documented in `lib/sports/nfl/targetMapShapes.ts`.
- **What closes it:** NFL **Next Gen Stats**. It is a different source with
  different licensing terms, not a free file. Worth checking whether the
  nflverse ecosystem's `nflreadr` NGS tables (`ngs_passing`, `ngs_receiving`)
  are usable — they are aggregated per week rather than per play, which may be
  enough for a mix but not for coverage.
- **CFB spatial** (`spatialGrid`, a target map) needs CFB play-by-play.
  `collegefootballdata.com` (cfbd) has a PBP endpoint and this repo already
  talks to cfbd elsewhere — this one may turn out to be BUILD, not SOURCE. It
  is listed here because I have not verified the endpoint carries pass location.

### B. Tennis point-level data — **2 cells**
*(usageMix = serve mix, spatialGrid = serve placement)*

- Tennis is the thinnest sport in the database by a wide margin: **8 distinct
  stat keys**, against NFL's 57 and MLB's 27. Everything it stores is
  match-level (sets, games, tiebreaks) — nothing per point.
- **You already cut this on 2026-08-29.** It is listed so the decision stays
  visible, not to reopen it. Reopening needs a point-level feed.
- The mockup's own text concedes this: *"Tennis is the real constraint… it is
  the one place equal depth costs real work rather than real layout."*

### C. Golf shot-level data — **2 cells**
*(usageMix = approach distance, spatialGrid = proximity by lie)*

- `golf_hole_scores` has par and strokes per hole — enough for scoring, not for
  where a shot came from or finished.
- **What closes it:** a shot-level feed (ShotLink is the canonical one, and is
  commercial). Nothing free that I know of carries lie and proximity.

### D. MLS shot locations — **1 cell**
*(soccer spatialGrid, MLS half)*

- EPL is DONE via Understat. **Understat has no MLS coverage**, which is why
  the soccer shot map is EPL-only by design.
- **What closes it:** **American Soccer Analysis (ASA)** is the usual free
  equivalent and publishes shot-level xG data for MLS. This repo already uses
  ASA for MLS match logs elsewhere, so the integration may be short.

### E. Soccer venue roof list — **1 cell**
*(soccer conditions)*

- **Not a purchase — a list.** ESPN sends an `indoor` flag on 16/16 NFL and
  25/25 CFB events and **omits it entirely** for MLS and EPL. MLS has real
  domes, so trusting `!indoor` would print wind and rain for a game played
  under a roof.
- **What closes it:** a checked per-venue roof/no-roof list for the ~30 MLS and
  20 EPL grounds. Hand-curated, exactly like `lib/sports/tennis/surfaces.ts`
  and `lib/sports/golf/venues.ts` already are. **I can write this if you would
  rather not** — it just needs to be checked rather than guessed.

### Also worth knowing (not blocking a role)

- **WTA surfaces are incomplete.** `lib/sports/tennis/surfaces.ts` covers all 60
  real 2026 ATP events; its own doc comment says the WTA half "is not yet built
  against real WTA names the same way." Hand-curation, same as above. Until it
  is done, tennis `binarySplit` and `conditions` work for ATP and degrade to
  null for WTA.

---

## 2. What I can do without you — the BUILD list

21 cells. Highlights, in rough value order:

1. **MLB `binarySplit` — vs LHP/RHP.** The one role MLB nulls, with the comment
   *"this app stores no platoon split."* **That is now stale.** 6.6's
   `mlb_pitch_events` carries `p_throws` and `stand` across **2,140,525 rows**
   (R=1,550,179 / L=590,346). Spot-checked one real batter: 1,789 pitches vs
   LHP and 5,189 vs RHP. This closes MLB's last empty role and needs no new data.
2. **`careerH2H` for six sports.** It renders on MLB and (as of today) NFL.
   `player_game_history` carries `opponent_id` for every sport, and
   `lib/sports/shared/careerH2H.ts` is already a shared builder. Six adapters
   never call it.
3. **`opponentUnit` for seven sports.** MLB-only today, and the inputs exist:
   NFL's `opponentDefenseAllowed` is already on `subjectMeta` and already drawn
   by `NflPlayerVsDefenseCard`; `/api/{cfb,nba,nhl}/team-defense-allowed` all
   exist; NHL's opposing goalie and soccer's keeper are derivable from
   `player_game_history` (`isGoalie`, `saves`, `goalsAgainst`, `shotsAgainst`,
   `goalsConceded`, `shotsFaced`).
4. **NBA/NHL `conditions` — rest and travel.** Derivable from the schedule
   already in `team_elo_history` (game dates and home/away per team).
5. **Golf `binarySplit` — par 5 / par 4.** `golf_hole_scores.par` exists.
6. **Soccer `usageMix` — shot-type mix.** Understat's payload carries shot type
   (header / left foot / right foot) and is already being fetched.
7. **Tennis `binarySplit` / `conditions` — surface.** `raw.surface` is already
   on tennis history entries via `surfaces.ts` (ATP complete).

---

## 3. The BACKFILL list — free, and I can run these

Four cells, blocked only on a script nobody has run.

| Table | Rows now | Command |
|---|---|---|
| `nba_shot_events` | **195** | `./.venv/Scripts/python.exe -u src/nba_shots.py backfill 2024-10-22 2025-04-13` |
| `nhl_shot_events` | **102** | `./.venv/Scripts/python.exe -u src/nhl_shots.py backfill 20242025` |

195 and 102 rows are **single-game verification samples**, not coverage. NBA and
NHL `spatialGrid` are wired and correct but have nothing to draw for almost
every player — which is a large part of why those pages look empty. Both tables
also carry a `shot_type` column, so the same backfill closes their `usageMix`
too: **one script per sport closes two roles.**

Both hit free league APIs, are resumable, and are ~1,300 games each.

---

## 4. Why this was reported as done

Recorded so the pattern is visible rather than repeated.

- **The 6.13 gate was never run.** It requires *"every sport's page renders
  every block or an honest empty state — walked per sport per page, not
  spot-checked. A blank card with no empty state is a failure."* Phase 6 has no
  gate sign-off in §11. The task was marked done on its own say-so.
- **A narrow true claim was read as a broad one.** `CURRENT.md` said *"MLB fills
  5 of 6 roles; four sports fill `binarySplit`"* — a statement about plumbing,
  sitting in a table headed COMPLETE.
- **The mockup's numbers are invented**, and it says so: *"every number below is
  invented for this mockup."* It was never evidence the data existed.
- **One role was silently broken.** NFL's `careerH2H` was built and assigned
  into the per-row gamelog literal instead of the adapter's return, so it never
  reached the page. `tsc` passes that — an extra property on an object literal
  returned through a mapped callback is not excess-property checked. Fixed
  2026-08-30, guarded in `tests/player-roles.test.ts`.

**The rule this earns:** a role is not filled because the field exists. It is
filled when the block renders on a page someone opened.
