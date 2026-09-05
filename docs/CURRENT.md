# CURRENT — pick up here

**Phase 4 is COMPLETE and it ends on a screen.** `/nhl/projections` renders four
ranked NHL markets in a real browser. That is the first user-visible model
output this project has produced — Phases 2, 3 and the first nine steps of 4 all
finished at a number in a document.

`tsc` clean, **344 tests, 0 fail**. Plan: `docs/model-build-plan-2026-09-02.md`.

## 1. What shipped in 4.8 / 4.9 / 4.10

**All six NHL markets rank; four carry a calibrated probability.** Board is live
at `/nhl/projections`.

| market | ordering (quintiles) | calib gap | ranks | shows a % |
|---|---|---|---|---|
| Points | 0.43 - 0.57 - 0.61 - 0.74 - 1.07 | 0.015 | yes | **yes** |
| Hits | 1.60 - 1.87 - 2.20 - 2.43 - 2.83 | 0.022 | yes | **yes** |
| Shots on goal | 1.72 - 2.02 - 2.13 - 2.36 - 3.02 | 0.037 | yes | **yes** |
| Goals | 0.06 - 0.10 - 0.11 - 0.20 - 0.37 | 0.045 | yes | **yes** |
| Blocked shots | 1.56 - 1.68 - 1.72 - 1.86 - 2.02 | 0.058 | yes | no |
| Assists | 0.29 - 0.32 - 0.39 - 0.46 - 0.67 | 0.090 | yes | no |

**4.9 - serving, split by consumer.** Projection pipe ships on ordering; edge
pipe stays behind 4.7. `prop_model_cache` (renamed from `mlb_prop_model_cache`)
is Python-written, TS read-only.

**4.10 - the board.** Compliance strings in the root layout, privacy policy,
shared `StatsBoard`, NHL adapter, pattern-2 read route, 6-test no-edge guard
that was checked to actually fail.

## 2. The audit found one serious defect, and it changed every verdict

**The served model was not the validated model.** The walk-forward built history
from PROP ROWS (18.8 games/player); serving built it from every game (553.8).
Same player, same date, same constants disagreed by a mean 0.38 shots, with only
16% agreeing within 0.10. **No test caught it because both sides were
individually correct** - only comparing them found it.

Fixed by pointing the fit at the serving path's source. Re-fitting flipped four
of six verdicts, all toward better: **hits and blocked shots, whose ordering had
been measured BACKWARDS, both order cleanly with full history** - the inversion
was a sample-size artifact. Shots on goal and goals earned probabilities;
assists lost its one.

Three smaller things from the same audit:

1. **The league rate was derived from prop rows**, which skew to high-volume
   players - biased upward relative to the population histories are drawn from.
   Now taken from the SELECT-window games.
2. **Two stale gates hard-coded a measurement instead of a rule** (the adapter
   map and the verifier both named hits/blocked-shots). The gate now lives in one
   place: `model_calibration.active`.
3. **The 4.9 verification slate sat outside the prop window** (2024-01-13, before
   the archive starts). Re-verified on 2026-03-28.

Earlier in the phase, two more of the same species: an ordering check that was
vacuous for low-mean markets (`all()` over one bucket), and a
`write_calibration` that could not RETIRE a market because it deactivated prior
versions only when the new one activated.

## 3. Where things stand overall

- **No model has beaten a closing line.** Tennis t=+20.68, soccer t=+3.05, NHL
  games t=+5.07, NHL props t=+3.03. The betting board stays suppressed and
  `EdgeBadge` stays off. That is the expected state for every sport right now.
- **The stats board does not wait on that** and never should have. A ranking is
  an opinion; an edge is a claim about someone else's price. Different claims,
  different evidence, different gates.
- 4.7's one genuinely positive result stands unexploited: priced at the OPEN,
  ROI rises monotonically with edge (+22.84% at the 10% threshold, t=+2.93). The
  model beats the market's FIRST GUESS, not its close.

## 4. Next actions

1. **The operator must read `app/privacy/page.tsx` before it is public.** It is
   accurate to the codebase, but the hosting/database retention terms and the
   governing jurisdiction are outside the repo and only the operator can confirm
   them. Marked inline in the file.
2. **A live October slate is the first real test of `nhlProjectionsJob`.** The
   historical run proved the projection and the leakage discipline; it did NOT
   prove scheduling or roster resolution, because it learned who dressed from
   the games themselves. The job is registered hourly and correctly returns zero
   until the season opens.
3. **Phase 5 (MLB) ends with an MLB board**, per the dissolved Phase 9. Every
   sport phase now ends on a screen, not a gate result.
4. **Points is fitted directly, not convolved from goals and assists.** It
   passes that way, but P(points) is not guaranteed coherent with the goal and
   assist distributions it is made of — and the board now shows all three side
   by side, where a user could see them disagree.
5. **The game-id crosswalk is still unbuilt** (85.2% resolvable, 1,281 unique /
   68 ambiguous). It unblocks the empty-net correction, OT measurement, an exact
   prop join and xG.

## 5. Standing constraints

- **Do not deploy to Render or start 6.29 (the model rebuild) without asking.**
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is the operator's.
- **A numeric id matching the expected shape is not evidence it is the right
  id.** Verify every crosswalk by joining on a real date, never by counting
  overlaps.
