# Linesmith — Teams List & Team Detail Design Options Brief

You're being asked to propose visual design options for two related pages in Linesmith, a golf/MLB player-props pick-finder app: the **Teams list** page and the **Team Detail** page (MLB only — golf has no team concept, see note below). You cannot see the running app or its source code, so this brief describes the current state in plain English, and the user will attach screenshots of the live pages alongside this prompt — look at those screenshots as the ground truth for exact current layout/spacing, and treat the text below as the explanation of what's *behind* what you're seeing.

**Give options, not a decision.** For every section below, propose 2–3 distinct visual directions and clearly label them (A / B / C). Don't converge on a single "best" answer yourself — the user will pick, mix, or reject after seeing the set. Keep every option inside the locked design system described next; the point of these options is to explore layout/hierarchy/emphasis choices, not to reopen the color or type palette.

Linesmith just finished a full visual-language pass on its **Game Detail** page (a different page, not in scope here) and locked in a token system as a result. Every other page — these two included — is being brought up to that same standard using the exact same tokens, so the whole app reads as one system instead of a patchwork. Nothing below is optional or up for reinterpretation.

Worth knowing up front: these two pages are already the **most internally consistent** in the app — no hardcoded hex colors, no stray monospace type, everything already routes through the shared card/chip/token system. This brief isn't fixing token violations here (there aren't real ones); it's about layout rhythm and visual hierarchy, which is genuinely underdeveloped.

---

## Design system — already locked, do not deviate

