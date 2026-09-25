# P12 · Alerts, bet slip and odds flags (O8)

**Lane:** TypeScript (alerts, slip) + Python (flags). **Deploys:** one
Render deploy ⚑ (the flags). **Needs:** P8 and P9 (and P11 for the steam
wording beside edges). Operator's green light.
**Goal:** the three surfaces the approved mockup's "Alerts · slip · flags"
tab shows, on real data.

---

## 1. Your lines — alerts (read-time; no new writer)

`tracked_lines` (TypeScript-owned user table, session-authenticated) holds
`user_id, sport, subject_id, subject_name, stat_key, stat_label, side, line,
source, created_at`. There is **no game id and no book** on the row.

**Route:** `GET /api/tracked-lines/alerts`.
- Session-scoped and a direct read (a per-user, request-scoped read; no
  cache, no write).
- For each of the user's tracked lines:
  1. `market_key = candidateDimensionToMarketKey(stat_key)`. None → no
     alerts for that line.
  2. The **next game** = the subject's `prop_odds` rows with a game not yet
     started. None → no alerts.
  3. **The user's book** = the existing user sportsbook setting (the value
     `usePropOdds` passes as `userSportsbook`). None → the "your book" alerts
     are skipped.
- **Alerts** (each with a stable `id = <tracked_line_id>:<type>:<event
  time>`):

| type | fires when | text |
|---|---|---|
| `moved` | the consensus main line for (subject, market) ≠ the tracked `line` | "{player} {stat} — your line moved: {book} {old} → {new}" (the move from `prop_odds_history`, first book to move) |
| `better_price` | at the tracked line and side, the best price across books beats the user's book by ≥ 5¢ (decimal) | "a better price appeared: {best book} {price} vs your {book} {price}" |
| `pulled` | an open `prop_odds_pulls` row for the user's book at the tracked line and side | "{book} took {line} down" (+ "and reposted at {new}" when a new main line exists) |
| `steam` | steam on the market (3+ books the same direction within 30 min) after `created_at` | "Steam on a line you track: {first mover} moved first; N books followed within M min" |

- **Seen state:** per viewer in `localStorage`
  (`linesmith:alerts:seen:<id>`), a convenience wrapped in try/catch. An
  alert already seen shows as read.
- The Slate's **Your lines** section and the header bell show the unread
  count.

## 2. Bet slip — best book now + open at book

- Each leg (`components/SlipModal.tsx`) reads the leg's market from
  `/api/odds/player` (P8):
  - "Best right now: {price} {book} · checked N s ago", and "your {book} is
    N¢ worse" when it is;
  - **"Open at {book}"** uses the `game_reference` `book_link` row for
    (game, book) (P6 §8b).
- No link → no button (never a guessed URL).

## 3. Odds research flags (Python, `slate_rankings`)

Four `RankingDef`s in `python-odds-service/src/slate_rankings.py`, each with
`kind='spotlight'` (never graded) and `freezes=True` (pre-game research), and
their words in `lib/slate/specials.ts` `SPOTLIGHT_RANKINGS`. That is all the
UI needs (CLAUDE.md "Research flags"):

| id | sports | subject | rule |
|---|---|---|---|
| `odds-steam` | all | player | steam on a player prop main line in the last 6 h (3+ books same direction within 30 min); factor = books that followed, minutes |
| `odds-pulled` | all | player | a first-hand book pulled a main line and reposted at a new number in the last 6 h |
| `odds-money-split` | nfl, cfb, mlb, nba, nhl | **game** (`subjectKind` game, like `mlb-hr-parks`) | DK customers' money % − bets % ≥ 15 on the ML, spread or total |
| `odds-first-mover` | all | player | Pinnacle led a move by ≥ 10 min that ≥ 3 books followed |

`top_n` = 10 each. Each `build` reads Supabase (`prop_odds_history`,
`prop_odds_pulls`, `market_splits`). Read lines take **no pronoun** (the
READS rule).

## Tests (the plan's last build gate)

| test | kind | what it proves |
|---|---|---|
| `tests/tracked-line-alerts.test.ts` (new) | TS | fixtures: a moved line → one `moved` alert; the same event twice → one id; better price at 4¢ → none, at 6¢ → one; an open pull at the user's book → `pulled`; no user book → no book alerts; a tracked line with no upcoming game → none |
| `tests/slip-best-book.test.tsx` (new) | TS | the leg shows the best book and the difference; no `book_link` → no button |
| `src/test_slate_rankings.py` (existing) extended | Python | each odds flag on fixtures: steam detected at 3 books in 30 min, not at 2; a money-split game flagged at 15, not 14; no pronouns in the read lines |
| `tests/slate-flags.test.ts` (existing) | TS | the four new flags render through the flags path; `odds-money-split` renders as a game subject |
| render | fresh tab | alerts on the Slate's Your lines, the slip, and flags on player, game and team pages, at 1440 and 400 |

