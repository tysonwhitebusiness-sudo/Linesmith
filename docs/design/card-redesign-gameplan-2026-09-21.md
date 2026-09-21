# Card redesign — build gameplan (track C)

**Approved 2026-09-21.** The target is `docs/design/card-redesign-2026-09-21.html`,
built 1:1. Where this plan and the mockup disagree, the mockup wins on looks and
this plan wins on where the data comes from. Every file path below was checked
against the tree on 2026-09-21, and so was every claim about data we hold.

Read `CLAUDE.md` first. Four of its rules decide how this gets built:
**Python writes, TypeScript renders** (the new Specials are Python rankings);
**one adapter per sport, no `sport ===` branches** (hero, rail, team colour);
**a page never styles a primitive** (every new look is a kit prop, shown on
`/kit`); and **no edge on the Slate** (`tests/scan-no-edge.test.ts`).

---

## 0. Decisions this plan builds

| # | Decision (operator, 2026-09-21) | Where it lands |
|---|---|---|
| D-C1 | **Electric Turf** replaces the forest good/bad/warn ramp everywhere | C0 |
| D-C2 | Team colour is the colour of player and team content; charcoal stays the frame; **green never marks structure** (headers, nav, rules) | C0, C1, C2 |
| D-C3 | Section headers: **variant A** (full-bleed charcoal band, 2px `#6e727a` top line). Confirmed. | C1 |
| D-C4 | Player hero: team-colour band, overlapping headshot, logo watermark, ranked tiles, opponent-logo form, **collapsible body with a one-time peek** | C2 |
| D-C5 | Player rail: one row shape for every sport, headline stat set by the adapter, kit filters, active row in the team colour | C3 |
| D-C6 | The Slate gets headshots, team logos, team-colour stripes and book marks | C4 |
| D-C7 | Receipts become a graded breakdown table. New Specials: **MLB longest HR, NFL longest reception, NHL 2+ goals**, all forward-looking, with labelled stat tables (value + league percentile + a one-line plain-English read) | C5 |
| D-C8 | Props: **no tabs**. All/Coming up → a status control (All / Upcoming / Live); Watchlist → a toggle; **Home Runs → deleted**. At most two rows of controls on a phone | C6 |
| D-C9 | **Live line tracker deleted everywhere.** `tracked_lines` stays; it backs the watchlist | C7 |

---

## 1. How big is this

**Medium-large. Most of it is surface area, not risk.** Nine phases, roughly
**9–12 working sessions**. Only one part is genuinely uncertain: the three new
Specials need new Python rankings and grading, and one of them needs a new
Statcast column.

| Phase | What | Size | Risk |
|---|---|---|---|
| C7 | Delete the tracker | S (≈0.3) | low — one role key, five adapters, one test |
| C0 | Electric Turf + one team-colour source + kit | S–M (≈0.7) | low; recolours the frozen Scan table (approved, §9 Q2) |
| C1 | Charcoal section headers | S (≈0.5) | low — two render sites |
| C2 | Player hero | M–L (≈1.5) | medium — new tile ranks, structured next-game |
| C3 | Player rail | M (≈1) | low–medium — replaces free-text `statusLine` |
| C4 | Slate imagery | M (≈1) | low |
| C6 | Props controls | M–L (≈1.5) | medium — `AppShell` is 1,029 lines; unfreezes six files |
| C5 | Receipts + three new Specials | L (≈2.5–3) | **the unknown**: new factors, grading rules, a Statcast column, a 30-park orientation table |
| C8 | Close: guards, `/kit`, sweep, CLAUDE.md | S (≈0.5) | — |

**Order:** C7 → C0 → C1 → C2 → C3 → C4 → C6, with **C5's Python half starting
alongside C2**, because it needs real slates to grade before its UI has
anything true to show. Each phase is one commit and leaves the app shippable.

---

## C7 — Delete the live line tracker *(do first: smallest, and it clears the hero area)*

The card has one mount, but the data behind it is a pinned role key.

1. Delete `components/LiveLineTrackerCard.tsx` and its mount at
   `components/PlayerDetail.tsx:1957`.
2. `components/useLiveLineValues.ts`: delete it if the card was its only
   importer (grep first).
3. `lib/sports/shared/playerRoles.ts`: remove the `liveLineTracker` role.
   **The six role keys become five**: update the `ROLE_KEYS` list (line ~343)
   and the file's header comment (lines 8 and 17).
