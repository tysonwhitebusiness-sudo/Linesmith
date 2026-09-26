# Game page — notes before mockups (2026-09-26)

The operator's direction: the game page should feel like **one page for the
whole game, pregame to postgame**. Pregame is the research page we have; once
live, the live state with the research at the bottom; **no toggle**. The hero
card is the main change. Historical game pages come only after the mockups are
approved (D16).

These are observations to feed the mockups. **Not a gameplan** — that is written
after the mockups are approved.

---

## Looking at a live game when none is on — dev replay (built)

StatsAPI returns any game's feed as it stood at a moment
(`/v1.1/game/{pk}/feed/live?timecode=yyyymmdd_hhmmss`, UTC; `winProbability`
takes the same). The page accepts it in dev:

`/mlb/game/{pk}?replay=<timecode>&speed=<n>` — the clock starts there and runs
at `speed`× real time. A warn chip above the hero marks it as a replay. The API
answers 400 to `replay` in production, and the replay is never cached.

| moment (Reds @ Blue Jays, pk 822760) | path |
|---|---|
| Top 1st, 0-0 | `/mlb/game/822760?replay=20260925_231000` |
| Top 5th, 5-2 | `/mlb/game/822760?replay=20260926_002926` |
| Bot 7th, 5-3, 10× | `/mlb/game/822760?replay=20260926_012000&speed=10` |
| final | `/mlb/game/822760` |

MLB only. ESPN and the NHL API have no equivalent.

## What the page does today (measured, MLB replay)

- **The toggle adds nothing.** Live and final already end with the pregame
  research (Matchup, Starters, Players); "Before start" only hides the game.
  Same in every sport.
- **The hero is the same card in every state.** Its only live content is a
  "Top 5th" chip. Outs, count, bases, batter and pitcher are in a label/value
  table ("The game now") in the first section, not the hero.
- **A pregame page never turns live** without a reload — the page polls only once
  the game is already live. A bug in its own right.
- **No odds section during a live game**, in any sport (the P0–P13 audit's open
  layout item). In-game odds show inside "Right now" only when there are captures.
- **The section order flips when the game starts** (research first before, last
  after), so the nav changes under the reader.
- **What each sport's live "Now" section holds** — the raw material for a live
  hero: MLB situation table, at-bat pitch map, props tracker, in-game odds; NFL
  score, ball on, next snap, last play, win probability; NBA score, last play,
  win probability; NHL score, shots on goal, last event; soccer score, last
  event; tennis sets.

## Parked for after the mockups — historical pages (measured, for reference)

- Past MLB game pages already open; StatsAPI keeps every game (a 2019 game had
  all 318 pitches located). MLB and NFL team schedules don't link past games
  (stale comments at `lib/sports/mlb/teamResearch.ts:61`,
  `lib/sports/multiSport/footballTeamResearch.ts:60`).
- A finished game's page degrades: the final cache rebuilds after 24 h, and
  `prop_odds` holds 7 days, `mlb_statcast_game_pregame` from 2026-09-11,
  `game_odds_history` from 2026-08-12.
- Stored size in `snapshot_cache`: MLB final ~60 KB (335 KB raw, of which the
  pregame research is 199 KB and the pitches 105 KB); NFL ~37 KB, NBA ~46 KB,
  NHL ~18 KB. Every game in every sport ≈ 250 MB a season. A page view sends
  ~36 KB gzipped to the browser.
- The replay makes a pitch-by-pitch scrubber on past MLB games possible.
