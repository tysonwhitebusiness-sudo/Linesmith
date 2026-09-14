# Phase F2 — Visual system

**Status: COMPLETE 2026-09-14. Proposal only; nothing changed.** Charcoal (the
graphite palette) is the approved color direction and stays. Everything below
is measured first, then proposed.

**Evidence:** `F2-raw/code-metrics.md` (per component file), `F2-raw/rendered-probe.json`
and `F2-raw/rendered-summary.txt` (computed styles from 12 desktop pages and 3
phone-width pages: 9,986 text elements, 200 cards, 280 hover probes, 300
keyboard focus stops).

Pages probed: MLB player, game, team · NFL player, game, team · soccer player,
game, team · NBA team · NHL team · tennis match; phone width for NFL player, NFL
game, soccer team.

---

## Summary

1. **Two styling dialects coexist.** Game-page components use the type scale
   (`GameDetail` 87%, `GameHeroCard` 100%, `PitchingMatchupCard` 100%);
   player and team pages barely do (`PlayerDetail` **0%**, `TeamDetail` 2%,
   role sections 0%). The scatter isn't random: part of the app was migrated to
   tokens and part wasn't.
2. **Half of all text is smaller than 11px** (8px 7%, 9px 16%, 10px 16%, 10.5px
   10%). Every page renders 32–42 distinct text styles; the app 57.
3. **43% of text fails WCAG AA contrast.** One gray, `ink-faint`
   (`rgb(151,152,155)`, about 2.4:1 on a card), is **41% of all text** on the
   page.
4. **Nine card-header styles** across 200 cards: uppercase 10.5px bold with and
   without a tinted bar, sentence-case 12px, uppercase 11px, 16px, 18px…
5. **80 text colors** in use; 130 color literals hardcoded in components.
6. **The number font is dead weight.** IBM Plex Mono is loaded on every page
   and used by 1 element; 100% of rendered text is system sans.
7. **Shared primitives exist but aren't the default.** `SegmentedToggle` is used
   in 7 files while 12 files hand-roll toggle groups with 4 different "active"
   styles; `Chip` in 4 files beside `FilterChip`, `GradeChip`, `OddsChip`,
   `ConfidenceChip`; the chart library in 5 files.

---

## 1. Typography

### Measured (rendered, desktop)

| size | share of text | size | share |
|---|---|---|---|
| 8px | 7% | 12px | 11% |
| 9px | 16% | 13px | 13% |
| 9.5px | 2% | 14px | 2% |
| 10px | 16% | 15–44px | ~2% combined |
| 10.5px | 10% | | |
| 11px | 22% | | |
| 11.5px | 1% | | |

- Weights: regular 62%, semibold 24%, medium 10%, bold 4%.
- Uppercase: 11% of text.
- Code: **594 hand-typed `text-[Npx]` vs 256 scale tokens** in components;
  `tailwind.config.ts` defines 10 steps (`micro` 9 … `display-lg` 44) that most
  components bypass.
- Numbers: `tabular-nums` used 266 times (good); Plex Mono effectively unused.

### Problems

- **Too small to read comfortably.** 8–10px is caption territory, and half the
  page is set there, including values, not only labels.
- **Too many near-identical steps.** 9 / 9.5 / 10 / 10.5 / 11 / 11.5 / 12 / 12.5
  aren't a hierarchy; nobody can see the difference between 10 and 10.5, so they
  add inconsistency without adding meaning.
- **Hierarchy comes from uppercase and weight rather than size,** which is why
  pages read as "all the same weight of noise".

### Proposed ramp (8 steps)

| token | size / line height | weight | use |
|---|---|---|---|
| `display` | 32 / 1.1 | 700 | hero numbers: live score, headline stat |
| `heading` | 22 / 1.2 | 600 | page title (player, team, matchup name) |
| `title` | 17 / 1.3 | 600 | section titles on long pages |
| `card-title` | 14 / 1.3 | 600 | **every card header**, sentence case |
| `body` | 14 / 1.5 | 400 | paragraphs, primary values in lists |
| `body-sm` | 13 / 1.45 | 400 | tables, dense lists |
| `label` | 12 / 1.35 | 500 | column headers, captions, scope, sample sizes |
| `overline` | 11 / 1.3 | 600, uppercase, +0.04em | chips, small section overlines, units |

