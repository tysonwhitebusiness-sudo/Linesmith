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
3. **v3** (this commit, NOT yet visually verified): Game page · final gets a
   **Player props · results** card — every prop priced before first pitch
   graded against the box score: summary tiles (overs that hit, longest price
   that hit, Pinnacle's favourite side, overs-hit by market), filters (team,
   result, market), Players and Table views, a result track (line tick vs the
   real number), OVER ✓ / UNDER ✓ / PUSH / DID NOT PLAY marks, MLB headshots.
   DNPs are kept only with ≥ 6 closing prices (a few priced names belong to
   other games — e.g. Carlos Narváez — and are dropped).

## OPEN — operator feedback not yet applied (do these first)

1. **No "bubbles"/pills at the bottom of cards as receipts, anywhere.** The
   operator: they read as "AI vibecode"; make them readable and visually
   appealing instead. Examples: the Slate game card footer chips
   ("DK PIT 64% $ · 76% bets", "Kalshi $761k 24h"); also review the edge
   card's evidence chips and gate pills, the sharp tiles' "checked / since"
   pills, the coverage chips, the flags row — anything that is a row of
   rounded pills used as a receipt. Replace with proper labelled rows/mini
   stats (label on the left, value on the right, small logo) or an inline
   sentence, consistent with the kit's table/stat styling.
2. **The SHARP label** (green pill with ◆ at the top of the sharp strip and on
   Slate cards) is different from every other card header. Make the sharp
   strip a normal card header like the others (e.g. "Sharp prices"), and show
   liveness with a **green dot + "updated X ago"** instead of the pill.
3. Then verify v3 (the final-game props card) on screen at desktop and phone,
   fix what's off, and commit.

## Still pending with the operator (plan §8)

Offshore/International book groups; extra Scan columns beyond Edge; the
outlier "check" rule; negative hold shown as a fact; openers = first seen;
the two real gated edges found. Approval of the mockups is what unblocks
Track O (O0–O8) and, separately, B0–B2 in the parent plan.
