# Phase E — Render inventory

**Status: COMPLETE 2026-09-14 00:30Z** for everything the calendar allows;
deferred states are listed under Coverage. Captures from the local dev server,
not signed in. This phase records **what renders**. It gives no verdicts;
those are Phase F.

**Totals:** 42 desktop captures, **544 cards**, 96 distinct cards across the
three surfaces (33 player, 32 team, 31 game), plus 5 phone-width captures and
3 dark-mode checks.

- **Matrix:** `E-matrix.md`, every card × every capture, generated from the raw
  data.
- **Raw data:** `E-raw/` (latest cumulative file). Per card: title, text,
  size, image/initials/hover/tooltip counts, overflow.
- **Images:** every card cropped individually, plus a full page per capture,
  in the gitignored `.playwright-mcp/audit/<capture>/`. Crops that back a
  Phase F verdict get committed then, not before.

---

## Coverage

The calendar decides which states can be captured. Audit day is **Sunday
2026-09-13**, captures ~23:20Z onward.

| sport | player pages | team page | game pages | deferred, and why |
|---|---|---|---|---|
| MLB | hitter **live** · SP **live** | **live** day | **live** · final | pre-game: no unstarted games tonight |
| NFL | QB · WR · RB (game just ended) · QB/WR **pre** · QB/WR/RB **live** (SNF) | ✓ | late · pre · final · **live: "Game not found"** (fact 18) | — |
| CFB | QB · WR (both blank) | ✓ | final | live: next Saturday |
| Soccer EPL | FW · DEF · GK (blank) | ✓ | final · pre | live: next matchday |
| MLS (spot) | FW | — | pre | — |
| NBA | guard · big (both blank) | ✓ offseason | final (last season) | all live states: October |
| NHL | skater · goalie (both blank) | ✓ offseason | final (last season) | all live states: October |
| Tennis | ATP · WTA | n/a | WTA match | live: during an event |
| Golf | — | n/a | n/a | **held** until a live tournament (operator decision) |

**Rendering checks:** phone width (400px) captured for MLB player, tennis
player, NFL game, soccer team and NBA team. Dark mode checked on three
surfaces.

---

## What rendered — facts only

### Whole pages

1. **Seven player pages render nothing but one sentence.** CFB QB, CFB WR,
   NBA guard, NBA big, NHL skater, NHL goalie and EPL goalkeeper all show only
   *"No tracked markets for this player on today's slate."* Years of history
   exist for every one of them.
2. **Every phone-width capture scrolls sideways.** All five pages are wider
   than the 400px viewport (MLB player: 431px). The overflow comes from the
   top games strip's fixed-width game buttons.
3. **The app has no dark mode.** Emulating a dark system preference changes
   nothing; the codebase has no `dark:` classes, no theme switch and no
   `darkMode` setting.
4. **A rate-limit error rendered as page content** (`design-findings.md` D5).
   `/nfl/team/13` showed the API's raw "Limit is 60 per 60s for this route"
   text and a false "No teams match".
5. Page depth varies widely across game pages: MLB/NFL 16 cards, soccer 14,
   CFB 10, NHL 9.

### Cards that repeat, or use another sport's vocabulary

6. **"CONTACT QUALITY MATCHUP"** (a baseball Statcast term) renders on the
   **soccer** (Man City) and **CFB** (Ohio State) team pages. NFL's team page
   shows "TEAM MATCHUP — OFFENSE VS. DEFENSE" in the same slot.
7. **The tennis match page uses team-sport cards:** "TEAM STAT COMPARISON",
   "UNIT GRADES", "INJURIES", "RANKINGS · OF 431". The tennis player page labels
   its log "Last 15 games" for matches.
8. **"NEXT GAME" renders twice** on the soccer and CFB team pages.
9. **"OPPOSING DEFENCE"** renders on NFL, soccer and CFB player pages
   (build-plan 1c).

### Scope labels as rendered

10. **Soccer game pages label stats "2025 season".** On EPL that is the finished
    2025-26 season, four games into 2026-27. On **MLS**, which runs a calendar
    year, "2025 season" in September 2026 is a full season old.
11. The NBA game page labels the 2025-26 season "2026 season".
12. The soccer player page for a match that finished hours earlier still shows
    the kickoff time and a pregame price "captured 8h ago".

### Identity (photos and logos)

13. **Initials instead of photos** render on 16 cards: "LAST 5 GAMES" on
    **every game page in every sport**; "ROSTER" on MLB, NFL and CFB team pages
    (not soccer, NBA or NHL); "MATCHUP" on soccer player pages; the NFL live
    game hero (D1).
14. No broken image elements were detected. D1's overlapping logo text
    renders as text over an image, not as a broken `<img>`.

### Interaction

15. Of **476 cards** across 37 desktop captures, **114 (24%)** contain any
    hover styling, 130 any tooltip and 151 any transition class. Most cards
    are static.

### Data-shape facts found while choosing subjects

16. **Soccer candidates carry no player position.** Build-plan item 5b (default
    market by position) assumed one exists. Positions exist on team rosters
    (`/api/soccer/epl/team/:id` → `roster[].position`).
17. **No EPL goalkeeper markets exist** in today's data (dimensions: anytime
    goalscorer, assists, first goalscorer, shots, 2+ goals). Combined with fact
    1, a goalkeeper's page is empty.

### Live state (Sunday night NFL, DAL @ NYG, kicked off 00:20Z)

18. **The live game's page rendered only "Game not found."** Captured at
    00:27Z, seven minutes into the game. `/api/nfl/game/401872930` returned
    404, and the NFL games strip no longer listed the game (it showed the
    following week). Cause and scope are recorded in `build-plan.md` item 1d:
    after midnight UTC the scoreboard range skips the game's US Eastern date,
    so **every primetime NFL game vanishes while it's being played.**
19. **Live NFL player pages look the same as pre-game.** Jaxson Dart, Malik
    Nabers and Cam Skattebo captured live render the same 17–18 cards as before
    kickoff: no score, no in-game stat line, no "live" card (MLB's player pages
    carry "LIVE TODAY"). Card audit C4 recorded this in code; now observed.

### Capture method notes

- A URL fragment (`#…`) on a phone-width player page caused **no cards to
  render**; the same URL without it rendered fully. Seen twice, cause not
  investigated. Recorded so Phase F doesn't mistake it for a real empty page.
- Loading shells can look "settled", so captures wait until real cards or an
  empty-state message appear.
- The limiter shares one 60/min budget across routes, so captures were paced.
