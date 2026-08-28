# X-signal (matchupFavorable) for Soccer/CFB/NBA/NHL — Phase 3 continuation

**Context**: Phase 3 of `docs/scan-playerdetail-parity-gameplan-2026-08-27.md` shipped
`matchupFavorable` for NFL — a small, adapter-local change, because NFL's opponent-
rank data (nflverse's `getTeamDefenseAllowedWithRank`) is already loaded server-side
inside `lib/sports/nfl/adapter.ts` while candidates are built. Investigating the
other four sports just now found that "same pattern, four more sports" was wrong —
real, checked findings below split them into two genuinely different tracks.

## What's actually true per sport (checked directly, not assumed)

- **Soccer EPL**: same easy shape as NFL. `lib/sports/soccer/adapter.ts` already
  loads `buildUnderstatTeamDefenseIndex` server-side and already attaches the full
  `UnderstatTeamDefense` object to every candidate's `subjectMeta.opponentDefense`
  (line ~256) — it just never gets thresholded into `matchupFavorable`. One adapter-
  local addition, like NFL.
- **CFB, NBA, NHL**: a different, larger shape. Each has real rank data
  (`lib/sports/{sport}/teamDefenseAllowed.ts`, `buildXTeamDefenseAllowedIndex()`),
  but it's fetched from a **separate route** (`/api/{sport}/team-defense-allowed`)
  by a **client-side** hook (`components/useTeamDefenseAllowed.ts`) that today only
  runs inside `PlayerDetail.tsx` — never in `AppShell.tsx`/Scan at all. Wiring
  `matchupFavorable` here needs a real client-side merge, the same shape as Phase
  1's `mergeModelData`, not an adapter edit.
- **Soccer MLS**: no real defense data source (same as the Python side's own
  decision) — stays `null`, out of scope, not attempted.

## Real gaps found auditing this plan before building — all fixable/faxable, not blockers

- **CFB's data source is currently dead.** `lib/sports/cfb/teamDefenseAllowed.ts`'s
  `buildCfbTeamDefenseAllowedIndex()` routes through `lib/sports/cfb/cfbd.ts` — the
  exact same `CFBD_API_KEY` whose monthly quota is exhausted (confirmed live again
  while auditing this doc: still `"Monthly call quota exceeded."`). Phase C builds
  and wires correctly regardless, but will show all-`null` `matchupFavorable` for
  CFB until that quota resets — same real, accepted constraint as the Python-side
  CFB X-signal work, just not connected to this doc until now.
- **NHL's position-group helper isn't exported yet.** NBA's equivalent
  (`nbaPositionGroup`, `lib/sports/nba/boxscore.ts`) already is and is directly
  reusable. NHL's (`isForwardCode`, `lib/sports/nhl/teamDefenseAllowed.ts`) is
  currently module-private — Phase E's first real step is exporting it (one line),
  not writing a new one.
- **The NFL refactor needs an explicit regression check.** Phase B's shared
  `favorableFromRank()` is meant to *replace* NFL's own already-shipped inline
  threshold logic (not sit beside it), so Phase B's test step must include a real
  before/after comparison of NFL's own `/api/nfl` `matchupFavorable` distribution —
  byte-identical output expected, not just "the refactor looks equivalent."
- **NBA and NHL are both off-season right now.** Even once D and E are built
  correctly, there may be no real current candidates to run a live true/false/null
  distribution check against (the same data-timing gap the original daily-picks
  build hit for these two sports). Their test steps verify the wiring doesn't
  crash and produces clean `null`s where expected; the real populated-distribution
  proof NFL/Soccer got waits for their season to start.

## Shared piece — build once, reuse everywhere

A single tercile-threshold helper, matching the real rule already proven in MLB's
`matchupSplit()` and NFL's `matchupFavorableFor()`:

```ts
// lib/odds/props/matchupFavorable.ts (new)
export function favorableFromRank(rank: number, poolSize: number): boolean | null {
  if (rank > (poolSize * 2) / 3) return true;   // bottom third — allows the most, favorable for the over
  if (rank <= poolSize / 3) return false;        // top third — stingy, unfavorable
  return null;                                    // real middle third — genuinely too average to call
}
```

One function, five real callers (NFL's existing inline version gets replaced with
this too, so there's exactly one implementation of the rule, not two that could
drift).

## Phase A — Soccer EPL (adapter-local, same shape as NFL)

**File**: `lib/sports/soccer/adapter.ts`, right where `meta.opponentDefense =
defense` already gets set (line ~256).

**Real mapping** — `UnderstatTeamDefense.rank`/`.poolSize` already exist per
candidate's opponent. Apply `favorableFromRank(defense.rank, defense.poolSize)` for
the real attacking-output dimensions only (matching the Python side's own
`_SOCCER_X_SIGNAL_DIMENSIONS` precedent — assists/shots/shots-on-target); leave
`matchupFavorable: null` for yellow-cards/saves (same non-attacking-signal reasoning
already used on the Python side). MLS candidates already have `teamDefenseIndex ===
null`, so they fall through to `null` for free.

**Test**: fetch `/api/soccer/epl`, confirm real, non-degenerate true/false/null
split across the three real dimensions (same distribution-shape check Phase 3 used
for NFL), confirm yellow-cards/saves and every MLS candidate stay `null`. Confirm
`tsc --noEmit` clean.

## Phase B — shared client-side merge utility (built once, used by C/D/E)

**New file**: `components/useOpponentDefenseFavorable.ts` (or added to the existing
`useTeamDefenseAllowed.ts`) — takes the already-fetched `teams: T[]` array plus a
per-sport "resolve this candidate's own rank" function, returns a
`Map<candidateKey, boolean | null>` the same shape Phase 1's `rowsByKey` uses, so
merging into `subjectMeta` reuses the exact same merge idiom (`mergeModelData`'s own
pattern, generalized).

**Real reason this has to be its own phase first**: CFB/NBA/NHL all need this same
merge shape, and it has to run in **both** `AppShell.tsx` (Scan, which fetches
nothing like this today) and each sport's PlayerDetail page (which already fetches
it, just doesn't convert it) — building the shared piece once here, tested in
isolation, is what keeps C/D/E from being three more copy-pasted merge blocks.

**Test**: unit-style check (same technique used for Phase 1 — replicate the merge
function in a throwaway script against real fetched data) confirming key matching
and the boolean output are correct, before any sport wires it in for real. Because
this phase also swaps NFL's own inline threshold logic over to the new shared
`favorableFromRank()`, this test must include a real before/after diff of `/api/nfl`
candidates' `matchupFavorable` values — expected byte-identical, not just "looks
equivalent" — before moving on to C/D/E.

## Phase C — CFB (per-stat rank, same granularity as NFL)

**Real data**: `CfbTeamDefenseAllowed` (`lib/sports/cfb/teamDefenseAllowed.ts`) has
real `passingRank`/`rushingRank`/`receivingRank` + `poolSize`, matched to a
candidate via `fuzzyLookupCfbTeamDefenseAllowed(index, candidate.subjectMeta.
opponentName)` — CFB candidates already carry a real `opponentName` (confirmed:
`lib/sports/cfb/adapter.ts` line ~331), the same field soccer's merge already uses,
so no new field needs adding to the adapter.

**Real mapping** (mirrors NFL's `DEFENSE_ALLOWED_KEY_BY_MARKET`):
`passing-yards`/`passing-tds` → `passingRank`; `rushing-yards`/`rushing-tds` →
`rushingRank`; `receiving-yards`/`receptions`/`receiving-tds` → `receivingRank`.
Dimensions with no real mapping (`interceptions-thrown`, `anytime-td`, attempt
counts) stay `null`, same as NFL's own gaps.

**Wire-up**: `AppShell.tsx` adds a `useTeamDefenseAllowed('/api/cfb/team-defense-
allowed', sport === 'cfb')` call (doesn't have one today) plus the Phase B merge;
`app/cfb/player/[playerId]/page.tsx` gets the same (it already fetches this data via
`PlayerDetail.tsx`'s own hook, currently unused for scoring — needs threading
through the same way, or lifted to the page level to match Phase 1's pattern).

**Test**: same real-data distribution check as NFL/Soccer, both on Scan (`/api/cfb`
candidates via a page load) and PlayerDetail — but see the CFBD-quota gap above:
expect a clean all-`null` result until that quota resets, not a populated
distribution. Verify wiring is exercised (the merge runs, doesn't crash, real
`opponentName`s resolve or cleanly miss) rather than expecting real true/false
values today. Regression-check NFL/MLB/Soccer untouched.

## Phase D — NBA (position-group rank, real disclosed risk to check first)

**Real, disclosed risk, not new**: `app/api/nba/team-defense-allowed/route.ts`'s own
header comment says `buildNbaTeamDefenseAllowedIndex()` was "UNVERIFIED end-to-end"
— its ESPN box-score fetcher was never checked against a live response. **Verify
this first**, before building anything on top of it — hit the route directly, confirm
it returns real, sane per-team ranks, not silently empty/wrong data. If it's broken,
fixing that is its own real sub-step before X-signal can mean anything for NBA.

**Real mapping**: `NbaTeamDefenseAllowed` has `guardRank`/`forwardRank`/`centerRank`
— position-group granularity only (no per-stat split), matching the exact same
granularity Python's `generic_matchup_defense.py` already uses for NBA (a real,
consistent precedent, not a new design call). A candidate's own position
(`subjectMeta.position`, already present) selects which rank to threshold — every
dimension for that player gets the *same* `matchupFavorable` value (points, rebounds,
assists all read "is this opponent bad at guarding a player at this general
position", not "bad at defending rebounds specifically").

**Wire-up**: same shape as Phase C (AppShell + PlayerDetail page, shared Phase B
merge).

**Test**: verify the raw route first (see above). If it returns real, sane data,
run the same distribution/regression checks as prior phases; if NBA's real season
hasn't started, expect clean wiring with no live candidates to check a distribution
against (see the off-season gap above) rather than treating that as a failure.

## Phase E — NHL (position-group rank, same shape as NBA)

**First real step**: export `isForwardCode` from `lib/sports/nhl/teamDefenseAllowed.ts`
(currently module-private) so the candidate side can reuse the exact same
forward/defense classification the index itself was built with, instead of a
second copy that could drift.

**Real mapping**: `NhlTeamDefenseAllowed` has `forwardRank`/`defenseRank` — same
position-group-only granularity as NBA, matching Python's own NHL X-signal
precedent. Candidate's position (`subjectMeta.position` — confirmed present on NHL
candidates, `lib/sports/nhl/adapter.ts` line ~265/393/425) selects forward vs.
defense rank.

**Wire-up / test**: same shape as C/D — real off-season caveat from the gap list
above applies here too (verify clean wiring/no-crash, not a live distribution).

## Order and dependencies

B must land before C/D/E (they all consume it). A (Soccer) has no dependency on B
and can land first or in parallel. D's live-verification of the NBA route should
happen **before** starting D's own build work, not after — if that data source
turns out broken, D's scope changes for real (fix the fetcher first) rather than
being a simple wiring phase like the others.

## Out of scope

- Soccer MLS X-signal (no real data source, same as the Python side's decision).
- Rebuilding CFB/NBA/NHL's underlying `teamDefenseAllowed.ts` index logic — this
  plan only wires *existing* real indexes into `matchupFavorable`, it doesn't
  change how those indexes are computed (except fixing NBA's fetcher if Phase D's
  verification finds it's actually broken).
