# Linesmith — Scan Page Design Options Brief

You're being asked to propose visual design options for the **Scan** page of Linesmith, a golf/MLB player-props pick-finder app. You cannot see the running app or its source code, so this brief describes the current state in plain English, and the user will attach screenshots of the live page alongside this prompt — look at those screenshots as the ground truth for exact current layout/spacing, and treat the text below as the explanation of what's *behind* what you're seeing (what's a token, what's hardcoded, what's dead code, etc.).

**Give options, not a decision.** For every section below, propose 2–3 distinct visual directions and clearly label them (A / B / C). Don't converge on a single "best" answer yourself — the user will pick, mix, or reject after seeing the set. Keep every option inside the locked design system described next; the point of these options is to explore layout/hierarchy/emphasis choices, not to reopen the color or type palette.

Linesmith just finished a full visual-language pass on its **Game Detail** page (a different page, not in scope here) and locked in a token system as a result. Every other page — starting with this one — is being brought up to that same standard using the exact same tokens, so that the whole app reads as one system instead of a patchwork. Nothing below is optional or up for reinterpretation.

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
- Default card: 10px rounded corners, 1px border, white background, **no shadow** — a card in a list reads fine on a border alone.
- Hero card: reserved for exactly **one** hero/live element per page (Game Detail uses this for its top card; nothing on Scan currently qualifies — don't introduce one here unless you have a strong specific reason, and flag it explicitly if you do).
- Interactive card: any card you can genuinely tap/click should lift with a soft green-tinted shadow on hover/press, so it reads as tappable rather than flat. This exists in the system already but is under-used on Scan today — a good candidate for one of your options.
- All shadows are green-tinted (never neutral grey — grey-on-warm-paper reads as dirt, not depth).

**Chips/badges**
One shared component, two shapes: `pill` (rounded-full, most things) or `box` (rounded-md, reserved for price/odds values). Tones: neutral (light gray), good/warn/bad (tinted bg + matching text off the semantic palette), or masters (solid green fill, white text, used sparingly for the one primary action). Any chip you propose should be describable as one of these, not a new one-off recipe.

**Heat ramp**
Every percentage-driven number (hit rate, confidence, odds comparison) reads off one continuous red→amber→green ramp — a given color always means the same strength everywhere in the app. There's a vivid "fill" version for bars/badges and a darkened "ink" version for text-on-white. The confidence badge (letter grade + %, e.g. "B+ · 78%") is a fixed component and should look identical everywhere it's used.

**Hard no's**: no new colors outside the palette, no monospace type, no more than one hero card per page, no dark mode, no sportsbook logos.

---

## Current state of the Scan page

Scan has three layers of view-switching, all in a header area above the list:
- **Players vs. Games** — a segmented two-button pill toggles between the player-props list and a simple one-card-per-matchup Games view (moneyline/total + model edge badge).
- **Card view vs. Row view** — two icon buttons swap between a stacked list of full player cards and a dense, wide, sortable table.
- **Filter layout: button row vs. sidebar** — a toggle switches the same filter state between a horizontal scrolling pill row and a left-hand collapsible accordion sidebar.
- A text-tab strip (Good Bets / All / Coming up / Watchlist / Home Runs) further slices the list.

**Player cards** (card view): a bordered white card, no shadow currently, that lifts on hover. Top row has a small team-logo/position pill and a status pill (gray "Complete," green-tinted "Not started," amber "Position unknown," or solid green if a game is imminent). Body splits into a fixed left column — avatar, name, muted subtext, a bold green market-line sentence, a circular score badge, and a glowing gradient box with a large percentage and a thin progress bar — and a flexible right column: a horizontal bar-chart strip of recent games (tiny team logos) above a clickable list of stat rows, the selected row getting a soft green highlight. Two full-width buttons close the card: solid green "Add to slip," outlined "Watch."

**Row view (dense table)**: one bordered card holding a scrollable table, sticky header, sticky first column, small (12px) tabular text throughout. Some columns (L5/L10/L15, H2H, Streak, Season, Diff) get a strong full-bleed color-washed background plus a mini progress bar — the heat ramp applied well. But adjacent columns (Odds, Implied Probability, Model %, DVP) are currently plain gray text with no background treatment at all, so the row visually splits into "loud, colorful" cells next to "flat, unstyled" cells with no clear logic for which gets emphasis.

**Score badge**: a small filled circle, continuously color-ramped red→amber→green by score, with a bold letter grade and percentage inside plus a caption underneath — this one is well-integrated and reused identically across the page.

**Filter pills/sidebar**: uniform rounded pills, white/bordered when inactive, green-tinted fill + green border/text when active. The sidebar variant reuses the same dropdown/checkbox pieces stacked vertically behind accordion headers — functionally consistent, but visually reads more like a plain settings panel than the livelier pill row above it.

**Games/date strip**: a thin sub-bar with a barely-tinted background, packed with rounded chips (team abbreviation, tiny logo, time/score), Today/Tomorrow buttons, a calendar-icon date picker, a collapse arrow, and a faint auto-scroll play/pause icon. It's the single busiest strip on the page.

**Loading state**: shimmering gray skeleton blocks sized to match the real card/table geometry — this pattern is solid and consistent already; don't redesign it, just make sure any new card/row shapes you propose get an equivalent skeleton described.

**Known rough edges to specifically address**: a "No Odds — Check Book" button currently uses a raw pale-yellow/brown color pair instead of the shared `warn` token — propose it as a proper `warn`-tone chip/button instead. The table's row-hover tint is a raw hex green instead of the shared accent tint — same fix. Mobile: the player card reflows cleanly to a single stacked column already; the table, filter row, and games strip currently rely on horizontal scrolling rather than reflowing on narrow screens, and that's fine to keep as-is unless one of your options has a specific, clearly-better idea for it.

---

## What to design options for

1. **Player card, full redesign** — apply the card-elevation system (border + subtle lift on hover, no shadow at rest), review whether the current two-column layout is still the best structure now that other pages use `.lb-card-hero`-style treatments, and resolve the "glowing gradient box" — decide if it should stay as its own special treatment or fold into the standard heat-badge system used elsewhere.
2. **Row view (dense table), column treatment** — fix the "loud vs. flat" column inconsistency: propose 2–3 different approaches to which columns get heat-mapped backgrounds vs. plain text, so the choice is deliberate rather than incidental. Also address the "No Odds" hardcoded-color button.
3. **Filter row vs. sidebar** — since both exist for the same functionality, propose ways to make the sidebar feel less like a bare settings panel while keeping it information-dense (accordion sections stay, but consider whether pill-style controls could replace the plain checkbox rows).
4. **Games/date strip** — this is the single busiest, most cluttered element on the page (many small icon controls in one thin bar). Propose 2–3 ways to reduce visual noise without removing functionality (date picker, today/tomorrow, collapse, auto-scroll toggle all need to stay reachable).
5. **View-switcher header** (Players/Games toggle, card/row icons, filter-layout icon, tab strip) — propose how these four separate controls should be visually organized/prioritized as a group, since right now they're several independent small controls stacked with no clear visual hierarchy between them.

## What NOT to touch

- Don't propose changes to the score badge (circle + letter grade) — it's already correct and reused sitewide; changing it here would break consistency with Player Detail and Diagnostics.
- Don't remove or redesign the loading skeleton pattern.
- Don't merge Players/Games into one view or remove the card/row toggle — both are intentional, existing features.
- There is a second, simpler dense-table component in the codebase that looks like an earlier draft of the row view — it's dead code and never actually renders. Ignore it; design against the row view as it actually appears in the screenshots.

## Screenshots to attach

Please attach: (1) Scan card view, players, MLB, filter row layout; (2) Scan row/table view, players; (3) Scan with the filter sidebar open; (4) Scan Games view; (5) the games/date strip zoomed in or cropped tightly; (6) the loading/skeleton state if you can catch it. Golf and MLB share this page, so one sport's screenshots are enough unless something looks different between them.

## Deliverable format

For each of the five numbered sections above, present labeled options (A/B/C) with a short description of the visual/structural idea behind each — sketches, mockup-style descriptions, or code snippets are all fine, whatever communicates the idea most clearly. Call out anywhere an option would require a new component or pattern versus reusing something described in the locked system above.
