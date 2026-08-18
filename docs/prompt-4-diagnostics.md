# Linesmith — Diagnostics Page Design Options Brief

You're being asked to propose visual design options for the **Diagnostics** page of Linesmith, a golf/MLB player-props pick-finder app. This is an internal status/monitoring page (API health, scraper status, model calibration, pick history) — not a page most end users see regularly, but it should still feel like part of the same product rather than a bare dev tool. You cannot see the running app or its source code, so this brief describes the current state in plain English, and the user will attach screenshots of the live page alongside this prompt — look at those screenshots as the ground truth for exact current layout/spacing, and treat the text below as the explanation of what's *behind* what you're seeing.

**Give options, not a decision.** For every section below, propose 2–3 distinct visual directions and clearly label them (A / B / C). Don't converge on a single "best" answer yourself — the user will pick, mix, or reject after seeing the set. Keep every option inside the locked design system described next; the point of these options is to explore layout/hierarchy/emphasis choices, not to reopen the color or type palette.

Linesmith just finished a full visual-language pass on its **Game Detail** page (a different page, not in scope here) and locked in a token system as a result. Every other page — this one included — is being brought up to that same standard using the exact same tokens. This page is likely the least "designed" surface in the app today (it's the most utilitarian, table-and-numbers-heavy page in the product), so there's real room here, but it must still stay inside the locked system below — this is a visual-hierarchy and polish pass, not a license to invent a separate "admin panel" style.

---

## Design system — already locked, do not deviate

**Palette**
- Brand: Masters green `#0d4630` (buttons, nav, active states — app chrome, stays fixed)
- Accent: `#7FC49B`, soft accent tint `#e6efe8`
- Semantic data-quality colors (deliberately more saturated than the brand green so they read as a distinct signal): good `#0f7a4f`, warn `#c98a1f`, bad `#c23b2c`
- Backgrounds: page `#f7f5f0`, card `#FFFFFF`, subtle inset surfaces `#fbfaf7` / `#faf8f4`
- Text hierarchy (six steps, pick from this list — don't invent new grays): `#1c1a17` → `#4b463e` → `#6d675e` → `#8a857c` → `#a8a29a` → `#c2bcb2`
- Borders: `#e6e2d8` standard, `#efece4` and `#f4f1ea` for progressively lighter in-card dividers
- No dark theme. No sportsbook branding, logos, or promotional units anywhere.

**Type — 10 steps, nothing outside this list**
9 / 10 / 11 / 12 / 13 / 14 / 16 / 20 / 28 / 44px. The two largest sizes are reserved for the one anchor number a card is allowed to have. Sans-serif everywhere — no monospace font anywhere in the product (notable since this page prints raw environment-variable names and raw data dumps — the temptation to reach for a mono/code font here should be resisted; keep it sans, use the chip/table system instead to signal "this is technical data"). All numeric values use tabular (fixed-width) figures.

**Cards**
- Default card: 10px rounded corners, 1px border, white background, **no shadow** — every section on this page already correctly uses this.
- Hero card: reserved for exactly **one** hero/live element per page. This page has zero visual "peak" today — every one of its ~15 sections carries equal, low visual weight. Whether the Status Overview section deserves the hero treatment (since it's the one thing a user checks first) is one of your design questions below.
- Interactive card: genuinely tappable/expandable elements (the collapsed Debug drawer, filterable ranking tables) should lift on hover/press. Unused on this page today.
- All shadows are green-tinted (never neutral grey).

**Chips/badges**
One shared component, two shapes: `pill` (rounded-full, most things) or `box` (rounded-md, reserved for price/odds values). Tones: neutral (light gray), good/warn/bad (tinted bg + matching text off the semantic palette), or masters (solid green fill, white text, sparingly). Status pills on this page already use the shared chip correctly.

**Heat ramp**
Every percentage-driven number reads off one continuous red→amber→green ramp. Pick History already does this correctly — each pick's confidence badge (letter grade + %) uses the exact same shared `heatFill` ramp as every other confidence surface in the app (Scan, Player Detail). Don't change how Pick History's confidence badges work; they're the one part of this page already fully on-system.

**Hard no's**: no new colors outside the palette, no monospace type anywhere (including for the env-var/debug dumps), no more than one hero card per page, no dark mode, no sportsbook logos.

---

## Current state of the Diagnostics page

A single scrolling column (roughly 672px max width, centered) under a sticky header: page title, subtitle, a "Rescan now" button, and a row of jump-links (Picks / Model Health / Data Sources / Debug). Below that, roughly 15 stacked sections in order: Status Overview (health dots for Odds API, harvester, merged line counts, live data, MLB Stats API, active models, recent errors) · Pitcher Rankings (searchable/filterable stat table) · Batter Rankings (same pattern) · **Pick History** (past picks, win/loss record, confidence/stake info, plus a "Pick Record Analysis" sub-block with tier win-rate bars and Kelly ROI) · Player Prop Providers (status table + an "Unresolved" raw-value table) · Model Calibration (reliability diagram bars) · Model Versions/weights · Live Drift Check · Elo Ratings · Game Model Calibration · Data Sources & System (API errors, pipeline freshness, DB row counts, recent system events) · OddsHarvester scraper file status · a collapsed **Debug** drawer (raw Odds API lines, raw Harvester lines, an environment-variable dump).

Structurally every section correctly uses the shared white bordered card, no hardcoded colors, no stray monospace — the token discipline is actually fine. The problem is entirely visual hierarchy and polish:

- **It's dominated by literal HTML tables**: thin border-bottom rows, 11–12px text, closer to a spreadsheet than a branded UI screen.
- **The Debug drawer is a raw dump**: a table of raw odds-line objects, a table of raw harvester-line objects, and an environment panel printing literal variable names (`ODDS_API_KEY`, `ODDS_API_TTL_MINUTES`, `ODDS_API_RESERVE`, `NODE_ENV`) with plain ✓/✗ text characters instead of any icon or chip treatment.
- **No empty-state or loading polish**: empty/loading states are bare gray sentences ("Loading…", "No lines from Odds API.") with no illustration or structured placeholder.
- **Controls are minimal**: filters, date pickers, and buttons are plain bordered rectangles with no hover elevation.
- **Uniform rhythm, no peak**: every section — from the health overview a user actually needs at a glance, down to a raw env-var dump nobody needs to see by default — carries identical visual weight. The header's "Rescan now" button is the only element on the entire page with real color and shadow; everything else is white/gray/bordered, so the page reads overwhelmingly monochrome.
- **Pick History is the one section already polished** (confidence chips off the shared heat ramp, good/bad tokens for win/loss) — treat it as a reference for what "this page done well" looks like, and a candidate to extend that treatment outward to neighboring sections rather than redesign itself.

---

## What to design options for

1. **Status Overview as the page's focal point** — propose 2–3 treatments for turning this into the thing a user's eye lands on first (bigger health indicators, a summary strip, maybe a hero treatment), given it's the one section people actually check regularly versus scrolling to the bottom for a debug dump.
2. **Table-heavy sections (Rankings, Provider status, Data Sources)** — propose ways to make dense data tables feel less spreadsheet-like within the constraints (still sans-serif, still tabular-nums, still the 10-step type scale) — row spacing, subtle zebra/hover treatment, better use of the chip system for status values instead of plain text.
3. **The Debug drawer** — this is the page's rawest, most dev-tool section. Propose 2–3 ways to present raw data (JSON-ish objects, env var flags) in a way that still feels designed rather than dumped — without adding a monospace font. Consider whether ✓/✗ text should become chips, whether the env-var list needs a different layout than a plain table.
4. **Section-to-section visual rhythm** — given ~15 sections of identical weight today, propose a system (bigger section headers with icons, subtle background tinting on alternating sections, grouping into visually distinct zones for "health," "rankings," "pick performance," "raw/debug") so a user scanning the page gets a sense of priority without reading every label.
5. **Empty/loading states** — propose a more polished version of the bare "Loading…" / "No data" text sentences, consistent with the skeleton-loading pattern used elsewhere in the app (Scan, Player Detail already use shimmering skeleton placeholders — this page currently doesn't).

## What NOT to touch

- Don't change Pick History's confidence-chip or win/loss-token treatment — it's already correct and is the reference point for the rest of this pass.
- Don't remove any data or section — this is a monitoring page and every metric shown serves a real diagnostic purpose; you're proposing presentation, not information architecture cuts.
- Don't introduce a monospace/code font for the debug data, no matter how tempting it is for "raw data" sections — stay inside the sans-only rule.
- Don't propose restructuring the jump-link navigation at the top unless a specific option genuinely requires it — it's functional as-is.

## Screenshots to attach

Please attach: (1) the full page from the top through Status Overview and into Pitcher/Batter Rankings; (2) Pick History section including the tier win-rate/Kelly ROI sub-block; (3) Model Calibration / Elo / Game Model Calibration sections; (4) Data Sources & System section; (5) the Debug drawer expanded, including the environment-variable panel; (6) a loading state if you can catch one.

## Deliverable format

For each of the five numbered sections above, present labeled options (A/B/C) with a short description of the visual/structural idea behind each. For option 4 (section-to-section rhythm), describe how the proposed system would apply across all ~15 sections at a high level (which sections group together under your scheme), not just one example section.
