# CURRENT — pick up here

**Phase 4 is COMPLETE and it ends on a screen.** `/nhl/projections` renders four
ranked NHL markets in a real browser. That is the first user-visible model
output this project has produced — Phases 2, 3 and the first nine steps of 4 all
finished at a number in a document.

`tsc` clean, **344 tests, 0 fail**. Plan: `docs/model-build-plan-2026-09-02.md`.

## 1. What shipped in 4.8 / 4.9 / 4.10

**4.8 — all six two-sided NHL markets, each gated separately.** Four rank
correctly; two do not and are excluded:

| market | ordering (quintiles) | calib gap | ranks | shows a % |
|---|---|---|---|---|
| Points | 0.51 → 0.56 → 0.57 → 0.85 → 1.02 | 0.013 | yes | **yes** |
| Assists | 0.30 → 0.35 → 0.40 → 0.48 → 0.67 | 0.026 | yes | **yes** |
| Shots on goal | 1.75 → 2.07 → 2.28 → 2.34 → 3.02 | 0.057 | yes | no |
| Goals | 0.07 → 0.10 → 0.13 → 0.20 → 0.35 | 0.131 | yes | no |
| Hits | 1.88 → 2.15 → 2.40 → **2.33** → 2.99 | 0.067 | **no** | no |
| Blocked shots | 1.71 → 1.72 → 2.03 → **1.81** → 1.85 | 0.160 | **no** | no |

**4.9 — serving, split by consumer.** The projection pipe ships on ordering; the
edge pipe stays behind 4.7. Verified against the real 2024-01-13 slate: 2,276
projections, every market correlating positively with the outcome (r=+0.21 to
+0.48), no leakage, no edge fields.

**4.10 — the board.** Compliance strings (root layout), privacy policy, shared
`StatsBoard`, NHL adapter, pattern-2 read route, and a 5-test no-edge guard.

## 2. Three bugs found by building, not by reading

Worth knowing because each was invisible to the check that was supposed to catch
it:

1. **The ordering check was vacuous for low-mean markets.** It bucketed by
   `int(expected)`, so assists (mean 0.44) and goals (mean 0.17) produced ONE
   bucket each — and `all()` over a one-element list is True. Both were recorded
   as "monotone" by a check with nothing to compare. Quintiles fixed it, and
   **changed a verdict**: hits passed on coarse buckets and fails on honest ones.
2. **`db.write_calibration` could not RETIRE a market.** It deactivated prior
   versions only when the new one activated, so a re-fit that got worse left the
   old passing version live. Hits v1 (monotone) stayed active under hits v2
   (non-monotone) and the market kept being served. Fixed at the source — a new
   version now always supersedes.
3. **Two display bugs only the browser showed.** The hidden-player count was
   multiplied by the market count (114 read as 456); the confidence thresholds
   were a within-season guess that labelled every player identically once
   history ran across seasons.

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