**Palette**
- Brand: Masters green `#0d4630` (buttons, nav, active/selected states — app chrome, stays fixed)
- Accent: `#7FC49B`, soft accent tint `#e6efe8`
- Semantic data-quality colors (deliberately more saturated than the brand green so they read as a distinct signal): good `#0f7a4f`, warn `#c98a1f`, bad `#c23b2c`
- Backgrounds: page `#f7f5f0`, card `#FFFFFF`, subtle inset surfaces `#fbfaf7` / `#faf8f4`
- Text hierarchy (six steps, pick from this list — don't invent new grays): `#1c1a17` → `#4b463e` → `#6d675e` → `#8a857c` → `#a8a29a` → `#c2bcb2`
- Borders: `#e6e2d8` standard, `#efece4` and `#f4f1ea` for progressively lighter in-card dividers
- No dark theme. No sportsbook branding, logos, or promotional units anywhere.

**Type — 10 steps, nothing outside this list**
9 / 10 / 11 / 12 / 13 / 14 / 16 / 20 / 28 / 44px. The two largest sizes are reserved for the one anchor number a card is allowed to have. Sans-serif everywhere — no monospace font anywhere in the product. All numeric values use tabular (fixed-width) figures so they align in columns.

**Cards**
- Default card: 10px rounded corners, 1px border, white background, **no shadow** — this is what every section on both pages uses today, correctly.
- Hero card: reserved for exactly **one** hero/live element per page. Neither page has one today — whether Team Detail's header deserves one is one of your design questions below.
- Interactive card: any genuinely tappable card should lift with a soft green-tinted shadow on hover/press. Both the team-list rows and roster rows are tappable/selectable today and don't use this yet.
- All shadows are green-tinted (never neutral grey).

**Chips/badges**
One shared component, two shapes: `pill` (rounded-full, most things) or `box` (rounded-md, reserved for price/odds values). Tones: neutral (light gray), good/warn/bad (tinted bg + matching text off the semantic palette), or masters (solid green fill, white text, sparingly, for the one primary action). Any chip you propose should be describable as one of these — the roster list already uses this correctly for position badges; the season/advanced stat tiles use a hand-rolled bordered box instead of a chip, which is a small inconsistency worth resolving.

**Heat ramp**
Every percentage-driven number reads off one continuous red→amber→green ramp. There's a vivid "fill" version for bars/badges and a darkened "ink" version for text-on-white. The confidence badge (letter grade + %) is a fixed shared component. Note: the recent-games table on Team Detail currently marks hit/miss with only a colored checkmark/x-mark, not a heat-mapped background — consider whether it should adopt the ramp for consistency with Scan's row view and Player Detail's gamelog.

**Hard no's**: no new colors outside the palette, no monospace type, no more than one hero card per page, no dark mode, no sportsbook logos.

---

## Current state of Teams / Team Detail

Both pages share one shell: sticky top bar, a horizontal "games today" strip, then — at desktop width (`lg` breakpoint) — a two-column layout: a 260px sticky team list on the left, detail content filling the right and scrolling independently. Below that breakpoint it presumably collapses to one stacked column (list above detail) — not visually confirmed, worth checking in your screenshots.

**Team list (left column / Teams page)**: a searchable, scrollable list of all 30 teams — small logo, name, division, W-L record per row. The active team gets a soft tint background and bold accent-colored text. Selecting swaps the detail pane client-side.

**Team Detail (right column)**, top to bottom:
1. Header card — logo, name, record. Plain bordered card, no elevation, no accent treatment — a compact banner, not a focal point.
2. Market tabs (Moneyline / Total / team props) — plain text tabs with a bottom-border underline on the active one, sitting directly on the page background with no card wrapper.
3. Line stepper / odds control bar — small bordered pill, +/- buttons (gray, turn green on hover), tabular price value.
4. Scope filter chips (All/Home/Away/vs-opponent, L5/L10/L15/Season) — also sits directly on the page background, no card wrapper.
5. Five window stat tiles (L5/L10/L15/H2H/SZN) — same shared component used on Player Detail, reused here.
6. Recent-games table — dense 11px text, thin row dividers, no zebra striping, opponent logo inline, hit/miss shown only as a colored checkmark/x (no heat-mapped background).
7. Season team stats card (shown only if the team plays today) and an Advanced/Statcast stats card — both use a hand-rolled `rounded-md border bg-card` box per stat rather than the shared chip; tiny (9-10px) uppercase labels, bold tabular values.
8. Roster — two-column grid of rows, circular avatar, name, a proper `.lb-chip` position badge, and for ranked batters a second accent-colored chip showing quality-of-contact rank. Correctly on-system.
9. Full AL/NL standings tables, one per division, inside card wrappers with a light gray division-header bar; subtle row hover; the current team's row gets a soft accent tint and bold accent-colored name — the one deliberately "highlighted" moment on the page, and it's tasteful.

**The core problem across both pages isn't tokens, it's rhythm**: the page alternates between fully-carded sections (header, stats, roster, standings) and bare sections sitting directly on the page background (market tabs, filter chips) with no obvious pattern to which is which. Nothing on the page reads as a focal point — everything sits at similar low-key visual weight, so it's a long scroll of many same-weight boxes rather than a page with a clear reading order. The team-list sidebar's "selected" treatment (soft-tint block) and the detail pane's tab "selected" treatment (underline) are two different visual languages for the same concept.

---

## What to design options for

1. **Header card** — decide whether Team Detail's header should become the page's hero element (larger crest/logo, elevated card, maybe absorbing the market tabs or line stepper into it) or stay a compact banner matching the section below it.
2. **Card-vs-bare rhythm** — propose 2–3 consistent rules for which sections get a card wrapper and which sit on the bare background (e.g., "every distinct data section is carded, only navigational controls like tabs/filters stay bare" — or the opposite). Apply the rule consistently across the whole page, not just to individual sections.
3. **Recent-games table** — propose whether hit/miss should move from checkmark-only to a heat-mapped cell background (matching Scan's row view and Player Detail's gamelog), and if so, how.
4. **Season/Advanced stat tiles** — replace the hand-rolled bordered boxes with a proper chip-based or window-tile treatment (reusing the pattern already established for L5/L10/L15/H2H/SZN, or a new option if you think stat tiles need a distinct look from window tiles specifically).
5. **Selection-state consistency** — propose a single visual language for "this is selected/active" that could apply to both the team-list row and the detail-pane tabs, rather than two different conventions.
6. **Page-level focal point / reading order** — given the long single-column scroll of many same-weight cards, propose 2–3 ideas for introducing *some* hierarchy (bigger header, a pulled-forward key stat, section dividers, whatever) so the page doesn't read as an undifferentiated list of boxes. This can overlap with option 1.

## What NOT to touch

- Don't redesign the roster chips or the standings-table highlight treatment — both are already correct and tasteful as-is.
- Don't redesign the five window stat tiles — shared component with Player Detail, must stay identical.
- Don't propose a golf equivalent of these pages — golf has no team concept; there is no `app/golf/team` or `app/golf/teams` route and none is planned. Design MLB only.
- Don't change the two-column desktop / stacked-mobile structural approach itself (list beside detail vs. list above detail) — that split is out of scope; focus on what's inside each column.

## Screenshots to attach

Please attach: (1) Teams list page, desktop width, showing the list + a selected team's detail pane; (2) Teams list page, mobile width; (3) Team Detail header + market tabs + filter chips cropped together; (4) the recent-games table cropped; (5) the season/advanced stat tiles cropped; (6) the roster section cropped; (7) the standings tables cropped, ideally showing the current-team highlight.

## Deliverable format

For each of the six numbered sections above, present labeled options (A/B/C) with a short description of the visual/structural idea behind each. For option 2 (card-vs-bare rhythm) and option 6 (focal point), be explicit about how the rule/idea applies section-by-section down the whole page — these two are meant to be evaluated as a coherent whole-page proposal, not just a component swap.
