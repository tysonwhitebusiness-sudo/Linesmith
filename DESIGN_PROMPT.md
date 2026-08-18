# Linesmith — Premium Design Pass + Live Odds System

Incremental update to the existing `linesmith` project. Scope: the current UI reads as flat and utilitarian. This update translates specific structural patterns observed in Linemate and PickFinder — two established pick-finder products — into Linesmith's existing Masters green/white design system. This is inspiration for structure and information density, not a visual clone: do not copy their color palette, logos, exact copy, or brand identity. Keep the Masters green (`#0B5D3B`), lighter green accent (`#7FC49B`), white/off-white backgrounds already defined in the master prompt.

**This update also includes a newly built live odds system** (see Appendix A for the full API contract). The odds panel now merges two data sources — the-odds-api.com (best-line summaries) and OddsHarvester (per-bookmaker detail + live scores from OddsPortal.com). Design the odds display using the same premium patterns described below.

If Playwright MCP is already connected from the earlier update, revisit linemate.io and pickfinder.app directly to study these patterns in more detail before implementing — the notes below are a starting brief, not exhaustive.

---

## Patterns to adopt (structure, not skin)

### 1. Heat-map coloring on hit-rate/consistency data, not flat badges.

Both sites color-code percentage-based stats on a red → yellow → green gradient based on strength (a 90% hit rate is saturated green, 50% is neutral/yellow, 30% is red), rather than using a single flat accent color regardless of magnitude. Linesmith's consistency scan currently uses one green tone for all "birdie+" hits regardless of how strong the streak is. Apply a proper gradient scale instead — e.g. a 3-round 100% streak reads as deep green, while a softer trend (like the "Running hot/cold" view's rolling score) scales in saturation with strength, not just direction. This should touch: scan card badges, the hole-difficulty proportion bars on the Course tab, and hit-rate-style displays anywhere a percentage drives the visual.

**Odds application:** Odds values themselves should use a subtle green-to-red gradient in the per-bookmaker comparison view — better odds (higher for underdogs, less negative for favorites) lean green, worse odds lean red, giving users an instant "where's the best price" signal at a glance. The scale: saturated Masters green for the best available price, fading through neutral to a muted red for the worst price among displayed bookmakers. Apply only to the per-bookmaker dropdown rows, not the headline best-line number.

### 2. Micro visualizations inline, not just numbers or chip lists.

Both sites use compact inline bar charts (recent-games-style sparkline bars, colored by outcome) directly inside a row or card, rather than relying purely on text chips. Linesmith's "last 6 holes" chip row and the player-card scorecard grid are the right places to add a compact bar-chart view as an alternative or supplement — e.g. a small inline bar chart on the Player tab showing relative-to-par by hole across the week, color-coded green/red, similar in spirit to the bar chart pattern shown in both inspiration sites' player detail views. This is a genuinely useful upgrade for golf and translates directly to MLB (bar chart of hits/at-bats over recent games).

**Odds application:** The per-bookmaker odds dropdown (currently a plain `<details>` grid of text) should include a compact horizontal bar per bookmaker showing the implied probability spread — a thin bar split green (home side) and neutral (away side) proportional to the odds, so the user can visually compare how different books see the matchup. A wider green segment = that book favors the home team more. This is a micro visualization, not a full chart — think a 60px-wide segmented bar, not a Plotly widget.

### 3. Denser, multi-column stat rows on list views.

Linemate's cheatsheet lists and PickFinder's props table pack several derived stats into one compact row (recent form %, head-to-head %, situational split %, side-by-side) rather than one stat per card. Linesmith's Scan cards currently show one dimension per card. Consider a denser row-based alternative view (toggleable, not replacing the card view) for power users who want to scan many candidates at once — columns like: subject, dimension, L5/L10/L15-equivalent (last 5/10/15 periods), streak length, live status — mirroring the structure of PickFinder's props table without copying its exact columns or styling.

**Odds application:** The dense list view should include odds columns: best moneyline, best total, and a compact "books" column showing a mini version of the per-bookmaker spread. When live scores are available (MLB only), a "Live" column with the abbreviated score (e.g. "3-5 B7") should appear. The Context tab's game cards should also get a dense-row option that shows all games in a compact table with columns: matchup, state, moneyline, total, live score, books — replacing the current stacked card layout when toggled.

