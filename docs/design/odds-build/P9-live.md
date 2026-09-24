# P9 · Live (O5)

**Lane:** TypeScript. **Deploys:** none. **Needs:** P6 (live data), P8 (the
components). Operator's green light.
**Goal:** every odds card that updates looks and behaves live, exactly as
the approved mockup's live layer does (plan §8 Revision 4), on real
refreshes rather than a replay.

---

## Build

### 1. Refresh — `components/odds/usePlayerOdds.ts`, `useGameOdds.ts`, `useSlateOdds.ts`

- **Poll** every **30 s** (player and game) and **60 s** (the Slate route's
  TTL) while `document.visibilityState === 'visible'`.
- **Pause** when hidden; refetch at once on becoming visible.
- `AbortController` per request; one request in flight per hook.
- Each response is diffed against the previous one (§2); the diff drives
  every animation.
- The routes stay as P8 built them: `/api/odds/player` and `/api/odds/game`
  are direct reads (pattern 2, no write on GET), and `/api/odds/slate` is
  `cachedRoute` TTL 60 s.

### 2. The diff — `lib/odds/section/liveDiff.ts` (pure)

```ts
export interface LiveChange { key: string; dir: 'up' | 'down'; from: number; to: number; at: string }   // at = the new changed_at
export interface LiveDiff { changes: LiveChange[]; pulled: string[]; returned: string[]; added: string[]; newMoves: string[] }
export function diffOdds(prev: OddsSnapshotKeys | null, next: OddsSnapshotKeys): LiveDiff
export function keysOf(payload: PlayerOddsPayload | GameOddsPayload | SlateOddsPayload): OddsSnapshotKeys
```

- **Keys:**
  - price: `provider|book|period|market|side|line`;
  - row: `book|period|market`;
  - move: history row id.
- **Direction:** up = the number went up. For an American price that means
  it pays more.
- The first payload (`prev === null`) produces **no** changes, so nothing
  flashes on page load.

### 3. The live pieces (the kit pieces from P8 O1, now animated)

| piece | behaviour (Revision 4) |
|---|---|
| `LiveDot` | a 1 s tick from `useNow(1000)` (new `components/odds/useNow.ts`, visible-only). Green + pulse while `now − checkedAt ≤ 2 × cadence`; amber ≤ 6×; grey "no update in X" beyond. **Ping** (one expanding ring) when its card has a change in this diff. Cadence by source class, from `lib/odds/section/cadence.ts`: direct books and exchanges 70 s, aggregators 90 s, DK Network splits 480 s, Sleeper pick counts 900 s, Covers 3600 s |
| `FlashValue` | on a change: roll to the new number (translateY 45% → 0, opacity 0.3 → 1 over the first 16%) and flash the **Electric Turf fill** (`good` up / `bad` down) fading over 1.6 s; then a trail "▲ 12s" / "▼ 12s" in the matching **ink** colour, fading from 1 to 0.15 over **120 s**, then removed |
| `DataTable` row states | `pulled`: the row flashes `bad-tint` then dims and strikes through, reading "Pulled · N s ago"; `returned`: fades back in with a `good-tint` wash; `new`: slides in with a 3.5 s `good` tint and a "just now" word |
| chart live edge | a "now" guide; the newest point of each drawn series pulses; a point that arrived in this diff pops in (scale 2.6 → 1 over 0.9 s). **None of it on a finished game's chart** |
| freshness heartbeat | 30 one-minute bars of price changes across every book (from the payload's history rows), the current minute in `good` |
| "since you opened" | a counter in the section header: "N prices changed since you opened this · M pulled"; clicking outlines those cells (a `data-recent` ring) and toggles off |
| market-tab "N new" | changes in a tab's market since you last looked at it (the selected tab resets to 0) |
| move lists | new rows slide in marked "just now" (≤ 2 min) |

**Noise rules:**
- **Flash cap:** if one diff changes more than **12** values in one card,
  tint those rows and skip the per-cell roll and flash.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, no pulse, roll
  or slide; trails and ages stay static. A CSS guard test greps the odds
  CSS for the media query.
- **Hidden tab:** animations and ticks stop (§1), and the catch-up count
  shows on return.
- Flaps never reach the page: the bridge's hold buffer (P6 §4) already
  filtered them.

### 4. Load budget

`lib/db` uses one server pool, and pages polling at 30 s multiply requests.
- **Measure:** with 10 browser tabs open on player and game pages (5 each),
  record the requests/min, the p95 route latency and the pool's
  waiting-client count.
- **Accept:** p95 < 500 ms and no pool waits > 1 s.
- **Otherwise:** raise the interval to 45 s, and record it here.

---

## Tests (these gate P10)

| test | kind | what it proves |
|---|---|---|
| `tests/live-diff.test.ts` (new) | TS unit | first payload → no changes; a price up/down → one change with direction; a disappearing price key with the row still present → `pulled`; a reappearing key → `returned`; a new history id → `newMoves`; American −110 → −105 is "up" |
| `tests/live-pieces.test.tsx` (new) | TS render | `LiveDot` state at 1×, 3× and 7× cadence; `FlashValue` renders the trail with opacity by age; `DataTable` row states render their words |
| `tests/odds-ui.test.ts` (extended) | TS guard | the reduced-motion media query covers every animation class; no animation class exists outside `components/odds` and `components/ui` |
| live check | fresh tab, 1440 + 400 | on a live slate (MLB day or NFL Sunday): a real price change flashes once in the right colour; a pulled line strikes through; the dot goes amber when the tab's data is held back by blocking `/api/odds/*` in devtools |
| load | local | §4 numbers recorded |

**Exit criteria:** the tests pass, the live check passes, and the load
numbers are recorded.

## Background checks

None.

## Files touched

- New: `lib/odds/section/liveDiff.ts`, `lib/odds/section/cadence.ts`,
  `components/odds/useNow.ts`, and the tests.
- Edited: the three hooks, `components/ui/LiveDot.tsx`,
  `components/ui/FlashValue.tsx`, `components/ui/DataTable.tsx`, the chart
  primitive, and the odds section components (header counter, tab counts).
