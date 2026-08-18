# Linesmith — Player Detail Page Design Options Brief

You're being asked to propose visual design options for the **Player Detail** page of Linesmith, a golf/MLB player-props pick-finder app (this is the page a user lands on after tapping a player from Scan — MLB only today, see note below). You cannot see the running app or its source code, so this brief describes the current state in plain English, and the user will attach screenshots of the live page alongside this prompt — look at those screenshots as the ground truth for exact current layout/spacing, and treat the text below as the explanation of what's *behind* what you're seeing.

**Give options, not a decision.** For every section below, propose 2–3 distinct visual directions and clearly label them (A / B / C). Don't converge on a single "best" answer yourself — the user will pick, mix, or reject after seeing the set. Keep every option inside the locked design system described next; the point of these options is to explore layout/hierarchy/emphasis choices, not to reopen the color or type palette.

Linesmith just finished a full visual-language pass on its **Game Detail** page (a different page, not in scope here) and locked in a token system as a result. Every other page — this one included — is being brought up to that same standard using the exact same tokens, so the whole app reads as one system instead of a patchwork. Nothing below is optional or up for reinterpretation.

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
- Default card: 10px rounded corners, 1px border, white background, **no shadow** — a card in a list reads fine on a border alone. Player Detail today uses this default treatment for *every* section on the page, including the top identity header — nothing on the page currently has more visual weight than anything else.
- Hero card: reserved for exactly **one** hero/live element per page. Game Detail's top card uses this. Player Detail has no hero treatment today — deciding whether the identity header deserves one is one of your design questions below.
- Interactive card: any card you can genuinely tap/click should lift with a soft green-tinted shadow on hover/press. This exists in the system but is unused anywhere on this page today.
- All shadows are green-tinted (never neutral grey).

**Chips/badges**
One shared component, two shapes: `pill` (rounded-full, most things) or `box` (rounded-md, reserved for price/odds values). Tones: neutral (light gray), good/warn/bad (tinted bg + matching text off the semantic palette), or masters (solid green fill, white text, used sparingly for the one primary action). Any chip you propose should be describable as one of these.

**Heat ramp**
Every percentage-driven number (hit rate, confidence, odds comparison) reads off one continuous red→amber→green ramp. There's a vivid "fill" version for bars/badges and a darkened "ink" version for text-on-white. The confidence badge (letter grade + %, e.g. "B+ · 78%") is a fixed shared component and must look identical everywhere it's used, including here.

**Hard no's**: no new colors outside the palette, no monospace type, no more than one hero card per page, no dark mode, no sportsbook logos.

---

## Current state of the Player Detail page

Everything is a single vertical stack, full width, identical on a 375px phone and a 1440px desktop — there is no side rail or multi-column layout anywhere on this page today. Top to bottom:

1. **Identity header** — a plain bordered card: 44px circular avatar, bold name, muted meta line (position, opponent, first-pitch time). No accent color, no elevation — reads as a compact banner, not a focal point.
2. **Market tabs** (Hits, RBI, etc., when a player has more than one tracked prop) — a thin underline-tab row, 2px green underline on the active tab, no background/pill shape.
3. **Line stepper bar** — another plain bordered card: small pill-bordered −/+ buttons around the current over/under line, a sportsbook price chip, the confidence badge, and a solid-green "Add to slip" button, all packed on one wrapping row.
4. **Scope filter chips** — a horizontal scrollable row (All venues/Home/Away/vs Opponent, Last 5/10/15/All): pill buttons, unselected = thin border/white, selected = green border + light green fill + green text. All-text, no icons.
5. **Five "window" stat tiles** (L5, L10, L15, H2H, SZN) in a row, each ~76px wide. Each tile's border, glow, text color, and fill-bar are computed live off the shared heat ramp with a soft shadow and a thin progress bar underneath — **this is the single most "designed" element on the page today**; everything else is comparatively flat by comparison.
6. **All-books odds panel** — plain bordered card, small heading, refresh button, a plain list of book-name + price rows; the user's own sportsbook gets a light green tint and a star.
7. **Distribution chart** — a hand-built bar chart (per-game results vs. the line), thin colored bars, a dashed line marking the threshold, in a plain bordered card. One fallback color ("no value recorded" bar) is a raw hardcoded color rather than a token — flag/fix this if your option touches the chart.
8. **Gamelog table** — dense, small (11px) text, sticky first column, hover-only row distinction, no zebra striping — functional but spreadsheet-plain.
9. **Bottom info-card grid** (2 columns): Line Movement, Matchup, Quality of Contact (batters), Game Odds, Form — four to five identically-weighted small cards with no size/emphasis hierarchy between them, even though they're not equally important. The Game Odds card nests smaller sub-cards for Moneyline/Total with price chips and edge badges — already shows the player's upcoming game odds, just buried at the bottom of the stack rather than given prominence.

