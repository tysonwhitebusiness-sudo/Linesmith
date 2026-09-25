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

---

## Result (2026-09-25)

**Built.**
- **Refresh** (`components/odds/useOdds.ts`): `usePlayerOdds` / `useGameOdds`
  poll every 45 s (§4's rule; below) and `useSlateOdds` every 60 s while the tab is visible;
  hidden pauses, visible refetches at once; one request in flight per hook,
  each with its own `AbortController`; a failed refresh keeps the last good
  payload (the dot's age then says it is held back). A finished game fetches
  once (`useGameOdds(…, { live: false })`). `useGameCloses` / `useScanExtras`
  stay one-shot. The routes are unchanged in kind (pattern 2 for player and
  game, the Slate's 60 s `cachedRoute`); the two polled routes gained a
  `Server-Timing` header (read time + the pool's queue) for §4.
- **Diff** (`lib/odds/section/liveDiff.ts`, pure): `keysOf`, `diffOdds`,
  `advance` (carries "gone" keys so a reappearance reads *returned*). Keys as
  specified; the Slate's summary keys carry the game in the period slot.
- **Memory** (`components/odds/live.ts`): per section — each value's last
  change (2 min trail), moves seen (2 min "just now"), row states, what
  changed / was pulled since the page opened, and what each market tab has
  not been looked at since. `LiveProvider` / `useLive`; outside a provider
  nothing animates.
- **Pieces:** `LiveDot` ticks from the shared visible-only clock
  (`components/ui/useNow.ts`), pulses when live, pings once per change to its
  card, cadence by source class (`lib/odds/section/cadence.ts`: direct 70 s,
  aggregators 90 s, DK Network 480 s, Sleeper pick counts 900 s, Covers
  3600 s). `FlashValue` rolls + flashes the fill (good up, bad down, 1.6 s),
  then a ▲/▼ trail in the ink colour fading 1 → 0.15 over 120 s, then gone.
  `DataTable.rowStateAt` animates `pulled` (bad wash, then struck through,
  "Pulled · N s ago"), `returned` ("Back"), `new` ("just now", slides in
  with a 3.5 s good tint); a state already true at page load never animates.
  `StepLines`' live edge: a dashed "now" guide, each selected series' newest
  point pulses, a point that arrived this refresh pops in (2.6 → 1, 0.9 s);
  none on a finished game. Section header (`LiveHeader`): the 30-bar
  heartbeat (current minute in `good`), and "N prices changed since you
  opened this · M pulled", which outlines those values (`data-recent`) and
  toggles off. Market tabs show "N new". Move lists (Line movement's every
  move, the Slate's steam list) mark new rows "just now". The Slate's game
  cards flash best moneylines, Pinnacle, the total and DK money %.
- **Noise rules:** the flash cap (more than 12 changes in one card's market
  in one refresh → the rows tint, the cells keep their trail and skip the
  roll); reduced motion switches every animation class off (a colour fade
  stays for a flash — colour is not motion); hidden tabs neither fetch nor
  tick.

**Tests:** `tests/live-diff.test.ts` (10), `tests/live-merge.test.ts` (2), `tests/live-pieces.test.tsx` (7),
`tests/odds-ui.test.ts` (+3: the classes exist, reduced motion covers each,
none is used outside `components/odds` / `components/ui`). `npm test` and
`tsc` green.

**Found by the live check and fixed:** a book MOVING its line (−7 → −7.5)
dropped one price key and gained another, which the spec's key rules read as
a pull plus a new price — so the commonest live event showed "Pulled". The
diff now pairs a vanished and a new key on the same book and side as a
change on the new key (test added).

**Live check (2026-09-25, headless Chromium, fresh page per run, text checks
+ one screenshot, `results/p9-live-game-1440.png`):**
- NFL 401872955 game page, 1440: polls every ~30 s (then 45 s); the header's
  30-bar heartbeat, "N prices changed since you opened this · M pulled",
  "N new" on market tabs; 9 pulled rows struck through, each reading
  "Pulled"; no horizontal overflow. **Blocking `/api/odds/*`** (a Playwright
  route abort — the devtools block, scripted): the first dot went **amber
  after 100 s**, "updated 2 min ago".
- The scraper stalled at 17:43 UTC (its watchdog restarted it at 17:44; the
  bridge ran 447 s behind): the CFB 401858234 page at **400 px** showed every
  dot amber by itself ("updated 6 min ago"), no overflow — the dot doing its
  job on real staleness.
- CFB 401862779 at 1440, live data: 111 real price changes in 5 min; ▲
  trails in the good ink and ▼ in the bad ink fading with age (op 0.46 at
  1 min); "just now" on new moves; pings. **No roll/flash fired: the flash cap
  counted every changed value in the market, alt lines at ~38 books
  included, and tripped on every refresh.** Fixed — the board now caps on the
  values it SHOWS. With the next 5 minutes bringing no change to a visible
  value, the flash was verified by nudging the second refresh's Pinnacle
  spread price (+5 home, −5 away) in the intercepted response: +106 rolled
  and flashed **up** (good fill), −119 **down** (bad fill), then ▲/▼ trails
  in the matching ink.
- The screenshot showed "just now" on books that had only posted another alt
  line; "new" now means a book not on the board before (fixed).
- The P8 dev server another session runs on :3001 returned 500 on both odds
  routes while the same code served 200 directly and on this session's own
  server (:3000); every number above is from :3000.

**§4 load budget (measured 2026-09-25, 10 simulated tabs — 5 player pages
polling player + game-line card, 5 game pages — from the laptop's dev server
against the hosted database; `Server-Timing` read time and the pool's queue):**

| run | req/min | p50 | p95 | max | pool queue (max) | non-200 |
|---|---|---|---|---|---|---|
| 30 s, as first built (full game payload every poll) | 22 | 0.8–2.1 s | **5.4 s** | 10.8 s | **22** | 0 |
| 30 s, game page's light refresh | 24 | 0.8 s | **1.3 s** | 2.8 s | 4 | 0 |
| **45 s**, light refresh (shipped) | 16 | 0.6 s | **1.08 s** | 1.3 s | 2 | 0 |

A lone light game read is 220–300 ms; the queries themselves take 8–170 ms
at the database (`EXPLAIN ANALYZE`), so the rest is round trips from the
laptop and the dev server's own overhead, and concurrency on the six-connection
pool (each game read is six parallel queries). **The < 500 ms bar is not met
here; by §4's own rule the interval is 45 s** (`REFRESH_MS`), recorded here.
Pool waits: the queue never exceeded 2 at 45 s and no request took over 1.3 s,
so no wait reached 1 s. Re-measure on a hosted build before tightening.

Two things the measurement found and fixed:
1. **The game payload re-read ten days of history on every poll** (≈10k change
   rows, 2.2–2.5 s per game). The game page now reads in full once, then
   polls `/api/odds/game?…&live=1` (prices, open or just-returned pulls, the
   splits — no history, openers, power ratings or latency) and merges it
   (`lib/odds/section/liveMerge.ts`: a book whose main pair changed gains the
   history point the reader would have made; moves and steam recomputed),
   with a full resync every 8th poll (6 min). `tests/live-merge.test.ts`.
2. **Every `/api/odds/*` read sat in the rate limiter's 10/minute "provider"
   class** (`proxy.ts`): one player page polling (4 a minute plus its load)
   and a second tab froze on 429s — 62 of 88 requests in the first run. P8's
   read routes (`player`, `game`, `slate`, `closes`, `scan`) are now
   `page-read` (60/minute), pinned in `tests/price-freshness.test.ts`;
   `/api/odds/import` stays `provider`.

**Deviations:**
1. `useNow` lives in `components/ui/useNow.ts`, not `components/odds/`: both
   kit pieces that tick (LiveDot, FlashValue) use it, and the kit does not
   import from a page folder.
2. The chart primitive takes its animation classes as props from the odds
   section (`liveEdge.pulseClass` / `popClass`), so the guard's "no animation
   class outside components/odds and components/ui" holds with the chart in
   `components/charts/`.
3. A line move is a change, not a pull (above) — a rule the spec did not
   state.
4. Player and game poll every **45 s**, not 30 s (§4, above), and the game
   page polls a light payload merged onto the full one.
5. The Slate's live memory is keyed on its per-game summary (best ML per
   book, Pinnacle, consensus total/spread, DK money), not on every price,
   because the Slate payload only carries the summary.

**P9: CLOSED** (2026-09-25). Nothing needs a deploy (TypeScript only).