Rules:
- **Nothing below 11px outside charts.** Chart ticks and axis labels may use
  **10px**, only inside `components/charts/`.
- **Stat values are sans with tabular figures,** sized by importance (`display`
  for the headline, `body` in tables), never mono. Drop the Plex Mono load, or
  keep it only if Phase G's typeface evaluation picks it (decision 4).
- **Hierarchy by size first,** weight second, uppercase only for `overline`.
- **Mapping from today:** 8/9/9.5/10 → `overline` or `label` (by role); 10.5/11/11.5/12
  → `label`; 12.5/13 → `body-sm`; 14/15 → `body` or `card-title`; 16–20 →
  `title`; 22–28 → `heading`; 44 → `display`.

## 2. Color in use (within charcoal)

### Measured

- 80 distinct text colors rendered; top four are grays: `ink-faint` 41%,
  `ink` 28%, `ink-muted` 18%, a near-black 5%. Semantic green 2%, red 1%.
- **43% of text fails AA** (per page 28–56%, worst on the MLB team page).
  Nearly all of it is `ink-faint` on `card`, about 2.4:1 against the 4.5:1
  minimum.
- `card` (93% lightness) is **darker** than `paper` (96%), so cards sit *below*
  the page, the reverse of what the card shadows assume.
- 130 color literals hardcoded in components, 65 of them in `GameDetail.tsx`.
- Semantic color is applied without direction: "more fouls" and "more saves"
  show as green (Phase F).

### Proposed rules

| role | token | rule |
|---|---|---|
| Primary text | `ink` | values, names, titles |
| Secondary text | `ink-secondary` | supporting values |
| Captions, labels | `ink-muted` | **the lightest gray allowed for text** (passes AA on card) |
| Decoration only | `ink-faint`, `ink-disabled` | dividers, disabled controls, never readable text |
| Better / worse | `good` / `bad` | **only when a stat has a direction**, and the direction is declared per stat (fewer turnovers = good) |
| Volume / share / neutral | single-hue charcoal ramp | target share, shot share, pitch mix, usage: intensity, not judgment |
| Live | `live-*` + pulse | only the live element |
| Heat maps (diverging) | red → neutral gray → green | neutral midpoint, no amber (recorded 2026-08-29) |

- **Fix elevation:** paper darker than card (for example paper 94%, card 98%),
  or flat cards separated by borders. Choose in Phase G by looking.
- **No hardcoded colors in components.** Team colors come from team data; logo
  fallbacks use them.
- **Target:** ≤ 8 text colors on any page, 0 AA failures.

## 3. Spacing and density

### Measured

- Card outer padding is mostly 0 (168 of 200); padding lives on inner elements,
  set per card, so card interiors don't align with each other.
- Card radius: 10px (183), 14px hero (12), 0px (5). Shadows on 12 cards.

### Proposed

- **4px base scale:** 4 · 8 · 12 · 16 · 24 · 32 · 48.
- **Card:** padding 16 (12 in dense tables), header row 44 high, 12 between
  header and body, 12 between body and caption.
- **Page:** 16 gutter at phone width, 24 at desktop; 12 between cards in a
  column; rail 300–320px.
- **Tables:** row 36 (32 dense), numeric columns right-aligned, header `label`.
- **Radius:** 12 for cards, 16 hero, 8 controls, full for chips and avatars.

## 4. Card anatomy and components

### Measured

- **Nine header styles** on 200 cards: `10.5px 700 UPPER` without a bar (57),
  with a bar (39), `12px 600` sentence case (38), `11px 600 UPPER` (34), 16px
  (17), 18px (5), 16px 600 (4), 24px 700 (3), `9.5px UPPER` bar (1).
- Toggle groups: shared `SegmentedToggle` in 7 files; hand-rolled in 12, with 4
  different active styles (`bg-masters text-white shadow-card`,
  `bg-card text-ink shadow-card`, `bg-masters text-white`,
  `border-masters bg-masters text-white`).
- Chips: `Chip` (4 files), `FilterChip` (10 uses), plus `GradeChip`, `OddsChip`,
  `ConfidenceChip` as separate components.
- Tabs: `role="tab"` once; `aria-pressed` 27; `aria-selected` 5.
- Skeletons: 7 files.

### Proposed card anatomy