**Golf note**: golf has no standalone Player Detail page today — there's no `/golf/player/[id]` route. The only way to see a golfer's detail view is through an embedded search-picker panel. Design your options for the MLB page; note in your response if any option would need adjusting for a page that doesn't yet exist for golf (i.e., don't assume golf-specific content like "opponent" always applies).

---

## What to design options for

1. **Identity header** — decide whether this should become the page's one hero element (bigger avatar/name, a subtle elevated card, maybe folding in the confidence badge or today's line prominently) or stay a compact banner. If hero, this becomes the only `.lb-card-hero` on the page — no other section should also get it.
2. **Two-zone desktop layout** — Linesmith's overall design brief calls for a persistent side panel on wider viewports (tablet/desktop) holding matchup context — course/season history and, for MLB specifically, a "Today's Line" section with the game's moneyline/total — while the main scrollable content (chart, gamelog) sits alongside it. Today this page is single-column on every viewport. Propose 2–3 layouts for how the page reflows at desktop width: what moves into a persistent side rail vs. what stays in the main scroll, and confirm the mobile view stays exactly as stacked as it is today (mobile must not regress).
3. **Bottom info-card grid hierarchy** — right now Line Movement / Matchup / Quality of Contact / Game Odds / Form are visually identical. Propose ways to differentiate them by importance — Game Odds in particular is a strong candidate to be pulled out of this grid entirely if your option 2 puts it in a side panel instead.
4. **Line stepper bar density** — this row currently packs many small controls (stepper, price chip, confidence badge, CTA button) into one wrapping flex row. Propose 2–3 ways to reduce crowding while keeping every control present and equally reachable.
5. **Elevation pass** — apply the interactive-card hover/press lift to whichever sections are genuinely tappable (gamelog rows? window stat tiles? odds panel rows?), since none of them use it today despite the sitewide system supporting it.

## What NOT to touch

- Don't redesign the five window stat tiles (L5/L10/L15/H2H/SZN) — they're already the best-executed element on the page and match tiles used elsewhere (Team Detail reuses this exact component); changing them here would break consistency.
- Don't change the confidence badge (letter + %) styling.
- Don't propose removing the market-tab row, scope filters, or any of the five bottom info cards — consolidate/reprioritize their visual weight, don't cut functionality.
- Don't design a golf-specific version of this page — it doesn't exist yet; MLB only.

## Screenshots to attach

Please attach: (1) full page top-to-bottom on mobile width; (2) full page top-to-bottom on desktop width (even though it's currently just a wider version of the same stack — useful as a baseline); (3) the five window stat tiles cropped/zoomed; (4) the bottom info-card grid cropped; (5) the line stepper bar cropped.

## Deliverable format

For each of the five numbered sections above, present labeled options (A/B/C) with a short description of the visual/structural idea behind each. For option 2 (two-zone layout) specifically, describe both the desktop and mobile behavior for each option — this is the one section where responsive behavior itself is the design question, not an afterthought.
