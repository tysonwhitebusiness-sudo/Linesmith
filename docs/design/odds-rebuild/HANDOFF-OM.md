# Track O · phase OM — handoff (2026-09-24, mid-review)

We are still **gameplanning / mockup review**. Nothing in Track O is built in
the app (D16: no UI until the operator approves 1:1 mockups). The operator is
reviewing `docs/design/odds-rebuild-mockup-2026-09-24.html` and giving design
feedback round by round.

## How to view / regenerate

- Serve: the `design-mockups` launch entry (python http.server :8125 on
  `docs/design`), then open
  `http://localhost:8125/odds-rebuild-mockup-2026-09-24.html`. The operator
  should use their own Chrome or the app's browser pane — NOT the Playwright
  window (its viewport was set larger than the screen once and looked like a
  "can't scroll to the bottom" bug; it wasn't the page).
- Files: page `odds-rebuild-mockup-2026-09-24.html` (CSS + shell),
  renderer `odds-rebuild/om-mock.js`, data `odds-rebuild/om-data.js`
  (frozen snapshot 2026-09-24 1:18 PM ET), tools in `odds-rebuild/tools/`:
  `om_extract.py` (ATL@GB game + London/Bijan/Love/Penix props),
  `om_extract_mlb.py` (Sep 24 MLB slate + TOR@BAL final), `om_extract_props.py`
  (every ATL/GB player's props; `STAT_MAP` folds ~110 source spellings into 16
  markets — seed for B0), `om_extract_final_props.py` (TOR@BAL game 2 props at
  the close vs MLB stats-API box score, gamePk 824784), `om_core.py`
  (market_state), `om_build.py` (writes om-data.js). Run with
  `OM_WORK=<scratch dir>`; `om_build.py` also needs `espn_mlb_0924.json`,
  `espn_mlb_probables.json`, `espn_nfl_rosters.json` in OM_WORK (ESPN public
  scoreboard/roster JSON, fetched by hand).
- Checks used each round: `node --check odds-rebuild/om-mock.js`; in a
  browser, click every surface (Player, Game, Game·final, Team, Slate,
  Alerts) at Desktop and Phone 390 and confirm no `#frame pre` error block,
  no clipped cards, and zero vertical scroll traps (any element with
  overflow-y auto/scroll and scrollHeight > clientHeight).

## Rounds so far

1. **v1** (`ac3d691`): six surfaces on real data; plan §8 lists decisions.
2. **v2** (`3834601`): light sharp strip (no dark bg), visual edge card
   (probability ruler, stat tiles, gate pills), team-colour money bars,
   game-page player props rebuilt as a filterable card (team / position /
   market, sort, Players · By market · Table views), headshots + team logos
   everywhere (required in the final build — no regression), scroll fix
   (every overflow-x scroller now overflow-y:hidden).
3. **v3** (`3ae2f50`; verified on screen in v4): Game page · final gets a
   **Player props · results** card — every prop priced before first pitch
   graded against the box score: summary tiles (overs that hit, longest price
   that hit, Pinnacle's favourite side, overs-hit by market), filters (team,
   result, market), Players and Table views, a result track (line tick vs the
   real number), OVER ✓ / UNDER ✓ / PUSH / DID NOT PLAY marks, MLB headshots.
   DNPs are kept only with ≥ 6 closing prices (a few priced names belong to
   other games — e.g. Carlos Narváez — and are dropped).

4. **v4** (round 4, 2026-09-24): the operator's two open notes plus the live
   layer.
   - **No receipt pills anywhere.** Checked by the sweep: zero `.chip`,
     `.pill`, `.gp`, `.ref`, `.flagc` or `.s2-tag` on any surface at either
     width. Their replacements:
     - Sharp tiles: labelled rows (Checked · Price since / Unchanged for ·
       Limit · Source).
     - Edge card: an Evidence list (logo · sentence · age) and a two-column
       gate checklist headed "N of M pass".
     - Depth card: three mini stats.
     - Coverage: a column list (market · N sources).
     - Flags: a card of labelled rows (kind · sentence · time).
     - Slate cards: rows for DK customers and Kalshi 24 h.
     - Inline status: words in their ink colour ("Pulled", "⚠ check", "Steam",
       "First mover", "split").
     - Kept on purpose: filter buttons (market chips, book picker) and the
       ResultMark chips on the final page, since those are controls or kit
       marks, not receipts.
   - **"Sharp prices" is a normal card header** with the live dot, on the
     strip and on every Slate card. The strip's green left bar is gone, since
     green never marks structure.
   - **Live layer**, all 12 ideas, with one merge: the cell flash and the row
     recency tint became one "change trail".
     - The page replays the last real hour of recorded history at 20× (1/10/20/60×,
       pause, restart). It then runs at 1× past the snapshot, so the dots go
       amber, then grey.
     - Green flash = the number went up; red = down.
     - It re-renders by DOM morphing (keyed rows), so images, scroll position,
       open `<details>` and bar transitions survive each tick.
     - There's a Reduced motion switch in the toolbar.
     - The order book has no history in the snapshot, so it cannot move in
       the replay. The card says so.
   - **v3 verified** at desktop and at 390px (Players and Table views). Two
     phone fixes: the by-market and Pinnacle tiles go full width (market
     names were cut to "R…"), and the result track is hidden at phone width so
     the market label is not squeezed to three lines. The result number and
     ResultMark stay.

## OPEN — operator feedback not yet applied

None as of v4. Waiting on the operator's review of round 4.

**Verifying in the app's browser pane:** a `location.reload()` there opens a
static copy with no scripts running. Navigate to the URL again instead
(add `?v=N` to force it). The first screenshot in a new tab is often blank, and
screenshots can lag the live page by a few seconds; pause the replay before
taking one.

## Still pending with the operator (plan §8)

Offshore/International book groups; extra Scan columns beyond Edge; the
outlier "check" rule; negative hold shown as a fact; openers = first seen;
the two real gated edges found. Approval of the mockups is what unblocks
Track O (O0–O8) and, separately, B0–B2 in the parent plan.