```
┌──────────────────────────────────────────────────────────────┐
│ Card title (card-title)          [2025 season ▾]  [ⓘ] [⤢]   │  header, 44px
├──────────────────────────────────────────────────────────────┤
│ body: the chart / table / values                             │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ caption (label, ink-muted): sample size · source · as of     │
└──────────────────────────────────────────────────────────────┘
```

- **One header style,** sentence case, no tinted bar. The scope selector sits in
  the header on every stat card (Phase F: scope was unlabeled nearly
  everywhere). `ⓘ` opens a styled tooltip explaining the stat; `⤢` expands to a
  drill-down panel (tier-2 interaction).
- **Built-in states:** loading skeleton shaped like the content; empty state that
  says why ("No 2026 games yet: showing 2025" or "Not tracked for goalkeepers");
  error state with retry, never raw API text (D5).
- **Hero card** keeps its own anatomy: identity, state, key numbers.

### Proposed component inventory

One of each, used everywhere:

| component | replaces |
|---|---|
| `Card` (anatomy above) | 9 header styles, per-card padding |
| `SegmentedToggle` | 12 hand-rolled toggle groups, 4 active styles |
| `Tabs` (real `role="tab"`) | button rows styled as tabs |
| `Chip` (tone × size × shape) | `FilterChip`, `GradeChip`, `OddsChip`, `ConfidenceChip` |
| `Tooltip` (styled, keyboard and touch accessible) | native `title` attributes (97 in source; 1,135 rendered across the 12 probed pages), which never show on touch or keyboard |
| `StatValue` (value, unit, rank, percentile bar, delta, direction) | ad hoc value + rank + bar combinations |
| `DataTable` (sortable, sticky header, numeric alignment) | hand-built tables per card |
| `Avatar` (player photo / team logo / flag, one fallback) | initials circles, crest-as-headshot, blank logos |
| `DrillDownPanel` (side sheet or modal) | navigating away to see detail |
| `SectionNav` (sticky, long pages) | scrolling 16–23 cards |
| `Skeleton`, `EmptyState`, `ErrorState` | per-card loading and empty text |

## 5. Imagery

### Measured

- 1,258 images in cards; 32% inside a link or button.
- Initials instead of photos on 16 captured cards; soccer player heroes show
  the club crest; NHL game logos render blank; tennis flags with overlapping
  name text (Phase E/F).

### Proposed

- **Sizes:** 16 (inline), 20 (tables), 24 (lists), 32 (cards), 48 (matchups), 72
  (hero).
- **Fallback:** silhouette on the team color, never initials.
- **Every photo and logo links** to its player or team page.

## 6. Data-viz styling

### Measured

- 38 charts on the probed pages; `components/charts/` primitives used by 5 files.
- Chart text is 3% of text nodes, and axis ticks render at 8–9px.
- Heat ramps apply good/bad colors to neutral data (Phase F).

### Proposed

- All charts through `components/charts/` (`ChartFrame`, `useChartCrosshair`).
- Ticks 10px, axis labels 11px, one gridline color, a zero line where values go
  negative.
- **Series color:** `ink` for the subject, `ink-muted` for comparison, semantic
  only for better/worse; a line value (prop line) drawn as a dashed reference,
  optional.
- **Every mark hoverable** with a value tooltip; shared crosshair across charts
  showing the same games (see `F2-ux-interaction.md`).

## 7. Motion tokens

### Measured

- 1,661 elements carry Tailwind's default 150ms transition; 703 a 500ms
  transition; a handful at 200/300ms. The `motion` library is imported by 1 file.
  Running animations: pulse (5), spinner (1). Reduced-motion handling appears 10
  times.

### Proposed

| token | duration | easing | use |
|---|---|---|---|
| `instant` | 100ms | standard | hover, press |
| `quick` | 180ms | standard | toggles, tabs, tooltips |
| `smooth` | 280ms | emphasized | expand/collapse, drill-down panels |
| `data` | 450ms | emphasized | chart transitions when scope changes |
| `live` | 400ms tween + 1.2s flash | standard | live values changing |

- `standard` = `cubic-bezier(0.2, 0, 0, 1)`; `emphasized` =
  `cubic-bezier(0.3, 0, 0, 1)`.
- **`prefers-reduced-motion`:** all tokens drop to opacity-only fades, no tweens.
