# UI system overhaul — master prompt (the U track)

**Status (2026-09-20):** decisions LOCKED by the operator. **U0, U1 and U2 are
DONE** — Tailwind 4, the token bridge, `cx` on tailwind-merge, `RouterProvider`,
the kit page, the Button family, the Hybrid `DataTable` with `Card.count` /
`Card.flush` and `Pagination`, and the borrowed pieces. U2's table migration is
a RATCHET, not a zero, with the six survivors named in `tests/ui-tables.test.ts`.
**Next: S1 — the Slate**, which is what U2 and U5 were sequenced ahead of.
**Build order and scope now live in `docs/design/master-gameplan-ui-and-slate.md`**
(U5 moves ahead of U3/U4; the Slate's new sections are built on this kit; the
Scan table and its filters stay untouched and out of scope). Update this line and the phase's status row at the end of every phase.

**Scope:** the research pages (player, team, game, teams lists), schedules,
bets, the shell, login, privacy and diagnostics. **Not Scan and not the sport
landing (slate) pages** (operator, 2026-09-19). Standing decision #10 holds;
§0b lists exactly what that excludes.

**What this is.** One design system, applied to every page, so the app stops
carrying hundreds of hand-made variants of the same control. It locks the
component decisions from the Untitled UI comparison (operator, 2026-09-19:
"lets do hybrid … lock this and all the other ui choices in") and turns them
into phases a session on any account can pick up cold.

