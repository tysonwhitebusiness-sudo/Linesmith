# Design findings — operator examples, 2026-09-13

Raised by the operator while reviewing the build plan: cards that hold real
data but **present it in a way that doesn't make sense for the sport**. This
file logs each example with its cause in code so none is lost between
sessions. These feed the design phases being added to `build-plan.md`
(pending three operator answers, see the end of this file).

**These are examples of the kind of problem to find on every card, not a
to-do list.** The design audit (`design-audit-plan.md`) asks two questions of
every single card: *does this make sense at all for this sport, and does this
help at all?*

---

## D1 — NFL game page: score shown twice, broken logos, initials for photos

Operator screenshot, NFL GB @ MIN live, Game Detail.

- The hero card and the live panel directly below it repeat team names, logos,
  score and clock (22–17, Q4 11:03).
- The live panel's logos render with "GB" / "MIN" text overlapping the image.
- Players render as initials ("JL", "CW") where ESPN headshots exist.
- **Season logic:** hero reads `1-2 · 4th in division · W5` and
  `2-1 · 1st in division · L5`. A 5-game streak can't exist inside a 3-game
  season, so the streak spans seasons while the record doesn't.
- The line-movement chart has unreadable axis ticks and a mostly flat line with
  no stated question. The `MIN MONEYLINE` bar shows `-135` with no explanation
  of what it measures.

## D2 — "Game context" card: unnamed subject, mislabeled scope

`lib/sports/shared/analyticsRoles.ts:359` (`toGameContext`).

- It summarises the selected player and market's history, but names neither.
- The row labelled **"Season average"** is the mean of the whole history in
  scope, not the season (`:384`). For soccer's 259-game histories that's seven
  seasons.
- On a yes/no market (line 0.5), "Season average 0.24" and "Median 0.00" are
  the wrong framing. "Scored in 6 of last 25" is the honest sentence.
- The title "Game context" doesn't describe the contents.

## D3 — "Where this sits" card: a distribution chart that says nothing

`analyticsRoles.ts:313` (`toWhereThisSits`), rendered by
`components/PlayerAnalyticsSections.tsx:142` via `charts/DensityCurve.tsx`.

- The sentence it is trying to say: "202nd of 404, dead middle of the pack."
- The measure label the role builds (`<stat> per game · players on this
  market`) doesn't appear on the card as a caption. Axis values 0.08–0.92 have
  no unit.
- The value and rank text overlap the axis minimum label.
- No indication of which direction is better.
- **Comparison group:** every player with ≥3 games (`minGames`), so starters are
  ranked against depth players. That produces the tall spike near zero that
  flattens the rest of the curve.
- **Season logic:** each peer's mean is over all history held, not the season.
- Wrong form for the question. `charts/PercentileRail.tsx` exists and fits a
  single-subject "where does he rank" read.

## D4 — NFL "Target map" drawn as a baseball strike zone

Operator screenshot. Built at `lib/sports/nfl/adapters/playerDetailAdapter.ts:270`
from real nflverse data (`targetMapShapes.ts`). Rendered by
`components/PlayerRoleSections.tsx:266` → `charts/HeatGrid.tsx` with
**`aspect="zone"` hardcoded for every sport.**

- **Root cause is shared, not NFL's:** the `spatialGrid` role
  (`lib/sports/shared/playerRoles.ts:23`) is filled by **MLB, NFL, NBA, NHL,
  soccer and golf**, and all six draw through the same strike-zone box. The
  data abstraction is sound: every sport has a "where" grid. The drawing isn't.
  A football target map belongs on a field (line of scrimmage, deep vs short
  downfield), a shot chart on a half court, a shot location on a rink or pitch,
  proximity on a green.
- **Wrong color meaning:** cells are colored on the red→green good/bad heat
  ramp (`rankToHeat` → `heatFill`), so "2% of targets deep right" reads as
  *bad* and "56% short right" as *good*. Share of targets isn't good or bad;
  it's volume, and needs a single-hue intensity scale. (Recorded before: the
  fill ramp is diverging and misused for sequential data, see
  `project_phase6_chart_grammar` memory.)
- Empty cells (deep left, deep middle) render as blank outlined boxes, which
  reads as broken rather than "no targets there".
- Orientation unstated: left/right from whose view?
- **Season logic:** "41 located targets" doesn't say which season(s). A negative
  average air-yards figure (`-0.6`) is shown with no explanation that screens
  count as negative.

**Shape of the fix (for the design phase, not approved yet):** keep the shared
role data, and add a sport-appropriate surface chosen by the adapter (e.g.
`surface: 'zone' | 'field' | 'halfCourt' | 'rink' | 'pitch' | 'green'`),
rendered by one component per surface. That's `CLAUDE.md` §4's "genuinely
different UI" case, selected by data, never by a `sport === 'x'` check.

## D5 — Rate-limit errors reach the page as raw text, from a budget every route shares

Found during design audit Phase E, 2026-09-13 ~23:40Z. `/nfl/team/13` rendered
only: *"Limit is 60 per 60s for this route. HTTP 429 No teams match. Limit is 60
per 60s for this route."*

- **What the user sees:** the API's raw error detail, printed as page content,
  plus "No teams match", which is false (the teams exist; the request was
  refused).
- **The message is wrong about scope.** `proxy.ts:132`'s `default` rule buckets
  by rule label + client key (`proxy.ts:156`). Every `/api/*` route with no
  specific rule shares **one** 60-per-minute budget, not one per route.
- **Realistic to hit.** One page load fires `picks`, `watchlist`,
  `tracked-lines`, the sport snapshot, teams and more, and live pages poll. A
  few minutes of normal browsing across pages, or one live page left open,
  can exhaust it. On a dev machine (no `x-forwarded-for`) every client shares
  the `unknown` key.
- Not a card, but it decides whether any card renders at all. Carried into the
  build-plan merge (Phase H).

---

## Superseded

The three questions previously listed here were withdrawn. The operator chose a
full design audit instead of adding design phases to the build plan; see
`design-audit-plan.md`.