### 4. Structured player/matchup detail pages with a persistent side panel.

PickFinder's player page keeps win-probability/matchup context in a fixed side panel while the main content (chart, game log) is browsable underneath. Linesmith's Player tab could adopt a similar two-zone layout on wider viewports (tablet/desktop, since Claude Code should design mobile-first but not mobile-only): scorecard/chart as the main scrollable content, with course history, season stats, and live position pinned in a side panel rather than all stacked in one long column. On mobile, this collapses back to the current stacked layout — don't sacrifice the mobile experience for a desktop-only pattern.

**Odds application:** For MLB, the side panel should include a compact "Today's Line" section showing the game odds for the selected player's matchup — moneyline, total, and best book — so the user sees both the player's props and the game context in one view without switching tabs. This is the key integration point: the Player tab currently shows only historical performance; adding game odds as a side-panel element connects "what has happened" to "what the market thinks will happen."

### 5. Filter bar as a compact icon-labeled row.

Both sites present filters (Modifier, Stats, Games, Date, Teams, Odds range) as a single horizontal row of compact dropdown buttons with small icons, rather than stacked full-width selects. Linesmith's filter panels currently stack selects in rows of two. Tighten this into a single scrollable row of compact filter chips/buttons with icons, consistent with the existing pillrow pattern already used for mode-switching — extend that same visual language to filters instead of introducing a second UI convention.

**Odds application:** Add a "Bookmaker" filter chip that lets the user pick which bookmaker's lines to display as the primary reference (default: "Best available"). When a specific bookmaker is selected, the headline moneyline/total numbers switch to that book's values, and the per-bookmaker dropdown highlights the selected book. Also add a "Source" filter chip — "All", "the-odds-api", "OddsPortal" — controlling which data source the display draws from.

### 6. Elevation and depth, not just borders.

Both sites use subtle shadows and layered elevation to distinguish interactive cards from background, rather than relying solely on a 1px border. Add a subtle box-shadow to cards (`0 1px 3px rgba(11,93,59,0.06)` or similar, tuned to the green-tinted palette rather than generic grey) and a slightly stronger shadow/lift on hover or active states, so cards read as tappable surfaces rather than flat rectangles.

**Odds application:** The live score bar (when present) should have a subtle inner glow or elevated treatment that distinguishes it from the static odds text below — it's the only piece of real-time data on the page and the visual treatment should reflect that it's "live." The per-bookmaker dropdown should lift slightly when expanded.

### 7. Numbers as the visual anchor.

Both sites make key numeric values (hit rate %, odds, streak length) large and bold with muted small-caps labels beneath — the number is the first thing the eye lands on, not the label. Audit Linesmith's stat displays (player card stat grid, hole scoring averages, streak totals) and confirm the numeric value is consistently the dominant visual weight, label secondary.

**Odds application:** American odds values (`+130`, `-150`) should be the dominant visual element in the game card — larger and bolder than team names or market labels. The live score numbers (`3 – 5`) should be the largest text in the live score bar. The bookmaker count ("8 books") should be prominent enough to scan at a glance.

### 8. Skeleton loading states, not bare text.

The current Scan view shows a plain "Loading…" string with no shape underneath it, so the layout jumps once data arrives. Both inspiration sites use skeleton placeholders — greyed-out card/row shapes matching the eventual content's dimensions — during load. Add a skeleton variant of ScanCard (and the equivalent for Course/Player views) shown during the initial fetch and on manual refresh, sized and spaced identically to the real card so nothing shifts when content pops in.

**Odds application:** The game cards in the Context tab should show skeleton placeholders during the initial odds fetch — greyed-out rectangles for the moneyline, total, and bookmaker count, matching the eventual text dimensions. The live score bar placeholder should be a slightly taller rectangle to account for its extra height. Since the odds fetch is separate from the snapshot fetch, the game cards may render with team names and starters visible while the odds section below is still loading — design the skeleton to fill only the odds portion, not the entire card.

---

## Live odds system — design requirements

### Two modes: pre-game and live

