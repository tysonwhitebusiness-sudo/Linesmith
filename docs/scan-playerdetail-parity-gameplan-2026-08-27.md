# Scan/PlayerDetail parity gameplan — NFL/CFB/NBA/NHL/Soccer, matching MLB

**Context**: `docs/daily-picks-full-model-build-2026-08-27.md` built the real prediction
pipeline (`pick_history`, `predict/generic_prop_production.py`) and wired Scan table's
Score/Edge columns to it for NFL/CFB/NBA/NHL/Soccer (`components/AppShell.tsx`'s
`needsModelDataMerge` block, `lib/odds/props/liveEdge.ts`'s `resolveCandidateEdge`
reading `subjectMeta.pickHistoryEdge`). Three real gaps remain before those five
sports match MLB/Golf's own Scan + PlayerDetail experience. This doc scopes all
three. Each phase ships and gets tested live before the next one starts.

## Phase 1 — PlayerDetail Score/Edge (same merge, five more call sites)

**Problem**: the model-data merge (`pick_history.model_prob`/edge → `subjectMeta`)
only runs inside `AppShell.tsx`'s `candidates` useMemo. Each sport's PlayerDetail
route does its own independent `useSnapshot(sport)` call and never passes through
`AppShell.tsx`, so `PlayerDetail.tsx`'s own `resolveCandidateEdge`/`computePropScore`
calls (lines ~1156-1157) never see the merged data.

**Fix**:
- Extract the merge logic out of `AppShell.tsx` into an exported function in
  `components/usePickHistoryModelData.ts` — e.g. `mergeModelData(sport, candidates,
  rowsByKey)` — so there's one real implementation, not one per call site.
- `AppShell.tsx`: replace its inline merge with a call to the shared function.
- Wire the same hook + merge call into each of the five PlayerDetail page routes,
  applied to `snapshot?.candidates` before they filter down to `mine`:
  - `app/nfl/player/[playerId]/page.tsx`
  - `app/cfb/player/[playerId]/page.tsx`
  - `app/nba/player/[playerId]/page.tsx`
  - `app/nhl/player/[playerId]/page.tsx`
  - `app/soccer/[league]/player/[playerId]/page.tsx`
- No new API route — `/api/picks/model-data?sport=X` (already built, already live)
  serves all six call sites.

**Test before Phase 2**: same real-data proof used for the Scan fix — write one real
test row into `pick_history` for a real subject/dimension/game on today's live
slate, load that player's real PlayerDetail page data path, confirm
`subjectMeta.modelProb`/`pickHistoryEdge` land on the merged candidate the same way
they did for Scan, then delete the test row. Confirm `tsc --noEmit` clean and the
prod build succeeds.

## Phase 2 — Sport-parameterize calibration (Market Trust badge + Good Bets tab)

**Problem**: `lib/odds/props/calibrationSnapshot.ts`'s `computeCalibrationPayload`
has `const sport = 'mlb'` as a literal — every downstream call
(`calibrationByMarket`, `liveMarketSkill`, `calibrationCounts`, `calibrationBuckets`,
`overallBrierScore`, `goodBetsRecord`, `scoreRecord`) always reads MLB's own
`pick_history` rows regardless of which sport's page asked. `app/api/props/
calibration/route.ts` has no `sport` query param to override it.

**Fix**:
- `app/api/props/calibration/route.ts`: accept `?sport=`, default `'mlb'` (preserves
  every existing MLB/Golf caller's behavior unchanged).
- `computeCalibrationPayload(sport, scope, dimension)` — thread the real `sport`
  through to every one of its internal calls instead of the hardcoded literal.
- `calibrationCacheKey` must include `sport` — without this, every sport's request
  would read and overwrite the *same* cached entry, the exact cache-key-collision
  class CLAUDE.md's own golf/schedule postmortem warns about.
- `components/useMarketCalibration.ts`: add a `sport` param, thread into its fetch.
- Update both real call sites (`AppShell.tsx`, and wherever PlayerDetail's host
  pages call `useMarketCalibration`) to pass their own `sport`.

**Test before Phase 3**: hit `/api/props/calibration?sport=nfl` directly, confirm it
returns real, non-MLB numbers (byMarket dimensions like `passing-yards` rather than
MLB's `total-bases`), and confirm MLB's own existing response is byte-identical to
before this change (regression check on the default). Confirm `tsc --noEmit` clean.

## Phase 3 — X-signal (`matchupFavorable`) per sport adapter

**Problem**: `computePropScore`'s X component reads `subjectMeta.matchupFavorable`
(a plain boolean). MLB's real rule, confirmed by reading `matchupSplit()` in
`lib/sports/mlb/adapter.ts`: a real opponent rank out of a real pool size,
thresholded into a tercile — `favorable = rank <= poolSize / 3` (or the inverted
form, `rank > poolSize * 2/3`, for stats where a *worse* opponent number is what
actually helps the subject). NFL's adapter already computes an equivalent real rank
(`opponentDefenseAllowed`, grouped by position via `MATCHUP_GROUP_BY_POSITION` —
the same data already feeding the DVP column) but never thresholds it into
`matchupFavorable`.

**Fix**: per sport adapter (NFL first, proven pattern reused for CFB/NBA/NHL/Soccer):
- Apply that sport's own tercile-style threshold to the rank it already computes at
  candidate-build time, same place `dvp`/`matchupRank`/`matchupStatLabel` already get
  set on `subjectMeta`.
- Set `matchupFavorable: boolean | null` there — `null` when the rank isn't real/
  showable yet (same `rankWorthShowing`-style guard MLB already uses), never a
  guessed default.
- No new data collection — this is a missing conversion of data that already exists
  per candidate, not a new fetch.

**Test after Phase 3**: for a real candidate with a real opponent-defense rank, hand-
verify the tercile math (pick one real top-third opponent and one real bottom-third
opponent, confirm `matchupFavorable` comes out `true`/`false` correctly), then
confirm the X component actually moves `computePropScore`'s output for that
candidate (before/after comparison, matching the discipline `generic_matchup_
defense.py` itself used when it was built). Full regression: `tsc --noEmit` + prod
build + spot-check MLB's own scores are unchanged (this phase touches non-MLB
adapters only, but the shared `computePropScore` code path is worth re-confirming
stays correct for MLB too).

## Out of scope for this doc

- Getting the Render worker itself running continuously again (real-data
  freshness for CFB/NFL prop_odds) — an ops question, not a code gap, already
  flagged separately.
- Extending `hasPropsPipeline` to more sports — a different, larger decision
  (live-odds pipeline coverage) than what this doc scopes.