The operator's visual reference is the canvas "Linesmith vs Untitled UI"
(https://claude.ai/artifact/UrwNspzj4nfUFSKXjUaz3D), which has two pages:
Component audit and Tables. It is private to the operator's account, so
**this file is self-contained**: every number the canvas shows is written
down here. Where they disagree, this file wins.

---

Paste everything below the line into a fresh session to start or resume.

---

I'm working on the UI system overhaul (the U track) in this repo. Read these
first, **before doing anything**:

1. `CLAUDE.md`. The sport-adapter rules still hold: no `sport === 'x'` in a
   shared component, and adapters return data, never JSX.
2. `docs/CURRENT.md`. Check what else is in flight; see "Sequencing" below.
3. This file, in full. Then its status line and the Phase table's status column.
4. `components/ui/index.ts` and every file it exports, plus
   `tests/ui-primitives.test.ts`. That is the R3 kit this track extends.
5. `docs/audit-2026-09-13/research-pages-master-plan.md` §2 (rules for every
   phase), §3 (decisions already taken) and the R3 section. R3's rules stand
   unless this file names a change.
6. Before writing Next.js code: the relevant guide in `node_modules/next/dist/docs/`.
   This Next.js has breaking changes; see CLAUDE.md.

## 0. The one rule

**One component per job, and pages only compose.** A page or feature
component never styles a button, input, table, dialog, menu, chip or tooltip
itself. It picks a primitive from `components/ui/` and passes props. If no
prop covers the need, add it to the primitive, where every page gets it, or
write the gap into this file as a finding. Never leave a one-off `className`
recipe at the call site.

What that replaces, measured 2026-09-19 **in scope only**. The §0b files are
excluded; whole-app figures are in brackets.

| measure | count |
|---|---|
| raw `<button>` elements | 99 in 37 files [142 in 52]; there is no Button component |
| raw form elements | `<input>` 11 in 6 files, `<select>` 6 in 4 [19 and 8], beside 18 `SelectBox` uses |
| hand-rolled `<table>` outside `DataTable` / `StatTable` | 17 in 5 files: diagnostics 10, GolfScheduleView 4, and one each in GameResearchPage, PlayerDetail, PlayerRoleSections [20 in 8] |
| hand-typed `text-[Npx]` sizes | 460 outside `components/charts/`, 107 of them below 11px, in 43 files [569 / 132 / 51]; diagnostics 141, GolfScheduleView 64, TennisScheduleView 45, PlayerDetail 40 |
| native `title=` tooltips | 131 in 26 files [162]; they never show on touch |
| legacy CSS recipes in `globals.css` | `.lb-chip` 33 uses in 9 files [41 in 12], a second chip; `.lb-card-interactive` 22; `.lb-btn-primary` 7; `.lb-stat` 2; `.lb-tab` / `.lb-filter` / `.lb-dense` 0 (dead) |
| duplicate primitives | `components/SegmentedToggle.tsx` (glider version) and `components/Skeleton.tsx` beside the `components/ui/` ones. In-scope importers: GolfPlayerStatsCard, OddsChip, PlayerDetail, PlayerDetailPanel. AppShell's slate body and FilterBar also import them, and are out of scope |
| dialogs without a dialog role | `SlipModal` |

## 0b. Out of scope (operator, 2026-09-19)

Scan and the sport landing (slate) pages are **not** redesigned in this track,
and no phase touches their design. Excluded:

- **Pages:** `/` (it redirects to a landing page), `/mlb`, `/nfl`, `/cfb`,
  `/nba`, `/nhl`, `/golf`, `/soccer`, `/soccer/[league]`, `/tennis`,
  `/tennis/[tour]`.
- **Components only those pages use:** `ScanTable`, `ScanCard`, `FilterBar`,
  `FilterSidebar`, `PlayerFilterDrawer`, `DateGameStrip`, `GameLinesView`,
  `GameLine` (the market grid), `TodaysPicksModal`, `useFilters`, and
  `AppShell`'s slate/Scan body. `AppShell`'s chrome (TopBar, slip, footer) is
  in scope: research pages render inside it.

Two rules follow:

1. **U0 still reaches them.** The whole app runs on one Tailwind, so the
   Tailwind 4 move converts their classes mechanically. They must render
   exactly as before; that is the only change they get.
2. **Every guard test reads one shared list, `OUT_OF_SCOPE`,** in
   `tests/ui-scope.ts` (U0 put it in its own module rather than inside
   `tests/ui-primitives.test.ts`, so more than one test file can import it
   without importing a suite), and skips those files. The old-kit pieces
   they use (`components/Skeleton.tsx`, the glider `SegmentedToggle`,
   `.lb-chip`) stay for as long as they do. Every in-scope caller moves off them.

`GamesStrip` is **in** scope: research pages render it (standing decision
#10's exception).

## 1. Locked decisions

### 1a. Engine and source

- **Untitled UI React, free MIT set,** from `github.com/untitleduico/react`,
  pinned at commit `c981a73bcd6b6c68d2a54070f20f020191212828` (checked
  2026-09-19; the license is MIT). **Copy, don't install:** each adopted component is
  copied into `components/ui/`, then rewritten to our tokens, our type ramp
  and our `cx`. After that it is ours. There is no `components/base/` or
  `components/application/` tree: **one kit, one folder.** Record the source
  path and commit in a one-line comment at the top of each copied file.
- **Built on `react-aria-components`** for behavior: press, focus management,
  overlays, keyboard and ARIA. That behavior is the reason to adopt it. Wrap
  the app in React Aria's `RouterProvider`, wired to Next's `useRouter`, so a
  `Button`/`Link` with `href` navigates client-side.
- **Tables keep our own engine** (`DataTable`, a plain `<table>`). React Aria's
  Table renders `role="grid"`: every cell becomes an arrow-key stop and screen
  readers switch into application mode. That suits a selectable list, not
  read-only stats. **Take their look, keep our engine.**
- **Charts are unchanged.** `components/charts/` stays our own chart grammar.
  Don't add Recharts.
- **Icons:** `@untitledui/icons` becomes the chrome icon set (arrows, chevrons,
  close, help, expand, download, sort, filter), at 14, 16 or 20px. Before
  adopting it, confirm its license in the installed package; if it isn't MIT,
  keep chrome icons as inline SVG in `components/icons.tsx`. Sport pictograms
  (`HitIcon`, `RunIcon` and the rest) stay ours. They are **stroke only, never
  filled**; the operator rejected filled glyphs as "emoji-like".
- **Unchanged and not reopened:**
  - system sans (G1);
  - raised cards on a darker paper (G2);
  - graphite brand; `masters` is the primary color;
  - dark mode deferred (§3 #7; the tokens stay built for it);
  - "pages are research, not betting" (§3 #1), including the prop analysis block.

### 1b. The scorecard

| job | call | what we use | replaces |
|---|---|---|---|
| Button | **Adopt** | `Button` (primary · secondary · tertiary · link · destructive), `IconButton`, `CloseButton` | 99 in-scope raw buttons, `.lb-btn-primary`, the ad hoc buttons in `EmptyState` / `ErrorState` / `Card` |
| Text input | **Adopt** | `Field` (Label + HintText + error) with `Input`, `InputGroup`, `Textarea` | hand-rolled inputs: login, SlipModal, the player and team panels, diagnostics |
| Checkbox · radio · switch | **Adopt** | `Checkbox`, `RadioGroup`, `Toggle` | native checkboxes; no radio group or switch exists today |
| Select · search | **Adopt** | `Select` (rich rows: logos, sub-text) and `ComboBox` (search as you type). The first use is the compare pickers (`?vs=` / `?peer=`; "Pick a team" lists 30+ teams). **`SelectBox` stays** as the native select for plain short lists. `MultiSelect` / `TagSelect` are **not adopted**: their only use was Scan's filters | ad hoc selects, long SelectBox lists |
| Menus · modals · sheets | **Adopt** | `Dropdown`, `Modal`, `SlideoutMenu`; `DrillDownPanel` keeps its props API, rebuilt on `SlideoutMenu` | `AccountMenu`'s own menu, `SlipModal`, DrillDownPanel's hand-written focus trap |
| Date range | **Adopt when R12 needs it** | `DatePicker`, `DateRangePicker` | none today; R12's deep-history ranges. `Slider` is **not adopted**: its only use was Scan's filter thresholds |
| Chip · badge | **Borrow** | our `Chip` stays; it gains `dot` (the modern badge's colored dot) | tinted fills used as identity labels |
| Removable pills | **Borrow** | new `Tag` (closable) | compare targets on the player and team pages |
| Tabs · segmented | **Borrow** | our `Tabs` gain `count` per tab; `SegmentedToggle` gains `icon` per option (the ButtonGroup look) | text-only view switches (R10.6 Table / Bars / Lines) |
| Avatar | **Borrow** | our `Avatar` stays (silhouette fallback, never initials); new `AvatarLabel` (photo + name + one sub-line) and `AvatarGroup` (overlapped stack, +N) | ad hoc name rows |
| Data table | **Borrow → Hybrid** | our `DataTable`, restyled and extended per §3 | 17 hand-rolled tables |
| Paging | **Adopt** | `Pagination` (minimal · numbered · show more · show all) | none today |
| Empty · error · loading | **Borrow** | our `EmptyState` / `ErrorState` / `Skeleton` keep their rules (a reason is required; stale data is kept); they gain `icon` via the new `FeaturedIcon` | bare grey text states |
| Tooltip | **Keep ours** | `Tooltip` (hover, focus **and tap**) | React Aria's tooltip never opens on touch, by design |
| Card | **Keep ours** | `Card` gains `count` (badge after the title) and `flush` (the body has no padding, for tables) | none |
| Charts | **Keep ours** | `components/charts/*`, `StatTable` included | none |

## 2. Tokens

### 2a. The bridge: map once, copy files unedited

Untitled UI's files name semantic colors: `bg-primary`, `text-tertiary`,
`bg-brand-solid` and so on. Define those names **once**, in the Tailwind 4
`@theme` block beside our own, pointing at our variables. Copied files then need
no color edits, and `tests/ui-primitives.test.ts` keeps its no-hex rule.

| Untitled UI name | Linesmith token |
|---|---|
| `bg-primary` | `card` |
| `bg-primary_hover`, `bg-secondary`, `bg-active` | `card-sunk` |
| `bg-brand-solid` / `_hover` | `masters` / `masters-dark` |
| `text-primary` | `ink` |
| `text-secondary` | `ink-secondary` |
| `text-tertiary`, `text-quaternary` | `ink-muted` (**never** `ink-faint` for text) |
| `text-brand-secondary` | `ink` |
| `fg-quaternary` (decorative icons only) | `ink-faint` |
| `border-primary`, `ring-primary` | `line` |
| `border-secondary` | `line-soft` |
| `outline-brand`, `focus-ring` | our one focus ring: 2px `ink`, offset 2 |
| `*-error-*` | `bad` |
| `*-success-*` | `good` |
| `*-warning-*` | `warn` |
| `utility-*` hues | **not bridged.** Badge hues are replaced by `Chip` tones |
| `shadow-xs-skeuomorphic` | `shadow-card` on the control; drop the inner gradient |
| `shadow-lg` / `shadow-xl` (popovers, modals) | `shadow-pop` |
| `rounded-lg` · `rounded-xl` · `rounded-2xl` | `ctl` (8) · `card` (12) · `card-hero` (16) |

### 2b. Type: our ramp, one addition

Keep R3's eight steps (`display` … `overline`). Map their sizes:

| Untitled UI | ours | where |
|---|---|---|
| `text-xs` (12) | `label` | |
| `text-sm` (14) | `body` | in controls, menus and modals |
| `text-sm` (14) | `body-sm` (13) | in tables, card headers and `sm` controls |
| `text-md` (16) | new `field` token: 16/1.4, **form fields only** | below 768px; iOS zooms any input under 16px on focus. From 768px up, fields use `body` |
| `text-lg` (18) | `title` (17) | |

Nothing below 11px outside `components/charts/`. Tabular figures in every
numeric column.

### 2c. Control sizes

Ours are denser than Untitled UI's:

| size | height | text | padding | use |
|---|---|---|---|---|
| `sm` | 32 | `body-sm` 600 | 10px | card headers, table footers, filter bars |
| `md` | 36 | `body` 600 | 14px | the default |
| `lg` | 44 | `body` 600 | 16px | primary actions on a phone, modal footers, login; ≥ 44 is the touch floor |

Icon-only buttons are square at the same heights. The card-header icon button
stays 30px, as today.

### 2d. Everything else stands from R3

Spacing 4·8·12·16·24·32·48, card padding 16 (12 dense), header row 44,
breakpoints 400/768/1024/1440, motion tokens and easing, reduced motion =
fades only, the palette in `app/globals.css`, compare colors `cmp-a` /
`cmp-b`, the heat ramp in `lib/ui/heat.ts`.

## 3. Tables: the Hybrid spec (locked)

Tables are most of the product: 106 research-table instances in 25 adapter
files, `DataTable` direct in 7 component files, and 17 hand-rolled tables in
scope. The Hybrid is **our engine and density with Untitled UI's chrome**.
Every in-scope table renders through `DataTable`; Scan's table is out of scope
(§0b). `StatTable` is the one exception: it stays a chart primitive, but it
uses the same type and heat ramp.

### 3a. Anatomy

```
┌ Card ─────────────────────────────────────────────────────────────┐
│ Game log [148]              2026 regular season  [2026|2025]  ⤢  │ header ≥ 50px
├───────────────────────────────────────────────────────────────────┤
│ Date ↓ │ Opp    │ Result  │ AB ⇅ │ H ⇅ │ … │ TB ? ⇅            │ header band 34px, card-sunk
├────────┼────────┼─────────┼──────┼─────┼───┼───────────────────┤
│ Sep 17 │ @ BOS  │ [W] 6–3 │  4   │  2  │ … │ ▇▇▇▇ 5            │ rows 36px
│ …      │        │         │      │     │   │                   │
├───────────────────────────────────────────────────────────────────┤
│ 1–10 of 148 games                    Rows [10▾]  ‹ Prev  Next ›  │ footer 44px
└───────────────────────────────────────────────────────────────────┘
```

**Card header:**
- `card-title` (14/600) title, then the **count badge** (11px 600, `ink-secondary`
  on `card`, 1px `line` ring, radius 6, 1px × 6px padding);
- then the scope, right-aligned (`label`, `ink-muted`, truncates);
- then the controls: `SegmentedToggle` `sm`, or `SelectBox`;
- then the expand `IconButton`.
- The table sits in a `flush` card body, so the header band runs edge to edge.

**Header band:**
- 34px, `card-sunk`, `label` 600 `ink-muted`, sentence case, 1px `line` rule below.
- Sticky top, and the first column sticky left.
- The sort control is a `<button>` inside the `<th>`, not a focusable `<th>`:
  - idle: sort-vertical icon, 12px, `ink-faint`;
  - hover: `ink-muted`;
  - active: an arrow in `ink`;
  - `aria-sort` on the `<th>`.
- **Numeric columns sort high-first on the first click; blanks always sink.**
- **Help:** a column with `info` shows a 13px help icon. It is a button that opens our
  `Tooltip`, with the accessible name "About {label}". It replaces `Column.title`,
  a native title that never showed on touch.

**Rows:**
- **36px** (`default`), `body-sm` 13px.
- Numbers `ink`, right-aligned, tabular. Text columns `ink-secondary`.
- Label column `ink` 500, sticky.
- Rule 1px `line-soft`; hover `card-sunk`.
- Cell padding 12px, first column 14px.
- Images: team logos 18px tiles, player faces 24px circles.

**Compact density** (`density="compact"`):
- 28px rows, `label` 12px text, header band 28px, cell padding 6px.
- Logos 16px, no faces.
- **Required** for matrix tables: the line score and the hole-by-hole grids.
  Allowed wherever a grid of short values would otherwise scroll.

### 3b. What cells can say (props on `Column`)

| prop | draws | rule |
|---|---|---|
| `bar(row) → 0..1` | magnitude bar behind the number, `ink` at 7.5%, inset 5px top and bottom, from the cell's own edge | how much, **never** how good. A share of the column max (`bar: col`) or of the row (`compare: row`) |
| `strong(row)` / `leader` | weight 700 `ink` on the column's unique best | only where a direction is declared; no mark on a tie |
| `heat: { direction, value?, pool }` | cell tint from `lib/ui/heat.ts`. Fill alpha `0.34·|2t−1|`, so the midpoint stays clear; `heatInk` text when `|2t−1| > 0.45` | **per-column opt-in**, only with a declared direction. For splits, ranked blocks, standings, hole difficulty. **Never** on a game log |
| `tone(row) → good \| bad` | `Chip` box `sm` in that tone (for example "W"), then the rest in `ink-secondary` ("6–3") | result and outcome columns only |
| `streak` | 10px squares, gap 3, radius 2. Filled `good` = over or hit; outlined `bad` = under; outlined `line` on `card-sunk` = no line | Last 5, Last 10 |
| `wrap` | text wraps, min width 170px, 8px vertical padding | plays, injuries |
| `headerImage` | a logo before the header label | compare-by-row tables |
| `info` | the help icon and Tooltip | see 3a |

### 3c. Row kinds (props on `DataTable`)

- **`groupBy(row) → string`** draws a group row before each block:
  - 30px, `overline` (11px 600 uppercase, `ink-muted`), 12px top padding;
  - replaces the inline muted label splits use today;
  - "Overall" gets no group row.
- **`totals: Row[]`** are ruled closing rows:
  - `card-sunk`, 1px `line` top rule, weight 600;
  - excluded from sorting, bars, leaders and heat;
  - Season stats' "All held" and a box score's "Team" row move here.
- **`highlight(row)`** marks the subject's own row:
  - `card-sunk` fill, a 3px `ink` inset bar on the label cell, label weight 600;
  - it is never color alone. Examples: your team in standings, the golfer on a leaderboard.
- **`expand(row) → ReactNode | null`** opens a row in place:
  - a chevron button in the label cell, with `aria-expanded` and `aria-controls`;
  - the panel is `card-sunk` below the row;
  - example: a game-log row opening to that game's plate appearances, with "Open the game →".
- **Selection:** none. The one exception is choosing rows to compare, when a
  compare feature asks for it.

### 3d. Paging (`Pagination`, via `paging` on `DataTable`)

| mode | looks like | use |
|---|---|---|
| `minimal` (default in cards) | "1–10 of 148 games" on the left; `Rows [10▾]` and `‹ Prev` / `Next ›` secondary `sm` buttons on the right | game logs, plays, rosters |
| `numbered` | ‹ 1 2 3 … 14 15 › with 40px page buttons | inside `SlideoutMenu` / DrillDownPanel, where the table is the whole view |
| `more` | "Show 20 more" secondary `sm` | short lists: injuries, line movement |
| `all` | "Show all 162 games" link, then the card scrolls (`maxHeight`) | today's behavior, kept as an option |

A table under one page shows its caption instead of a footer.

### 3e. States

- **Loading:** skeleton rows at the real row height and page size. The header
  band stays, so nothing jumps.
- **Empty:** the header band stays, and `EmptyState` renders inside the body.
  It says why and offers the nearest real data ("Show 2025").
- **Error:** `ErrorState` above the stale rows, as today.

### 3f. Phones

- The table scrolls inside its card and never widens the page.
- The label column stays pinned. Once `scrollLeft > 0` it gets a 1px shadow
  edge, and a right-edge fade shows while more columns sit off screen.
- The pager stays under the rows.

### 3g. Migration list

- **All research table cards,** via `TableCard` in `PlayerResearchSections.tsx`.
  Map its existing fields onto the props above: `bar`, `leader`, `tones`,
  `streak`, `compare`, `highlight`, `labelNote`, `text`, `imageUrl`/`imageKind`
  and `views`. Add `groupBy` for splits and `totals` for Season stats and box
  scores. Adapters change only where a field is new, and then in every sport.
- **`DataTable` direct callers** (7 files): `CompareSection`, `CompareView`,
  `GameStateCard`, `LineMovementCard`, `PlayerOddsSection`,
  `PlayerResearchSections`, `TeamCompareSection`. `dense` → `density`; it is no
  longer needed for the default 36px.
- **Hand-rolled tables, deleted as each moves:**
  - the line score (`GameResearchPage.tsx`, the hero; `compact`);
  - the golf leaderboard and three hole grids (`GolfScheduleView.tsx`;
    `compact` + heat for `DifficultyCell`);
  - the golf scorecard (`PlayerDetail.tsx` ~481);
  - the pitch table (`PlayerRoleSections.tsx` ~185);
  - diagnostics' 10 tables, in U6 (`compact`).

## 4. Specs for the adopted components

**Button:**
- **Primary:** `masters` fill, white text. **One per view**: the main action.
- **Secondary:** `card` fill, 1px `line` ring, `ink` text. **Tertiary:**
  transparent, `ink-secondary`, `card-sunk` on hover.
- **Link:** `ink`, underline on hover. **Destructive:** `bad` fill, white text;
  destructive-secondary is `bad` text on a `bad`/25 ring.
- Sizes per §2c. Icons 16px (`sm`) or 18px (`md`/`lg`), leading or trailing.
  Icon-only needs `aria-label`.
- **Loading:** a spinner replaces the leading icon, the label stays, `aria-busy`,
  and presses are ignored. **Disabled:** 50% opacity, not-allowed cursor.
- **Press:** React Aria `usePress`, with `data-pressed` scaling to 0.98. The old
  `.lb-btn-primary` glow goes.
- **`href`** renders a client-side link through `RouterProvider`.

**Field family:**
- **Label:** `body-sm` 600 `ink-secondary`, above the control.
- **Hint:** `label` `ink-muted`, below it. **Error:** `label` `bad` with an
  alert icon; it replaces the hint and sets `aria-invalid`.
- **Input:** 36px (`md`), 32px (`sm`, inside card headers), 44px (`lg`, login).
  - 1px `line` ring; hover `ink-faint` ring; focus a 2px `ink` inset ring;
    error ring `bad`.
  - Text follows §2b's `field` rule; the placeholder is `ink-muted`.
  - Leading and trailing icon slots.
- **Checkbox:** 16px, radius 4; checked and indeterminate are a `masters` fill
  with a white mark; label `body-sm` 500 `ink`, optional hint.
- **Radio:** 16px circle; checked is `masters` with a white 6px dot.
- **Toggle:** a 36×20 track; on = `masters`, off = `card-sunk` with a `line-soft`
  ring; 16px white thumb. It is React Aria's `Switch`.
- **Select and ComboBox popovers:** `card`, 1px `line-soft` ring,
  `shadow-pop`, radius 8.
  - Items are 36px, `body`, with an optional 24px `Avatar` / logo and an
    `ink-muted` sub-text.
  - The selected item gets `card-sunk` and a check.
  - ComboBox filters as you type.
- **DateRangePicker:** the calendar popover in the same chrome. Built when R12
  needs it, not before.

**Overlays:**
- **Modal:**
  - Centered from 768px up, at widths 400 · 560 · 720, radius 16, `shadow-pop`.
    The scrim is `ink` at 40%, with no blur.
  - Header: an optional `FeaturedIcon`, the title (`title` 17/600), a
    description (`body-sm` `ink-muted`) and a `CloseButton` top right.
  - The footer holds the buttons: right-aligned `md` on desktop; full-width
    stacked `lg` on a phone.
  - **Below 768px a Modal opens as a bottom sheet.**
  - Motion `smooth`; reduced motion fades.
- **SlideoutMenu:**
  - Right-edge panel, 560px by default (DrillDownPanel's width), full width
    below 768px.
  - Header: title, subtitle and close. The body scrolls; there is an optional
    sticky footer.
  - `DrillDownPanel`'s props stay, so its callers don't change.
- **Dropdown:**
  - Min width 240. Items are 36px, `body-sm` 500 `ink-secondary`, with a 16px
    `ink-muted` leading icon.
  - Optional shortcut hint; separators; `overline` section headers.
  - `AccountMenu` moves onto it.
- **Tooltip:** unchanged; see 1b.

**Borrowed pieces:**
- **`Chip.dot`:** a leading 6px dot in a named token color, for sport and
  status identity. Semantic tones are unchanged, and `tests/ui-primitives` still guards them.
- **`Tag`:** `body-sm` 500, a 1px `line` ring, radius 6, and a 12px close
  button (`aria-label="Remove {label}"`). Used for compare targets.
- **`Tabs` `count`:** a count badge inside the tab. Active: `ink` on `card`
  with a `line` ring; inactive: `card-sunk`.
- **`SegmentedToggle` `icon`:** a leading 16px icon per option.
- **`AvatarLabel`:** an `Avatar` (24 / 32 / 40), then the name (`body-sm` 600,
  or `body` at 40), then one sub-line (`label` `ink-muted`). This is the
  standard person or team row.
- **`AvatarGroup`:** overlapped `Avatar`s, each with a 2px `card` ring, then a
  "+N" counter circle on `card-sunk`.
- **`FeaturedIcon`:** 40px.
  - `soft`: a `card-sunk` circle with a 6px `paper` halo; tones neutral,
    good, bad, warn.
  - `outline`: a `card` square with a `line` ring.
  - Used by `EmptyState` / `ErrorState` (`icon` prop) and Modal headers.

## 5. The kit page

`app/kit/page.tsx` renders every primitive in every state, plus all 15
reference table types (§7) with fixture data. It is **dev only**: `notFound()`
when `NODE_ENV === 'production'`, and it is left out of every nav. Every
phase checks it at 1440px and 400px, and a phase that changes a primitive
screenshots it. It is the one place to see the whole system at once.

## 6. Phases

The rules are the research plan's §2: build, type-check, render, compare,
commit by explicit path, **stop for sign-off**, and subtract in the same
phase. Plus these:

- `tsc --noEmit` clean, and every TS test passes.
- `npm run build` passes. Use `LB_DIST_DIR=.next-verify` while a dev server
  holds `.next`.
- Render in a **fresh tab** (`tabs_create`): the kit page, then every page the
  phase touched, at 1440px and 400px, for every sport that page serves. Worn
  tabs stop running effects.
- **Each phase adds its guard to `tests/ui-primitives.test.ts`, then points it
  at `components/` and `app/`,** not only `components/ui/`. A guard that can't
  reach zero yet is a **ratchet**: it asserts a count ≤ the number recorded in
  the test, and each phase lowers it.

| phase | what | done when | guard added | status |
|---|---|---|---|---|
| **U0** | **Foundations, no visual change.** Tailwind 3.4 → 4 (by hand; `@tailwindcss/upgrade` was not used — see the note below). Config moved into `@theme` in `globals.css` and `tailwind.config.ts` is deleted. The bridge (§2a) and the `field` token are in. Added `react-aria-components`, `tailwind-merge`, `tailwindcss-react-aria-components`, `@untitledui/icons` (license checked: MIT, v0.0.22). `cx` is `tailwind-merge`, extended so our font-size tokens and the five named durations aren't mistaken for colors and numbers. `RouterProvider` is in the root layout. Kit page skeleton at `/kit`. | **DONE 2026-09-20.** Verified by `scripts/css-diff.js` + `scripts/css-classes.js` (rule-by-rule and class-name diff of the emitted stylesheet, v3 vs v4) rather than by screenshots, and by rendering `/kit`, `/mlb`, `/nfl`, `/mlb/player/[id]` and `/golf/schedule`. Two classes changed on purpose (finding U-1). | `tests/ui-tailwind4.test.ts`: the config is gone, globals.css is a v4 sheet with the v3 globs, postcss runs the v4 plugin, the five durations exist, no renamed utility survives, and the `cx` merge cases | **done** |
| **U1** | **Button family.** `Button` (primary · secondary · tertiary · link · destructive · destructive-secondary), `IconButton`, `CloseButton`, on `react-aria-components`. 73 of the 96 in-scope raw buttons moved. `.lb-btn-primary` and its graphite glow deleted from `globals.css` and its 7 call sites. | **DONE 2026-09-20.** The 23 survivors are each named in `tests/ui-buttons.test.ts` with the phase that removes them: 5 listbox options (U3), 1 modal scrim (U4), 1 old-kit toggle (U5), 14 diagnostics controls (U6, the same sequencing the table guard already uses), 1 in `global-error.tsx` (runs when the stylesheet may not have loaded). | `tests/ui-buttons.test.ts`: no raw `<button>` in scope outside the exact allowlist; `.lb-btn-primary` gone from the CSS and every call site; Button exported from the kit and never imported by path; IconButton still requires `aria-label` | **done** |
| **U2** | **Tables: the Hybrid** (§3). `DataTable` v2: `density`, `groupBy`, `totals`, `highlight`, `expand`, `paging`, `heat`, `tone`, `streak`, `info`, `wrap`, `headerImage`, `align`. `Card` gains `count` and `flush`. New `Pagination` with all four modes. The research cards (`TableCard`, Seasons, Splits, Game log) and all seven direct callers moved; the line score moved out of `GameResearchPage`. | **DONE 2026-09-20, as a ratchet.** The kit page carries the reference types AND the Slate's own tables (Movers, Price outliers, Spotlight, Specials) on fixtures, which is why U2 came before S1. Six hand-rolled tables remain, each named with its phase: diagnostics' 11 (U6), golf's leaderboard and three hole grids (U6), and two that `DataTable` genuinely cannot express yet — findings U-7 and U-8. | `tests/ui-tables.test.ts`: exact per-file counts of hand-rolled `<table>`; DataTable never imports react-aria (the `role="grid"` decision); heat needs a direction and a null value takes no tint; totals are excluded from sorting, bars, leaders and heat; the reference game log carries no heat; `Card.count`/`flush`; the four paging modes | **done** |
| **U3** | **Form controls.** `Field`, `Input`, `Textarea`, `Checkbox`, `RadioGroup`, `Toggle`, `Select`, `ComboBox`, plus `PickList` and `FileTrigger` (U-11). Migrated: login, SlipModal's odds input / leg select / screenshot picker, the player and team panels' search and lists, the golf and tennis schedule lists, the research list card, the line tracker, the compare picker, the header's sport/league/tour selects, and diagnostics' four fields. `SelectBox` keeps its API and is the kit `Select` underneath. | **DONE 2026-09-21.** Zero raw form elements in scope (the Scan-frozen `OUT_OF_SCOPE` files keep theirs). Every field measured 16px at 400px and `body` at 1440. The three lists and the header select exercised by keyboard and click on prod. | `tests/ui-fields.test.ts`: no raw `<input>`/`<select>`/`<textarea>` and no hand-built `role=listbox/option` outside the kit; `FIELD_TEXT` is 16px below 768; the kit's selects are React Aria's; the family is exported and never imported by path. `tests/ui-buttons.test.ts` lost its five listbox entries | **done** |
| **U4** | **Overlays.** `Modal`, `SlideoutMenu`, `Dropdown`, `Popover`. `DrillDownPanel` moves onto SlideoutMenu with its API kept. `SlipModal` and `AccountMenu` move onto them. | Every overlay traps and returns focus, locks scroll and closes on Escape; each announces as a dialog or menu. | no `createPortal` or `role="dialog"` outside `components/ui/` | not started |
| **U5** | **Borrowed pieces.** `Chip.dot`, `Tag`, `Tabs.count`, `SegmentedToggle.icon`, `AvatarLabel`, `AvatarGroup`, `FeaturedIcon` (and `icon` on `EmptyState` / `ErrorState`). Every in-scope `.lb-chip` moved onto `Chip`; both in-scope importers of the glider `SegmentedToggle` moved; the duplicate `Skeleton` primitive deleted so the page-shaped ones compose the kit's. `.lb-tab`, `.lb-filter`, `.lb-filter-active` and `.lb-dense` deleted from `globals.css` — all measured at 0 uses. | **DONE 2026-09-20.** In scope: one chip, one toggle, one skeleton. `.lb-chip` and the glider file stay only while `OUT_OF_SCOPE` files use them, plus diagnostics' 16 chips until U6. Tennis's surface chip became the first real `Chip.dot`: hard/clay/grass were tinted fills, which made a clay match read as a bad one. | `tests/ui-pieces.test.ts`: the three dead recipes are gone; in scope a chip is a `Chip`, a toggle is the kit toggle and there is one `Skeleton`; `dot` is identity and did not add a tone; `Tabs.count` / `SegmentedToggle.icon`; the states take an icon; `AvatarLabel` keeps one sub-line and no initials crept back in | **done** |
| **U6** | **Page sweep,** every page in §8. Each page: primitives only; no `text-[Npx]` outside charts; no native `title=`; no hex literals. Diagnostics goes last (141 hand-typed sizes, 10 tables). | The in-scope ratchets for sizes (460) and titles (131) reach 0. The kit page and every page pass at 1440 and 400. | ratchets → 0: `text-[Npx]` outside charts; native `title=`; hex in `components/` and `app/` (team colors come from data) | not started |
| **U7** | **Close.** Remove the remaining allowlists (not `OUT_OF_SCOPE`); the kit page is complete; `CLAUDE.md` gains a "UI primitives" section (the one rule, where the kit lives, how to add a prop) so new code can't regress. | Every guard is at zero in scope. | none; this is the audit | not started |

**Order:**
- U0 comes first; everything depends on it.
- U1 before U2, because the table footer uses Buttons.
- **U2 (tables) comes early on purpose:** it changes the most pixels on the
  most pages.
- U3–U5 can swap order.
- U6 needs U1–U5.
- U7 closes the track.

## 7. The 15 reference tables

Each one must look right on the kit page and on its real page after U2. These
are the tables on the canvas's Tables page, minus the market grid, which
belongs to Scan (§0b):

| page | table | source | what it exercises |
|---|---|---|---|
| player | Game log | `PlayerResearchSections` GameLogCard | paging, link label, `@`/`vs` + logo, tone chip, 11 columns |
| player | Season stats | SeasonsCard | `totals` ("All held"), not sortable |
| player | Situational splits | SplitsCard | `groupBy`, logos in rows, SelectBox scope |
| player | Results by pitch type | mlb `playerResearchSections` | `bar: col` (Share), `leader` both ways, `info` |
| player | Plate discipline | `charts/StatTable` | stays StatTable: heat bar and rank |
| player | Line movement | LineMovementCard | `initialSort` on Moves, American odds |
| game | Line score | GameResearchPage hero | `compact` matrix, bold R H E |
| game | Batting box score | mlbGameResearch | `views` (NYY / BOS), `labelNote` positions, substitute row, `totals` "Team", faces |
| game | Team stats | nbaGameResearch | `compare: row` (row-share bars, a per-row leader, turnovers low), logos in header |
| game | Plays | mlbGameResearch | `wrap` text column, `views` |
| game | Prop lines and history | shared `gameResearchSections` | `streak` Last 5, text market column |
| game | Props against results | mlbGameResearch | `tone` Went, faces |
| team | Standings | shared `teamResearch` | `highlight` own team, `streak` Last 10, signed Diff |
| golf | Leaderboard | GolfScheduleView | Pos + player pinned, `highlight`, to-par leader low |
| golf | Hole difficulty | GolfScheduleView DifficultyCell | `compact` + `heat` + a par row, 18 columns |

## 8. Page inventory (U6 checklist)

Tick a page only when it renders at 1440 and 400 in a fresh tab using
primitives only.

- **Research (7 sports):**
  - player: `/{sport}/player/[id]` (MLB, NFL, CFB, NBA, NHL, soccer, tennis,
    golf);
  - team: `/{sport}/team/[id]`;
  - game: `/{sport}/game/[id]` (not golf);
  - teams lists: `/{sport}/teams`.
- **Schedules:** `/golf/schedule`, `/tennis/[tour]/schedule`.
- **Bets:** `/bets`, `/bet/[betId]`.
- **Shell:** `TopBar`, `AccountMenu`, `AppShell`'s chrome, `SlipModal`,
  `ComplianceFooter`, `BrandedLoader`, `NoTeamPage`, `GamesStrip`.
- **Other:** `/login`, `/privacy`, `/diagnostics` (admin, last).
- **Not in this list, on purpose:** everything in §0b.

## 9. Traps

- **Tailwind 4 renames** (the upgrade tool catches most; check by eye):
  - `shadow-sm`→`shadow-xs`, `shadow`→`shadow-sm`;
  - `rounded-sm`→`rounded-xs`, `rounded`→`rounded-sm`;
  - `outline-none`→`outline-hidden`;
  - `ring` is 1px by default (was 3);
  - the default border color is `currentColor` (was gray-200). Every bare
    `border` must name `border-line` or `border-line-soft`, or it turns ink-dark.
- **`<alpha-value>` is gone in v4.** Our colors are `oklch(var(--ink) /
  <alpha-value>)`. In `@theme` they become `--color-ink: oklch(var(--ink));`,
  and opacity modifiers (`bg-good/10`) work through `color-mix`. Check
  `bg-good/10`, `border-cmp-a/30` and `bg-ink/[0.08]` on the kit page before
  moving on: these are the tinted chips and table bars.
- **`@apply` with custom classes** in `globals.css` needs `@utility` or a
  `@reference` in v4.
- **`tailwind-merge` and our font-size names.** Without `extendTailwindMerge`,
  `cx('text-label', 'text-ink')` drops one of them. Register our size tokens as
  font sizes.
- **iOS input zoom:** any field under 16px zooms the page on focus. Hence the
  `field` token (§2b).
- **React Aria's `Tooltip` doesn't open on touch.** Never swap ours for it.
- **React Aria's `Table` is `role="grid"`.** Never use it for stats.
- **Two focus systems:** React Aria sets `data-focus-visible`. Style that and
  our `:focus-visible` identically, as the one ring (2px `ink`, offset 2).
- **`RouterProvider`:** without it, a `Button href` does a full page load.
- **Subtract, don't coexist:** a phase that adds the new version deletes the
  old one in the same commit (rule 1 of `master-plan-2026-09-06.md`).
- **Sport adapters:** a new table feature is a field every adapter can set, and
  the renderer never asks which sport it is.

## 10. Sequencing with other tracks

This track touches nearly every `.tsx` file, so **U0 must not run while
another session is editing UI files.**

- Before U0, check `docs/CURRENT.md` and the research plan's status block.
- As of 2026-09-19:
  - R10 and R11 are awaiting sign-off.
  - R12 was approved; R12a–c are built and awaiting sign-off.
  - R12d (couldn't-load vs not-found) and R12e (tennis) are next.
- Recommended:
  - Start U0 once R10–R12c are signed off, and while no R12d/R12e session is
    editing UI files.
  - R12d is mostly data plumbing and can interleave, but not in the same hour
    as U0.
  - Any R12 UI still to build goes on this kit after U2.
- **The operator decides the order.** Ask if it isn't recorded here.

## 11. Findings ledger

Findings from any U phase go here: a row with the phase that fixes it. A
finding that breaks the app is fixed on the spot and still gets a row.

| id | found in | what | goes to | status |
|---|---|---|---|---|
| U-1 | U0 | **Two tint classes were dead in v3 and now work.** v3's opacity scale had no 8 or 12, so `bg-good/12` (a won-game chip in `PlayerResearchSections.tsx:172` and `TeamResearchPage.tsx:191`) and `bg-ink/8` (two diagnostics chips) generated **no rule at all** — the W chip has been rendering with no green behind it while the L chip beside it had `bg-bad/10`. v4's opacity is dynamic, so both now apply. Left applying: the author's evident intent, and the sibling proves it | queue row Q4; U6 may normalise 12 → 10 | **decided, applying** |
| U-2 | U0 | v4 wraps every `hover:` variant in `@media (hover: hover)`. Identical on a desktop; on a touch device a hover style no longer sticks after a tap. This is a v4 default, not a choice, and it is an improvement — but it is a real behaviour change and it is not recorded anywhere else | U6 (check the tap states on a phone) | open |
| U-3 | U0 | `@layer components` classes are no longer tree-shaken in v4, so `.lb-tab`, `.lb-filter` and `.lb-filter-active` are emitted although the U spec §0 measured them as dead (0 uses). Zero pixels, ~10 lines of CSS | U5 deletes them, as already planned | open |
| U-9 | U5 | Tennis's court surface was a TINTED chip — clay on `bad`, grass on `good`, hard on the brand. A surface is identity, not a verdict, and spending the semantic palette on it made a clay match read as a bad one. Moved onto `Chip.dot`, which is why `dot` takes a colour rather than a tone name | fixed in U5 | **fixed** |
| U-10 | U5 | `AvatarGroup`'s "+N" was clipped behind the last face: the avatars carried a descending `z-index`, so the stack went left-on-top and the counter — the one thing that has to be readable — ended up underneath. DOM order now governs | fixed in U5 | **fixed** |
| U-11 | U3 | **The five "listbox options" U1 left for U3 were not selects.** Each is the always-open master side of a master/detail page (players, teams, a schedule, a research list), and a Select or ComboBox would have hidden the list behind a trigger. They became `PickList` — React Aria's `ListBox`, single selection — which is what they had been claiming to be with `role="option"`, now with arrow keys, typeahead and grouped sections. A kit addition the spec did not list | fixed in U3 | **fixed** |
| U-12 | U3 | **`SelectBox` was a native `<select>` at 13px**, so every card-header select zoomed an iPhone on focus, and the header's sport picker was 12px. It is now the kit `Select` (button trigger + popover), which cannot trigger the zoom at any size — the header keeps its compact 28px row | fixed in U3 | **fixed** |
| U-7 | U2 | `DataTable` has no GROUPED header row (a `colSpan` over two columns). The pitch table needs one — "Cristopher Sánchez throws" over two columns and "Marcus Semien sees" over two more — and collapsing it to flat columns would lose which side each number belongs to. Not in the §3 spec, so not invented on the way past | U6, or a `group` on `Column` if a second caller appears | open |
| U-8 | U2 | `DataTable`'s `heat` is a flat tint. Golf's scorecard colours each hole by its score relative to par with a GRADIENT WASH (`gradientCardStyle`), which is a different visual language and the thing that card is for | U6 | open |
| U-5 | U1 | `Tooltip` opens by CLONING its child and attaching `onPointerEnter` / `onPointerMove` / `onPointerLeave`. React Aria's `Button` does not forward arbitrary pointer handlers, so an `IconButton` inside a `Tooltip` would keep working on focus and tap but stop opening on hover — silently. `Card`'s info trigger is the one raw `<button>` left inside `components/ui/` because of it | U4: teach `Tooltip` to wrap rather than clone | open |
| U-6 | U1 | Eight of the sixteen back links used `router.back()` rather than a named destination, which is exactly what `BackLink` exists to avoid ("goes wherever history says — sometimes out of the app entirely"). U1 moved them onto a link-variant `Button` and kept the behaviour, because changing where a page goes is a navigation decision, not a button one | U6 page sweep | open |
| U-4 | U0 render | At 400px the Scan page scrolls horizontally (`scrollWidth` 774 vs `clientWidth` 385) — the dense table widens the page instead of scrolling inside its card. Believed pre-existing (U0 moved no widths) and exactly what §3f legislates against | U2 §3f / S1 | open |