**Pre-game mode** (no `liveScore` / `livePeriod`):
- Show: moneyline, total, spread (best available), bookmaker count
- Source label: "the-odds-api" or "OddsPortal" or "the-odds-api + OddsPortal"
- Per-bookmaker dropdown available when `bookmakers.length > 0`
- Timestamp of last fetch, next refresh time, credit count if applicable

**Live mode** (`liveScore` and `livePeriod` present):
- All of the above, PLUS:
- A live score bar at the top with a pulsing indicator dot
- Score displayed as "AWAY – HOME" with large tabular numbers
- Period marker ("Top 3rd", "Bottom 7th", etc.)
- The pulsing dot should NOT appear when the period contains "Finished", "Final", "Full-time", or "FT"

### Per-bookmaker comparison view

The expandable bookmaker section should show:
- Each bookmaker name with their moneyline prices, converted from decimal to American for display
- A subtle green-to-red gradient on each price relative to the best available — best price gets saturated green, worst gets muted red
- A compact implied-probability bar (split green/neutral) showing how each book sees the matchup
- Bookmaker count as the summary label: "8 bookmakers"

### Degraded states (each needs a distinct UI treatment)

| State | UI treatment |
|---|---|
| Both sources active | Full display with dual-source label, live score bar if in-play |
| Only the-odds-api | No live score, no bookmaker dropdown, source label "the-odds-api". Identical to pre-OddsHarvester behavior. |
| Only OddsHarvester | Live score bar if in-play, bookmaker dropdown present, source label "OddsPortal", moneyline computed from best decimal odds |
| Both disabled | Muted message "Game lines are disabled" with warning text |
| Cached data | "(cached)" label next to timestamp |
| Low credits | Amber warning: "Only 47 Odds API credits left this month." |
| Credits exhausted | Auto-refresh stopped; message: "Only 25 credits remain — lines are no longer auto-refreshing. Showing the last fetch." |
| Stale scraper JSON | Show stale data with muted timestamp, never hide it |
| Scraper JSON empty (0 matches) | Fall back to the-odds-api only, no live elements |

### Odds-specific skeleton loading

- During odds fetch, game cards render team names + starters immediately
- The odds section below shows greyed-out placeholder rectangles matching the final layout
- Live score bar placeholder is slightly taller to account for its extra height
- Bookmaker count placeholder is a short rectangle

---

## What NOT to carry over