4. Remove the `liveLineTracker` field from all five adapters:
   `lib/sports/{mlb,nfl,cfb,nba,nhl}/adapters/playerDetailAdapter.ts`.
5. `tests/player-roles.test.ts`: six → five.
6. `CLAUDE.md` §Sport-adapter, rule 2 says "the six role keys in
   `playerRoles.ts`". Change it to five.
7. **Keep** `tracked_lines`, `app/api/tracked-lines/route.ts`,
   `components/useTrackedLines.ts` and `components/slate/SlateYourLines.tsx`;
   they are the watchlist.

**Done when:** `tsc --noEmit` is clean, the test suite passes, and a player page
in each in-season sport renders with no tracker card and no console error.

---

## C0 — Foundation: Electric Turf, team colour, kit

### C0.1 Electric Turf tokens

Three places hold the ramp today, and they must change together:

- `app/globals.css:283-285`: `--good: 15 122 79` / `--bad: 194 59 44` /
  `--warn: 183 121 31`.
- `lib/ui/heat.ts:31-40`: `FILL_STOPS` and `INK_STOPS`. The file says they
  "match the good/warn/bad Tailwind tokens exactly".
- `tests/chart-primitives.test.tsx` pins a hex value from the old ramp; update
  the pin.

New values, from the mockup's `:root`:

| role | fill | ink (text) | tint (chip bg) |
|---|---|---|---|
| good | `#00d26a` | `#00873f` | `#d4fbe5` |
| bad | `#ff4d4f` | `#c4161c` | `#ffe3e3` |
| warn | `#ffb020` | `#9a6200` | `#fff1d6` |

**The contrast rule becomes a token rule.** `#00d26a` as text on white is about
1.9:1 and fails. Today, components write `text-good` for text and `bg-good/12`
for tints, so:
- add `--good-ink`, `--bad-ink` and `--warn-ink` tokens (and the Tailwind
  `text-good-ink` etc.);
- sweep every `text-good`, `text-bad` and `text-warn` usage onto the `-ink`
  variant (grep; expect dozens);