**Exit criteria:** the tests pass, the deploy is recorded, and the renders
match the mockup's Alerts tab.

## Background checks

None.

---

## Result (2026-09-25, `35b10c8`)

**Built.**
1. **Alerts.** `GET /api/tracked-lines/alerts` (session-scoped, direct read,
   no cache, no write; behind the existing `/api/tracked-lines` auth prefix).
   `lib/odds/alerts.ts` decides `moved`, `better_price` (≥ 5¢), `pulled` (+
   "and reposted at"), `steam` (3+ books within 30 min, after tracking); ids
   `<tracked id>:<type>:<event time>`. "The next game" is the player's priced
   game with the earliest start still ahead (`lib/odds/gameStarts.ts`: StatsAPI,
   NHL, ESPN scoreboards, cached 10 min — public schedule data only).
   `components/useTrackedAlerts.ts` is one store for the header bell
   (`AlertsBell` in `TopBar`, signed in only, unread badge, "Mark all read")
   and the Slate's Your lines (an Alerts card; the nav counts it). Seen state
   in `localStorage` (`linesmith:alerts:seen:<id>`), wrapped in try/catch.
2. **Slip.** Each leg reads its market from `/api/odds/player`;
   `lib/odds/slipBest.ts` uses the Best price card's own rule (`boardRows` +
   `bestPrice`). "Best right now … · checked N s ago", "your {book} is N¢
   worse", "Open at {book}" only from a stored `book_link` (`links` on the
   player payload; http(s) only).
3. **Flags.** `src/odds_flags.py` (main-line series ported from TS
   `histFromChanges`, steam, first mover, money split) and four `RankingDef`s
   (`kind='spotlight'`, freezing) + their words in `SPOTLIGHT_RANKINGS`. The
   history is read once per sport-day through
   `price_history.read_prop_changes_for_games`.

**Tests.** `tests/tracked-line-alerts.test.ts` (7: quiet, no game, moved +
stable id, 4¢ vs 6¢, pull + repost + returned, no user book, steam 3 vs 2 vs
too slow vs before tracking); `tests/slip-best-book.test.tsx` (4, incl. the
outlier); `src/test_slate_rankings.py` (steam at 3 not 2, not over 35 min, not
one relay snapshot, first mover 12 min vs 5 min, money split at 15 not 14 and
a GAME subject, no pronouns in the reads, all four spotlights that freeze;
builds on real rows); `tests/slate-flags.test.ts` (the four render through the
flags path, the split as a game). `npm test` 767/767; `tsc` clean.

**Live data.** On today's rows: steam 26–89 players per sport, pulled and
reposted 31–108, money split 11–41 games, first mover 0 (no Pinnacle-led prop
move with a 10-minute lead today — honest). Written for CFB 2026-09-26 and NFL
2026-09-27 through the job's own scoring and writer, and read back through
`/api/slate/flags?date=…`: e.g. NFL steam "Saw 5 books move the receiving
yards line up within 19 minutes, DraftKings first."; the split "MIN @ TB" as a
game subject.

**Render.** `/kit`: the slip leg (this found the bug below), the edge pieces;
signed out the bell does not render and the alerts route answers 401.
**Not seen yet:** the alerts on a signed-in Slate (no test account in this
session — a signed-in pass is the operator's), and the flag chips on a real
player/game page (they read today's date; they appear on 09-26 / 09-27).

**Found and fixed:** the slip's first "best" was bet365 +900 — the kit's D19
outlier. It now uses the Best price card's rule, so the two cannot disagree.

**Deviations.**
1. P8's `detectSteam` stays at 45 minutes; the alerts and the flags apply this
   spec's 30 minutes on top of it.
2. A steam run needs three independent observations (source + time) as well
   as three books: one relay snapshot re-reading five books at one instant was
   "5 books in 0 minutes" on real CFB data.
3. The money split flags |money − bets| ≥ 15 (P10's split, either direction).
4. No header bell existed; `AlertsBell` is new, in `TopBar`.
5. Also fixed in passing: `test_slate_rankings.py` raised on two tennis
   factors with no read template (`games_rate`, `surface_matches`).

**Waiting on the operator:** the worker deploy (the flags come from
`slateRankingsJob`). Until then the CFB/NFL rows written here stand as
written and do not freeze (the old worker does not know these ids).
