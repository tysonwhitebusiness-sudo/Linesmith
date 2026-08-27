# Player prop score/grading for all sports — gameplan (2026-08-27)

## Is MLB's system good inspiration? Yes — confirmed by reading the actual code, not assumed.

Read `predict/prop_score.py`, `edge_model.py`, `windowed_stat.py`, `good_bets.py` in full before writing this. The verdict: **the math has zero baseball-specific content.** `HistoryEntry` (the windowed-stat building block) is just `{category: 'over'|'under', opponent_id, is_home}` — no sport anywhere in it. The Beta-Binomial posterior (`edge_model.py`) takes a league rate, a matchup-favorability bool, and an over/total count — same story. `prop_score.py`'s four-component blend (M/E/P/X, below) is pure math over those generic inputs. This is exactly the kind of reusable core `generic_team_elo.py` already proved out tonight for moneyline — same pattern, one level down.

**What Prop Score v1 actually computes**, real and precise, not paraphrased:
- **M (weight 0.30) — model conviction.** The Beta-Binomial posterior probability's distance from the market's real league base rate for that stat category, discounted by a sample-size confidence factor (`kappa = n/(n+n0)`, `n0` = that dimension's own prior strength).
- **E (weight 0.35) — live market edge.** Model probability vs. a genuine devigged live book price, when one exists. If none exists, E's weight is redistributed proportionally over M/P/X rather than treated as a confirmed zero edge.
- **P (weight 0.25) — performance corroboration.** The player's own best trailing-window hit rate (L5/L10/L15/season/streak/head-to-head), with a bonus if 2+ windows independently corroborate.
- **X (weight 0.10) — matchup corroboration.** A flat bonus if the opponent's own allowed-stats make this a favorable matchup, 0 otherwise — corroborating only, never load-bearing alone.
- Score = `50 + 50 * clamp(weighted sum, -1, 1)`, then a letter grade (A+ through D) off fixed thresholds.

## The real foundation that already exists — checked live, not assumed

**Market data for other sports is already flowing.** `prop_odds` has **290,663 real rows right now**, spanning MLB, NFL, Soccer, and Tennis already — confirmed live with a direct query, including real rows for tonight's actual Browns @ Patriots game (A.J. Brown anytime-TD +1300, Drake Maye anytime-TD +3500, etc., via SportsGameOdds). Real market keys already present and resolved: `passing-yards`, `receiving-yards`, `receptions`, `rushing-yards`, `anytime-td`, `longest-reception` (NFL); `anytime-goalscorer`, `saves` (soccer); `aces`, `games-won` (tennis) — alongside MLB's own. This exists because `jobs.py`'s `_job_multisport`/`_soccer_epl_specs`/`_soccer_mls_specs`/`_tennis_specs` already wire SportsGameOdds/ParlayAPI/SharpAPI/Propline for these sports' player props, not just game lines — built during the odds-architecture-rebuild work, running tonight, already real.

**A real per-player game-log source exists.** ESPN's athlete gamelog endpoint (`site.web.api.espn.com/apis/common/v3/sports/{sport}/{league}/athletes/{id}/gamelog`) confirmed live for a real NFL player tonight — real per-game stats (`receivingYards`, `receivingTouchdowns`, `rushingYards`, etc.), keyed by real ESPN event ids, matching the same market-key vocabulary already in `prop_odds`. Only NFL was actually checked; the same ESPN common-API pattern is expected to cover NBA/NHL/soccer too, but that's an expectation to verify per sport, not yet individually confirmed — disclosed, not assumed.

**`windowed_stat.py`'s trailing-window machinery is already 100% generic** — confirmed above, zero changes needed to reuse it for any sport once real per-player `HistoryEntry` lists exist.

## What's genuinely missing, and the real build plan

**1. A generic per-player game-log fetcher.** The one real new piece of infrastructure, same shape as tonight's `generic_team_elo.py` — a shared module that calls ESPN's gamelog endpoint per sport/athlete, parses the real stat fields into `HistoryEntry` lists per market dimension (over/under a line, using each candidate prop's own real line — not decided until a live prop exists to test against).

**2. Real league base rates per (sport, market_key).** `edge_model.py`'s Beta-Binomial prior needs a real league-wide rate per dimension (MLB's own comes from `db.league_base_rates`, computed from every graded outcome this app has ever seen). For a new sport this is a real cold-start problem — no graded history exists yet. Two honest options: (a) seed from real historical stat data directly (e.g., league-wide completion rate for "over 0.5 anytime TD" computed from a season of real gamelogs, not waiting for this app's own grading to accumulate), or (b) start with a wide, low-confidence prior (`PRIOR_STRENGTH` set low) and let it sharpen as real graded picks accumulate — the same "disclosed guess, refined by real data over time" honesty this whole session has used everywhere else. (a) is more work up front but real, better-grounded from day one; (b) is faster to ship but genuinely noisier at the start. Worth deciding per sport, not blanket-assumed.

**3. Matchup favorability (the X component).** Needs opponent "allowed" stats — real infrastructure for this **partially already exists**, uncommitted from a prior session: `lib/sports/nba/teamDefenseAllowed.ts`, `lib/sports/nhl/teamDefenseAllowed.ts`, `lib/sports/cfb/teamDefenseAllowed.ts` are real files sitting in the repo right now (confirmed via `git status`), built but never wired into anything. NFL and Soccer don't have an equivalent yet. Reviewing and finishing these three, then building the other two, is real, scoped, and smaller than starting from nothing.

**4. Per-sport calibration constants** (`SCALE_M`, `SCALE_E`, `MATCHUP_SHIFT_WEIGHT`, per-dimension `PRIOR_STRENGTH`) — MLB's own values are disclosed hand-set placeholders, never fit. A new sport starts the same way: reasonable, disclosed defaults, real fitting deferred until real graded data exists — same honesty as tonight's Elo `home_bonus`/`k_factor` values.

## Per-sport specifics

| Sport | Real market keys already flowing (confirmed) | Real structural difference from MLB |
|---|---|---|
| **NFL** | `passing-yards`, `passing-tds`, `rushing-yards`, `receiving-yards`, `receptions`, `anytime-td`, `longest-reception`/`-rush`/`-completion`, `kicking-points`, `field-goals-made` | Only 17 games/season (a full MLB *month* is more games than an NFL season) — L15 is nearly a whole season, not a trailing sub-window the way MLB's L15/162 is. Windowed-stat thresholds likely need real per-sport tuning (e.g. L5/L10 might be the only meaningful windows; L15/"season" nearly collapse into the same thing). |
| **CFB** | Same family as NFL (shared market vocabulary) | Same short-season issue as NFL, worse — many teams play only 12-13 games. `teamDefenseAllowed.ts` groundwork already exists for CFB specifically. |
| **NBA** | Not yet confirmed live (query above didn't happen to surface an NBA row, current off-season) — expected real once the season starts, same provider pipeline. | 82-game season, closer to MLB's own data density — likely the smoothest port of the five. `teamDefenseAllowed.ts` groundwork already exists. |
| **NHL** | Same off-season caveat as NBA | 82 games, similar density to NBA. `teamDefenseAllowed.ts` groundwork already exists. |
| **Soccer (EPL/MLS)** | `anytime-goalscorer`, `saves` confirmed | Low-scoring sport — many meaningful markets (anytime goalscorer, clean sheet) are much rarer events than MLB's own rare-event markets (home runs, triples), needing the same kind of `RARE_EVENT_PERFORMANCE_THRESHOLDS`/wider-prior treatment `good_bets.py`/`edge_model.py` already handle for MLB's rare markets — a real, existing pattern to reuse, not invent. No `teamDefenseAllowed.ts` yet. |
| **Tennis** | `aces`, `games-won` confirmed | Individual, not team — no "matchup" defensive-stat concept the same way (X component needs a genuinely different design: head-to-head history and surface/style matchup instead of an opponent's allowed-stats). Also no team-Elo the way tonight's moneyline build needed a different design for tennis — same underlying reason (individual sport), a second, separate place this distinction matters. |

## Suggested order

1. **NBA/NHL first**, not NFL — highest real game-count density (closest to MLB's own data richness), and the matchup-signal groundwork (`teamDefenseAllowed.ts`) already exists uncommitted for both. Least new infrastructure needed for the most confident first result.
2. **CFB**, reusing NFL's market vocabulary and its own existing `teamDefenseAllowed.ts` groundwork, accepting the short-season windowing caveat.
3. **NFL**, same short-season caveat, no existing matchup-signal file yet (real, scoped new work).
4. **Soccer**, reusing MLB's rare-event-market pattern for goal-scoring markets specifically.
5. **Tennis last** — the one sport needing a genuinely different X-component design (head-to-head/surface, not opponent-allowed-stats), consistent with tonight's moneyline build also treating tennis as the outlier requiring its own design rather than a config-dict entry.

Not started tonight — this is the plan, not the build. Say the word and I'll start on NBA/NHL's per-player gamelog fetcher first, per the ordering above.