- keep `bg-good` for solid fills with dark text on top (`#04311a`, as the
  mockup's W pill does), and white text on `bg-bad`;
- add a guard to `tests/ui-sweep`: **no `text-good|text-bad|text-warn`**
  (fill used as text).

`heat.ts`'s `INK_STOPS` become the three ink values. Check `heatInk()` at a
midpoint (0.5 on `#9a6200`) for 4.5:1 on `--card`.

### C0.2 One team-colour source for every sport

Hand-written tables exist only for MLB and NFL (`lib/sports/{mlb,nfl}/teamColors.ts`).
NFL's comment says "ESPN has no color field on a team". **That is wrong for the
site API**: measured 2026-09-21,
`site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams/{id}` returns
`color` and `alternateColor` for CFB (ALA `9e1b32`), NBA (LAL `552583/fdb927`),
NHL (TOR `003e7e`, no alternate), EPL (ARS `e20520/003399`) and NFL (MIN
`4f2683/ffc62f`, matching the hand table).

- New `lib/sports/shared/teamColors.ts`: `teamColor(sport, teamKey) →
  { primary, secondary | null } | null`. It reads a cached ESPN team index
  (`cachedRoute`/snapshot key `team-colors:{sport}`, TTL 7 days; team colours
  change about once a decade; grep the key first). The MLB and NFL hand tables
  become **overrides on top** of ESPN, not a second source.
- A pure helper, `bandColors(primary, secondary)`:
  - `bandFrom` is the primary darkened until white text is ≥ 4.5:1;
    `bandTo` is `bandFrom` darkened another 25%. That gives the mockup's
    115° gradient: `#4F2683 → #3a1c63 → #2a1449`.
  - When the primary is too light or too dark to carry white text with any
    saturation left (NO gold `#D3BC8D`, LV `#000000`), fall back to the
    secondary, then to charcoal.
  - `accentChip` is the secondary, with its ink picked by contrast (VIKINGS
    gold `#FFC62F` → ink `#3a2a00`).
  - **Unit-test** every NFL/MLB team and a sample of CFB/NBA/NHL/EPL for 4.5:1.
- Golf has no team, and tennis and golf use flags. The hero band falls back
  to charcoal there: data (`teamColor` returns null), not a sport check.

### C0.3 Kit additions (each gets a `/kit` entry and a comment naming the page that needed it)

- `Chip` tone `onColor`: the translucent white chip in the hero band.
- `Avatar` `ring`: the 3px white ring and overlap for the hero headshot.
- `AvatarGroup`: confirm it covers the overlapping book-mark stack (18–20px,
  2px card-coloured border, `+N`); add `tooltip` per mark if missing.
- `ResultMark` (new): the W/L/D square (22px, radius 6) and the grading dot
  (✓/✕/– circle). Today they are hand-rolled at
  `PlayerResearchSections.tsx:164-177` and in `SlateSpecials.tsx`.
- `PercentileCell`: value, then `"98th pct"` in `heatInk`, then a 3px bar in
  `heatFill`. Used by hero tiles (as a tile variant) and Specials tables (as a
  `DataTable` column renderer, `Column.percentile`).
- `Collapse` with `peek`: see C2.4.

**Done when:** `/kit` renders every new piece at 1440 and 400; the U-track
guards pass; and **a screenshot of `/mlb` Props before and after is in the
commit message**, because this phase recolours Scan (approved, §9 Q2).

---

## C1 — Charcoal section headers (variant A)

Two render sites. Both change.

1. **`components/ui/Section.tsx`** (the research pages: 15 uses across
   `PlayerDetail`, `TeamResearchPage` and `GameResearchPage`).
   - Header becomes: `bg-masters` (charcoal), text `--char-ink`
     (`#f4f5f7`), `border-t-2` `#6e727a`, `border-b` `--char3` (`#34373d`),
     padding 16/24, bleeding to the page gutter (`-mx-4` on phones,
     `-mx-6` from `md`).
   - Title: the `heading` ramp (22px, weight 650 in the mockup; use the
     ramp's 600 if 650 isn't a token).
   - `sub` → `--char-ink2` (`#a7abb3`). A count renders as a pill
     (`bg --char3`, 12px).
   - The existing **Hide/Show** control (R10.6, deliberately not remembered)
     moves to the band's right and restyles for the dark background:
     `--char3` fill with a `#454850` border, the mockup's `.btn`.
   - `mb-3` below the band becomes `mb-3.5` (14px).
   - New tokens: `--color-char-ink`, `--color-char-ink2`, `--color-char3`,
     `--color-char-rule` (`#6e727a`).
2. **The Slate's own headers** (`components/slate/SlateSections.tsx:108,135`
   and the `h2`s in `SlateMarket`, `SlateSpotlights`, `SlateSpecials`,
   `SlateModel`, `SlateYourLines`, and the Props heading in `AppShell`). Move
   them all onto `Section` (or a `SectionBand` it shares) so there is one
   header, not seven.
3. **Sticky nav:** `SectionNav`/`SlateSectionNav` is already dark. Give it a
   1px `--char3` bottom rule so a band scrolling under it doesn't merge.
   Re-measure `scroll-mt-[110px]` against the taller band.
4. Phones (< 640): the band wraps. Title 19px; controls drop to their own row
   (`.band .right { width:100% }` in the mockup).

**Guard:** extend `tests/ui-primitives` so that no page file renders its own
`<h2 className="text-title` section heading; they all go through `Section`.

---

## C2 — Player hero

Component: `PlayerHero` in `components/PlayerResearchSections.tsx:88-205`.
It is one component for every sport; everything below arrives as data.

### C2.1 Data the hero doesn't have yet

