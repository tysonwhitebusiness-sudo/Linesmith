# Linesmith

A personal, local-first pick-finder. It scans live sports data for statistically
consistent patterns, surfaces them before the window to bet closes, and lets you
build a slip you reference manually on your own sportsbook app.

It does not place bets, does not connect to any sportsbook, and does not scrape
anything that blocks it. All data comes from free public endpoints: ESPN's
public golf feeds, MLB's official Stats API, and Open-Meteo.

## Running it

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>. The dev server binds `0.0.0.0`, so from a
phone on the same network use `http://<your-machine-ip>:3000`.

For the screenshot odds import, copy `.env.example` to `.env.local` and add your
Anthropic API key. Everything else works without any key.

## How it fits together

```
lib/core/      sport-agnostic engine — types, scan/streak/form, distance & ETA maths
lib/sports/    one adapter per sport, normalising into PickCandidate
lib/db/        SQLite (better-sqlite3); slip + watchlist survive restarts
lib/odds/      screenshot → structured odds via Claude vision + fuzzy roster match
lib/weather/   Open-Meteo
```

Every sport normalises into `PickCandidate`. Nothing in `lib/core/` branches on
`sport` — if a sport needs something the shape can't express, widen the type
rather than forking the engine.

### Adding a sport

1. Write `lib/sports/<sport>/adapter.ts` exporting a `SportSnapshot`.
2. Add the sport to `Sport` / `SPORTS` / `SPORT_LABEL` in `lib/core/types.ts`.
3. Add `app/api/<sport>/route.ts` and `app/<sport>/page.tsx` (four lines each).

The scan views, filter drawer, slip, and cards all work with no further changes.

## Evidence, not a single number

A card doesn't just show one sample. Each candidate carries `supportingSplits` —
the same claim measured several independent ways — because one streak on its own
is weak evidence:

- **MLB**: trailing windows (last 5 / 10 / 15), the same batter against today's
  opponent, and their home-or-away split.
- **Golf**: how the player is handling the same par in the current round, with
  the target hole excluded from its own split so the evidence isn't circular.

Splits are refused rather than padded. A "last 10" is only shown when ten
periods actually exist, and an opponent split needs a minimum number of meetings
— so a thin sample is absent rather than flattering.

The Consistent scan groups by dimension so the reason a set of picks hangs
together is visible before you read a card, and the Player tab shows each
pattern across several trailing windows side by side.

## Images

Player headshots and team logos come from whichever CDN keys on the ids each
adapter already holds:

- **Golf** uses ESPN — the leaderboard feed carries an inline `headshot.href`,
  with the documented CDN path as a fallback.
- **MLB** uses MLB's own CDN, **not** ESPN. The ids come from the MLB Stats API,
  which is a different namespace from ESPN athlete ids; an ESPN headshot URL
  built from a Stats API id 404s.

`SubjectAvatar` degrades headshot → sport fallback (country flag for golf, team
logo for MLB) → initials. It deliberately does not fall back to ESPN's
`nophoto.png`, which reads as a broken asset outside its own context.

## The honesty rule

The app never shows a precise-looking number it can't stand behind.

- Position comes from **completed** units only (holes played, batters retired),
  so it's exact. Minutes are always secondary and carry their provenance:
  `measured` from the subject's own pace, `fallback` from a field median or a
  league constant, or nothing at all.
- Pace samples are rejected outright — not softened — when they're built on too
  few units or land outside a plausible range.
- A timestamp that claims to be a schedule is rejected if it's meaningfully in
  the past. A stale ESPN stamp once got rendered as a real tee time; the guard
  in `validateScheduledTime` exists for that.
- Golf categories come from each round's own score-relative-to-par, so a moved
  tee or an odd pin can't mismark a score.
- MLB batting orders that haven't been posted yet are carried over from the
  team's last game and labelled projected, never presented as today's lineup.
- Golf course weather is a city-level forecast (ESPN gives no coordinates) and
  says so. MLB uses the venue's real coordinates.

Where the answer is genuinely unknown, the UI says "position unknown" rather
than guessing.

## Game-level lines (the-odds-api.com)

MLB moneyline, spread and total are pulled from the-odds-api.com free tier and
shown as context in the MLB **Context** tab, under each game.

The free tier is 500 credits a month, and a credit is charged **per market per
region per call**. The default `h2h,spreads,totals` over the `us` region costs
3 credits per refresh, so refreshing hourly would cost ~2,160 credits a month —
more than four times the allowance. The integration is therefore built around
not spending:

- refresh runs on a **6-hour TTL** (`ODDS_API_TTL_MINUTES`), never per request;
- the cache lives in **SQLite**, so restarting the app doesn't respend a credit;
- auto-refresh **stops** once the API's own `x-requests-remaining` header falls
  to `ODDS_API_RESERVE` (default 25), and stale data is served with its real
  timestamp instead;
- remaining credits and the "as of" time are shown in the UI, so a stale price
  never looks live.

That works out to roughly 360 credits a month, leaving headroom. Raise the TTL
if you add markets or regions. With no `ODDS_API_KEY` set, the feature turns
itself off and says so rather than erroring.

This covers **game lines only**. Nothing free covers golf hole props or MLB
player props, so screenshot import remains the primary odds path for the props
this tool is actually built around.

## Data sources

| What | Endpoint |
| --- | --- |
| Golf field, course, tee times, thru | `site.api.espn.com/.../golf/leaderboard?league=pga` |
| Golf per-hole scores | `site.api.espn.com/.../golf/pga/scoreboard` |
| MLB schedule, lineups, linescores, live feed | `statsapi.mlb.com` |
| Weather | `api.open-meteo.com` + `geocoding-api.open-meteo.com` |
| MLB game lines | `api.the-odds-api.com` (key required, quota-capped) |

Neither golf feed is sufficient alone — the leaderboard has the course and live
status but no per-hole detail, the scoreboard has per-hole detail but no course
or tee times. `lib/sports/golf/espn.ts` merges them on the athlete id.

## Self-test

`GET /api/selftest` runs assertions over the timing, category and engine logic —
split-tee hole maths, pace-guard rejections, the tee-time guard, ETA
provenance, batters-away wrapping, and scan ordering. It exists because a
finished tournament or an empty slate leaves those paths unexercised by live
data.