- No dark theme — Linesmith's light Masters green/white identity was a deliberate choice and stays. A theme toggle for optional dark mode is fine as a stretch addition, but light stays default.
- No sportsbook branding, logos, or promotional units (both sites embed affiliate sportsbook ads — Linesmith has no such feature and shouldn't get one). Bookmaker names in the per-bookmaker view are plain text, not logos.
- No copied iconography, wordmarks, or exact color values from either site.
- No literal feature-for-feature clone (e.g. don't build a "Discrepancies" page just because PickFinder has one) — evaluate each pattern on whether it actually serves Linesmith's own scope (golf + MLB pick-finding) before adopting it.

---

## Suggested sequencing

1. **Heat-map color scale** (touches the most surface area, establishes the visual language for everything else — including the per-bookmaker odds gradient)
2. **Elevation/shadow pass + tightened filter row + skeleton loading states** (quick wins, high visual impact relative to effort — add the odds-specific skeletons and live score bar elevation in this pass)
3. **Live odds integration pass** — implement the full live score bar, per-bookmaker comparison view with implied-probability bars, source labels, and all degraded states described above. This is net-new UI built on the design language established in steps 1-2.
4. **Inline micro bar charts on Player tab** (add the game-odds side panel element for MLB here)
5. **Dense list-view alternative for Scan** (include the odds columns in the dense-row toggle for Context tab games)
6. **Two-zone Player tab layout for wider viewports** (desktop-only enhancement, lowest priority — include the game-odds side panel here)

---

## Appendix A: Live Odds API Contract

The odds data is served from `GET /api/odds/lines?sport=mlb`. See `lib/odds/types.ts` for the canonical TypeScript types. Below is the runtime contract the UI must handle:

### Response envelope

```typescript
interface LinesResponse {
  enabled: boolean;           // false = nothing works, show disabled message
  lines: UnifiedGameLine[];   // one per game
  fetchedAt: string | null;   // ISO timestamp of newest source
  fromCache: boolean;         // true = the-odds-api served from SQLite cache
  sources: {
    oddsApi: {
      enabled: boolean;
      fetchedAt: string | null;
      requestsRemaining: number | null;  // null = unknown or disabled
    };
    oddsHarvester: {
      enabled: boolean;       // true when JSON file existed and was parsed
      fetchedAt: string | null;
      matches: number;        // live matches in the scraper output (0 = no games in play)
    };
  };
  nextRefreshAt: string | null;  // ISO timestamp
  warnings: string[];            // non-fatal issues, show inline
}
```

### Per-game line

```typescript
interface UnifiedGameLine {
  eventId: string;
  commenceTime: string;      // ISO
  homeTeam: string;          // "New York Yankees"
  awayTeam: string;          // "Boston Red Sox"

  // Best available (American odds — ready to display as-is)
  moneyline?: { home?: number; away?: number; book?: string };
  spread?: { homePoint?: number; homePrice?: number; awayPoint?: number; awayPrice?: number; book?: string };
  total?: { point?: number; overPrice?: number; underPrice?: number; book?: string };

  // Per-bookmaker breakdown (DECIMAL odds — must convert before display!)
  bookmakers: Array<{
    bookmaker: string;       // "DraftKings", "BetMGM", etc.
    homeOdds?: number;       // DECIMAL, e.g. 1.91
    awayOdds?: number;       // DECIMAL
    overPrice?: number;
    underPrice?: number;
    point?: number;
  }>;

  // Live in-play (present only when scraper captured live data)
  livePeriod?: string;       // "Top 3rd", "Bottom 7th", sport-specific
  liveScore?: { home: string; away: string };  // strings, not numbers — can be "—" or "NP"

  // Metadata
  bookCount: number;         // total distinct books across all sources
  source: 'odds-api' | 'oddsharvester' | 'both';
}
```

### Critical display rules

1. **`bookmakers[].homeOdds` and `bookmakers[].awayOdds` are DECIMAL odds.** Convert before display:
   - `decimal >= 2` → `Math.round((decimal - 1) * 100)` → e.g. `1.91` → `-110`
   - `decimal < 2` → `Math.round(-100 / (decimal - 1))` → e.g. `3.50` → `+250`
   - The top-level `moneyline.home`/`moneyline.away` are already American — display directly.

2. **`liveScore` values are strings, not numbers.** OddsPortal can show `"—"` or `"NP"` (not posted). Always render as strings, never `parseInt()`.

3. **`livePeriod` is sport-specific and should be rendered verbatim.** Baseball: `"Top 3rd"`, `"Bottom 7th"`. Football: `"4'"`, `"Half-time"`. Tennis: `"1st Set"`. Don't parse, abbreviate, or transform.

4. **Pulsing live dot logic:** Show only when `livePeriod` exists AND does not match `/finished|final|full.time|ft/i`. Check: `line.livePeriod && !/finished|final|full.time|ft/i.test(line.livePeriod)`.

5. **`bookCount` vs `bookmakers.length`:** These can differ — `bookCount` includes books from both sources, `bookmakers.length` is only OddsHarvester's count. Use `bookCount` for the headline, `bookmakers.length` for the dropdown label.

6. **No polling in the UI.** The `useSnapshot` hook re-fetches every 3 minutes and on focus. The odds endpoint is called inside that cycle. Do not add a separate odds poll.

### Files to reference during implementation

| File | What it contains |
|---|---|
| `lib/odds/types.ts` | All TypeScript types — import these directly |
| `components/Panels.tsx` | `GameLineRow` + `ContextPanel` — the current odds UI, refactor this |
| `components/AppShell.tsx` | Tab layout, scan views — odds-adjacent layout |
| `components/ScanCard.tsx` | Card component — skeleton variant goes alongside this |
| `app/api/odds/lines/route.ts` | The API endpoint — add query params here if needed |
| `lib/odds/merge.ts` | Merge logic — if you need to change how sources combine |
| `lib/odds/oddsHarvester.ts` | JSON reader — if you need to change the filesystem contract |