| Needs | Today | Change |
|---|---|---|
| team colours | `bio.team` = `{id,name,abbr,logoUrl}` | `PlayerHero` calls `teamColor(sport, bio.team.abbr ?? id)` (C0.2). Add nothing to `PlayerBio`. |
| next game, structured | `nextGame: ReactNode` ("@ MIN · 6:40 PM") | New prop `next: { homeAway:'@'|'vs', opponent:{name,abbr,logoUrl}, startsAt, venue \| null } \| null`. `PlayerDetail` builds it from today's candidate/game, as it builds the string now. |
| tile rank | `ResearchTile` = `{label,value,info}` | Add optional `rank?: { rank:number; of:number; pool:string; percentile:number }` (e.g. 34, 142, "RB", 76). Computed in shared `buildPlayerResearch` from the same season pool behind the Prop analysis sub-line ("34th of 142 RB", built at `PlayerDetail.tsx:1668`; trace its source and reuse it, don't compute a second ranking). A tile with no pool (Games) leaves `rank` unset and renders no bar. |
| form-row detail | `lastFive: {date,opponent,result,mark,tone}` | Add `opponentAbbr`, `opponentLogo` and `line` (e.g. "14 car · 38 yds"). `line` comes from a per-sport `formLine` in each `playerResearchSpec.ts` (RB: car · yds [· TD]; QB: cmp/att · yds · TD; WR: rec · yds; hitter: H-AB · HR · RBI; pitcher: IP · K · ER; skater: G-A · SOG; NBA: PTS · REB · AST). |
| season-scope chip | `scopeReason` sentence | Keep the field; render it as the chip "2026-27: 2 games so far" beside the label. Word it in the adapter, not the component. |
| status chip | `bio.injury` | Healthy → chip "Healthy". Injured → the existing injury status as the chip, in bad tint; the detail line stays below the band. |

### C2.2 Layout, 1:1 with the mockup

- **Band** (`.hero-top`): min-height 150; padding 20/24/18; a 115° gradient
  from `bandColors()`; white text.
  - **Watermark:** the team logo at 260px, `right:-30px; top:-40px;`
    opacity .14.
  - **Headshot:** 132px, a 3px `rgba(255,255,255,.85)` ring, `bg` white/12,
    hanging 44px below the band (`margin-bottom:-44px`).
  - **Name:** `display` (32px/700).
  - **Chip row:** position (`accentChip`), #jersey, team name (a link to the
    team page, as today), status.
  - **Right side:** "NEXT" overline, then `@ [26px opp logo] Buccaneers` at
    15px/600, then `Sun 3:05 PM · Raymond James` at 80% opacity.
- **Bio line:** 13px, gap 6/18. Left padding 176px, so it clears the hanging
  headshot (152px for the smaller MLB version; 24px under 900).
  - Content is age, height/weight, birthplace, college, draft and
    experience, from today's `bio.facts`, flattened into one line.
  - Values in bold; long ones are not truncated.
- **Summary bar** (`.hb-bar`), shown whether the body is open or closed:
  - Overline "{scopeLabel} & form", then the first two tiles' values with the
    first tile's rank in `good-ink`, then five 8px result squares.
  - "Show ▾" / "Hide ▴" on the right.
  - The whole bar is one `<button aria-expanded aria-controls>`.
  - When open, the summary fades out (opacity .2s), as in the mockup.
- **Body** (`.hero-body`): a grid of `1fr | 300px`.
  - **Tiles:** 4 across (2 under 900). 10px radius, `bg card-sunk`.
    Overline label, value at 24/700, rank line at 12/600 in `heatInk`, and a
    3px bar at the bottom edge, `width = percentile%`, in `heatFill`.
  - **Form column:** overline "Last 5", the record line, then five rows of
    `[ResultMark][22px logo][opponent][line]`.

### C2.3 Sports without the usual inputs

- Golf: no team, so a charcoal band; no watermark; the form rows use `mark`
  ("-4").
- Tennis: flag for the watermark, charcoal band.
- A player with no history: bar and body are not rendered at all (today's
  `hero.tiles.length` check).
- All of these are data-driven; **no `sport ===` checks** (CLAUDE.md §4).

### C2.4 Collapse and peek

- The body starts **closed**.
- `Collapse` primitive (C0.3): `max-height` 0 ↔ 900,
  `.45s cubic-bezier(.3,.7,.2,1)`.
- **Peek:** 700ms after mount, a keyframe `0 → 96px (32%) → hold (62%) → 0`
  over 1.5s, while the chevron nudges 3px down. It runs **once per viewer**:
  `localStorage['lb.heroPeekSeen']`, wrapped in try/catch; if storage throws,
  the peek plays every time, which is harmless.
- Never with `prefers-reduced-motion`.
- The open/closed state itself is **not remembered**, matching `Section`'s
  R10.6 rule.
- The body is hidden with `max-height`, not unmounted, so charts keep their
  state. Tiles have no ResizeObserver, so nothing needs re-measuring.

### C2.5 Tests

- `tests/player-research-hero.test.ts`: `rank`/`line` built for each sport's
  spec. A tile with no pool has no rank.
- The band colours pass 4.5:1 (C0.2 test).
- Render-check `/nfl/player/3042519` (Aaron Jones), an MLB hitter, an MLB
  pitcher, an NBA player (off-season last-season scope), golf and tennis at
  1440 and 400 in a **fresh tab** (memory: worn tabs stall effects).

---

## C3 — Player search rail

Component: the list in `components/PlayerDetailPanel.tsx:200-230` (kit
`PickList`, `components/ui/Fields.tsx:~445`).

1. **Row data.** Today `sub: s.statusLine` is free text, and each sport writes
   its own (`lib/core/types.ts:286`; CFB builds it at `lib/sports/cfb/adapter.ts:398-416`).
   Replace it with structured fields on the subject:
   `headline: { value: string; unit: string } | null`,
   `matchup: string | null` ("@ TB · Sun 3:05", or "no game today"), and the
   existing market count.
   - **The adapter picks the headline stat** by position: RB rush yds, QB pass
     yds, WR/TE rec yds, hitter OPS, SP ERA, golfer SG:Tot, NBA PPG, skater
     points, goalie SV%. The row reads the same in every sport; only the
     number differs.
   - Delete `statusLine` once every sport fills `headline`.
2. **Row layout** (new `PickList` props, each commented with who needed it):
   - `image`: 40px headshot with an 18px team-logo badge at the bottom
     right (white disc, 1px line).
   - `label` + position `tag`.
   - `sub` = matchup.
   - `trailing` = headline value (15/700) + unit (11px muted) + a
     `"6 mkts"` good-tint chip (replaces the unlabelled count badge).
   - `accent` = team primary. The selected row gets a sunk background and a
     3px bar in that colour at `left:0; top:10; bottom:10`.
3. **Filters**, above the list, all kit:
   - position (multi-select, `PickList` in a `Popover`); the current
     position pill row goes;
   - team (`ComboBox`); game (`Select`, today's games);
   - "Has props" (toggle chip); injury status (`Select`);
   - sort: headline stat (default, descending), name, markets.
   - Active filters render charcoal with a remove ✕ (`Tag`, `Pieces.tsx:36`).
   - A count line above the list: "18 players · Sort: Rush yds ▾".
   - State lives in the URL (`?pos=RB&props=1&sort=headline`), the same as
     every R-track control.
4. Mobile: the rail is already a drawer on phones. The filters wrap to at
   most two rows inside it (with five filters, they fit).

**Done when:** every sport's rail shows the same row shape; the filters combine;
and the URL round-trips.

---

## C4 — Slate imagery

1. **Game cards** (`components/slate/GameCard.tsx`, logo at line 26):
   - a 5px stripe split into the two teams' primaries (`teamColor`, C0.2);
   - logos 24 → **36px**; the team record under the name in 12px muted;
   - spread and moneyline columns right-aligned, tabular;
   - a footer row: stacked book marks (`AvatarGroup`, max 6) ·
     "N books · consensus" · "Research →";
   - live games: a red dot with "LIVE · Q2 7:41" in `bad-ink`.
2. **Book marks:** `components/BookLogo.tsx`'s `BOOK_DOMAIN` has 11 books and
   is missing the ones the Slate shows most. Add `kalshi` → `kalshi.com`,
   `prophetx` → `prophetx.co`, `hardrockbet` → `hardrock.bet`,
   `betrivers` → `betrivers.com`, plus labels. Check each against
   `entity_resolution.canonical_bookmaker`'s ids. Favicons still come through
   the Google favicon proxy; keep the text fallback.
3. **Books section** (`components/slate/SlateMarket.tsx`; data in
   `lib/slate/marketMoves.ts`, which already carries `subjectId` on
   `OutlierRow`/`MoverRow`):
   - the player cell gets a 30px headshot via the same player-index lookup
     `PlayerDetailPanel` uses;
   - the Book cell gets an 18px mark and the label;
   - **Gap stays neutral**: a `warn`-tint pill, never green or red
     (no-edge rule);
   - "At the other line" becomes `AvatarGroup` (max 5, "+N · N books"),
     with names in the `Tooltip`.
4. **Spotlights** (`SlateSpotlights.tsx`) and **Model** (`SlateModel.tsx`):
   headshots and logos wherever a player or team is named.
5. `tests/scan-no-edge.test.ts` must still pass. Nothing here colours a price
   difference.

---

## C6 — Props controls (tabs → filters)

### C6.1 Unfreeze (D3 allows it)

Remove these from `tests/ui-scope.ts`'s `OUT_OF_SCOPE`: `FilterBar.tsx`,
`FilterSidebar.tsx`, `PlayerFilterDrawer.tsx`, `DateGameStrip.tsx`,
`useFilters.ts`, `SegmentedToggle.tsx` (and `AppShell.tsx` once its Props
body is on the kit).

`ScanTable.tsx`/`ScanCard.tsx` **stay frozen**: `tests/slate-shell.test.ts:199`
pins them by length at 47266 / 17654. The U-track guards will then sweep the
unfrozen files, which is the point. Expect them red until C6.3 lands.

### C6.2 Tabs → filters (`components/AppShell.tsx`)

- `SCAN_VIEWS = ['All','Coming up','Watchlist','Home Runs']` (line 100) is
  replaced by two independent filters:
  - `status: 'all' | 'upcoming' | 'live'`, where "live" is new: a game whose
    state is in progress, which the Slate already reads;
  - `watchlistOnly: boolean`.
- **Home Runs is deleted** along with its board: `views.homeRuns` (lines
  ~462-468), the `renderList(..., 'modelProb')` branch (line ~966), the note
  at ~791, and the effect at 292-295 that resets it for non-MLB sports. HR
  props remain a value of the Market filter. The HR *ranking* is Specials.
  The memory rule "delete outright, no dormant fallback" applies.
- The four tab counts become one line: **"Showing 9 of 33 ·"**, followed by
  the active filters as removable chips and "Clear all".
- Filters: Games, Market, Team, **Position (new)**, Hit rate, Odds, Streak,
  Book. These are today's `FilterBar` pills, rebuilt on kit `Select`/`Popover`.
  All state goes through `useFilters` into the URL.
- View switches (grid / list / columns) become kit `IconButton`s.

### C6.3 Responsive, 1:1

| Width | Layout |
|---|---|
| ≥ 1024 | Row 1: search (max 340) · status segmented · Watchlist toggle · spacer · view buttons. Row 2: the 8 filters, wrapping. Row 3 (only if any filter is on): Showing line + chips. |
| 640–1023 | Row 2 stops wrapping and scrolls sideways in one line, with a right-edge fade (`mask-image`). |
| < 640 | Row 1: search · **Filters (n)** (charcoal, count badge) · ⋯ (the view switches fold into it). Row 2: status (stretched) · Watchlist. The 8 filters live in kit `SlideoutMenu` as a **bottom sheet**: rows showing the current value (›), "Reset", and a charcoal "Show 9 props" apply button. Active chips are one sideways-scrolling row, absent when none are on. **Worst case: three rows.** |

**Guard:** a Playwright check at 390px that the controls card is ≤ 3 rows (the
distinct `top` values of its visible children, measured the way the mockup was
checked on 2026-09-21).

---

## C5 — Receipts + three new Specials

### C5.1 What exists (measured)

- `slate_rankings` (migration `20260920060000`) holds, per ranking and
  player: rank, score, `factors jsonb` (**each factor's raw value AND its
  percentile already**), `frozen_at`, `outcome jsonb`.
- Writer: `python-odds-service/src/slate_rankings.py`. Its `RANKINGS` tuple
  is at line 467; the builders are `build_mlb_hr`, `build_mlb_k`,
  `build_football_td` and `build_soccer_goals`.
- `lib/slate/specials.ts` mirrors `RANKINGS` (labels, info), and
  `tests/slate-specials.test.ts` parses the Python file to keep the two
  identical.
- `grade()` (line 554) records `{played, value, hit: value > 0}`. That rule is
  hard-coded and is wrong for 2+ goals and for the "longest" rankings.
- **The `4. 4241372 · no` bug:** a row whose `subject_name` was null renders
  its id. It is fixed at the writer: `_roster_names` falls back to the
  player-index name, then to "Unknown player", never the id. The UI also
  refuses to print a bare numeric name.

So the mockup's factor table (value + percentile per column) **needs no new
storage**. It is a new way to render `factors`.

### C5.2 Grading, generalised (Python)

- Add `hit_rule` to `RankingDef`:
  - `'any'` (TD, HR of the day, goalscorer: value > 0);
  - `'gte2'` (NHL 2+ goals);
  - `'slate_max'` (longest HR, longest reception).
- For `slate_max`, grading also finds **the slate's actual leader**, even if
  that player isn't ranked. It writes one extra row per ranking and slate,
  `subject_id='__leader__'`, with `outcome = {leaderId, leaderName, value,
  ourRank|null}`. That row drives the "Yesterday: longest was 468 ft ·
  K. Schwarber — our #3" line.
- `outcome` gains `detail`: the stat line for the breakdown table, e.g.
  `"22 car · 118 yds · 1 rush TD"`, `"7 rec · 88 yds · 0 TD"`, or
  `"Inactive"`. It is built in Python from `player_game_history`, using the
  same keys the per-sport `formLine` (C2.1) uses in TS. Test that the two
  agree.
- Add `read`: the one-line plain-English sentence, **built deterministically
  in Python** from the player's top two factors by percentile, through a
  per-factor template ("Coors adds ~20 ft to every fly ball…"). No LLM.
  Store it in `factors._read`. Grep the no-edge guard's banned words before
  writing templates: no "edge", no "value", no "best bet".

### C5.3 The three new rankings

Each is a `RankingDef` + builder + mirror in `specials.ts` + a factor list
**restricted to data we hold**. The mockup's columns are the target; a column
whose source isn't held is dropped and named in `notHeld`, never faked.

**`mlb-longest-hr`**: who hits the day's longest HR. `hit_rule='slate_max'`.
- **New data:** `hit_distance_sc`. `statcast_pitches.py`'s `PitchEvent` holds
  `launch_speed` and `launch_angle` but **no distance**. Add
  `hit_distance_sc` to the dataclass and parser, add a migration for the
  column, and backfill this season (Savant CSV already carries it).
  Grading reads the max `hit_distance_sc` where `events='home_run'`, per
  batter per date.
- Factors, all from Statcast rollups: barrel % · max EV · average HR
  distance · HR ≥ 430 ft count · park (a distance factor, not the run factor)
  · opposing SP HR/9.
- **Wind and temperature come from the linked Open-Meteo feed**, the one
  everything else reads: `python-odds-service/src/predict/weather.py`'s
  `get_weather(client, lat, lon, approximate, at)`, which returns
  `wind_mph`, compass `wind_dir`, `temp_f` and `rain_pct` at first pitch.
  Venue coordinates come from the MLB schedule feed (statsapi's venue
  passthrough), the same way the game model gets them. Don't add a second
  weather client.
- **Temperature** becomes a factor directly (warm air carries). It needs no
  park data, the same reasoning as `weather_runs_factor`.
- **Wind out/in needs each park's orientation**, which is deliberately not
  held today (`lib/sports/mlb/adapter.ts:238-241`: one wrong park silently
  corrupts that game). Build it as its own reviewed piece:
  - a 30-row table in Python, `predict/park_orientation.py`, holding each
    park's home-plate→center-field bearing in degrees, its roof type
    (open / retractable / fixed), and a **source per row**;
  - the roof list already exists at `lib/sports/mlb/adapter.ts:211`, so
    port it rather than retyping it;
  - a test that every current MLB venue id has a row;
  - the operator spot-checks five parks against a map before it ships.
- The factor is the **out-component** of the wind:
  `wind_mph × cos(wind_from − (bearing + 180°))`. Wind *from* home plate's
  side blowing toward center is positive. The Wind cell shows
  "Out 11" / "In 6" / "Cross 4".
- **Roofs:** fixed-roof parks get no wind factor. Retractable roofs have no
  open/closed state in any feed we read, so their wind cell shows "Roof —
  may close" and the factor is left out of their score, not zeroed.
- Until the orientation table is signed off, longest HR ships with
  **temperature and wind speed only**, and `notHeld` says "wind direction
  relative to the park is not held yet". That matches the existing HR of the
  day `notHeld` line, which both rankings drop together once the table lands.

**`nfl-longest-reception`**: who has the slate's longest catch.
`hit_rule='slate_max'`.
- Grading: `receiving.longReception` per game is already in
  `player_game_history` (the NFL spec reads it at
  `lib/sports/nfl/adapters/playerResearchSpec.ts:128`).
- Factors: aDOT, 20+ air-yard targets per game and air-yard share from
  `python-odds-service/src/nfl_pbp.py`; YAC per rec; season long; opponent
  20+ passes allowed (from `team_production.py`).
- `entity_resolution.py:191` already resolves the `longest-reception` market.
  A line is a later, optional add, and never on the Specials card.
- Also runs for CFB if its play-by-play covers air yards; check before
  claiming it.

**`nhl-two-goals`**: who scores twice. `hit_rule='gte2'`.
- Grading: `goals` per game from `player_game_history` (NHL skater keys at
  `backfill_player_game_history.py:460`).
- Factors: shots/g, xG/60 (from `nhl_shots`, if it rolls up per player),
  PP TOI, 2+ goal games last season, opponent GA/g, opponent goalie SV%
  last season.
- **Off-season until Oct 7**: build it, run it against 2025-26 games in a
  test, and ship it hidden until the first real slate.

**Pre-registration:** `docs/design/m3-ranking-preregistration.md` governs
weights; the three new rankings start at **equal weights** like the others,
and each is added to that doc before its first live slate.

### C5.4 UI (`components/slate/SlateSpecials.tsx`)

- **Receipts card**, 1:1 with the mockup:
  - **Header:** "{title} · {date}" overline; the big number
    "2 of 5 who played scored" (32/700).
  - **Result bar:** one segment per ranked player (green = hit, red = played
    and missed, hatched = did not play) with a legend.
  - **Right side:** "Last 7 slates" bars and "9 of 31 who played".
  - **Table:** Rank · Player (headshot + team logo + abbr) · Game ·
    What happened (`outcome.detail`) · Result (`ResultMark` + word).
    Did-not-play rows are muted. Ties share a rank.
  - **Footer:** "Each player is graded on their own — a ranking of separate
    calls, not a parlay."
- **Special cards**, full width:
  - Header: title, the question ("Who hits the day's longest HR · 12
    games"), and a sport chip.
  - A `DataTable`: rank · player cell (headshot, logo, matchup, `read`
    line under it) · one `PercentileCell` column per factor, with the label
    and a unit sub-label in the header.
  - The receipt line under the table.
  - A caution note **only while a factor is `notHeld`**.
- Phones: the table scrolls sideways inside the card. The player column is
  sticky (`DataTable` sticky first column; add it if missing).
- `tests/scan-no-edge.test.ts` covers `SlateSpecials`, so no probability and
  no price may appear. The percentile is a factor rank and is allowed (S4
  already renders factor percentiles).

**Done when:** a real NFL Sunday and an MLB day have been frozen and graded by
the new code, and their receipts render from real outcomes. **Don't sign off
C5 on placeholder data**: the mockup's stat lines are illustrative.

---

## C8 — Close

1. `/kit`: every new primitive and prop, at 1440 and 400.
2. Guards:
   - fill-as-text ban (C0);
   - one section header (C1);
   - ≤ 3 control rows at 390 (C6);
   - five role keys (C7);
   - band contrast (C0.2);
   - Specials parity with Python;
   - `hit_rule` coverage.
3. `CLAUDE.md`:
   - UI primitives: add `Collapse`/peek, `PercentileCell`, `ResultMark`,
     `teamColor`, and the fill-vs-ink rule;
   - Slate: the D3 note becomes "table frozen, controls on the kit";
   - adapters: five role keys; the rail's `headline`.
4. Render sweep: every sport at 1440 and 400, fresh tabs, document width =
   viewport, no console errors. Screenshots in the closing commit.
5. Mark `card-redesign-2026-09-21.html` historical (as S6 did for the Slate
   mockup), and rewrite `docs/CURRENT.md`.

---

## 9. Operator answers (2026-09-21) — no open questions

1. **Header variant A**: confirmed.
2. **Electric Turf recolours Scan**: confirmed. `ScanTable`, `ScanCard` and
   `StatCells` read the good/bad tokens, and a palette is a token, not the
   frozen design. The file-length pins stay.
3. **Home Runs board**: delete outright, along with `views.homeRuns` and the
   `'modelProb'` list.
4. **Weather**: use the linked Open-Meteo feed (`predict/weather.py`) that
   everything else reads. Wind direction relative to the park needs the
   30-park orientation table in C5.3, which the operator spot-checks.

## 10. Checkpoints for the rotating accounts

Each phase is one commit, named `C{n}: …`. After each commit, rewrite
`docs/CURRENT.md`'s "Where the work is" row. C5's Python half is **not done
until it has graded a real slate**, so its checkpoint names the next slate
date it is waiting on.
