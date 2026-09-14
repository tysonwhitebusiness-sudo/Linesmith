# Design audit — plan

**Status (2026-09-14): APPROVED. Phase E complete · Phase F complete (redone
under the research frame) · Phase F2 complete · Phase G complete (5 boards + G-ideas.md), awaiting operator picks G1–G7 · H not started.**

**The build plan (`build-plan.md`) is ON HOLD after Phase 0** until this audit
finishes and its results are merged in (Phase H). The exception is Decision 2.

## The two questions

Asked of **every single card**, on every page, for every sport. Not only the
cards already raised as examples:

> **1. Does this make sense at all for this sport?**
> **2. Does this help at all?**

**"Help" means real, in-depth insight into this player, team or game** — any
stat that could matter to an informed decision. **The pages are research pages,
not betting pages:** odds, lines and hit rates are one section, and a card is
never judged by whether it bears on today's line (operator, 2026-09-14). A card
that repeats another, says nothing, or is wrong for the sport still fails
question 2. A real stat that simply isn't about a bet does not.

**This audit looks forward, not back.** It doesn't try to establish how a card
got the way it is, and no earlier design (including the Aug 29 per-sport
mockups) is treated as the standard. The only standard is the two questions.

The four operator examples in `design-findings.md` (D1–D4) are **examples of
the kind of problem to find everywhere**. They're not a to-do list, and fixing
those four is not the job.

---

## Scope

- **Surfaces:** PlayerDetail, TeamDetail, GameDetail. 21 sport × surface
  combinations.
- **Every card on each.** Including the ones that look fine.
- **Player archetypes** (Decision 1), because a card can help for a quarterback
  and mean nothing for a receiver:

| sport | archetypes |
|---|---|
| MLB | hitter · starting pitcher |
| NFL | QB · WR · RB |
| CFB | QB · WR |
| NBA | guard · big |
| NHL | skater · goalie |
| Soccer (EPL; MLS spot-check) | forward · defender · goalkeeper |
| Tennis (ATP; WTA spot-check) | one player per tour |
| Golf | one player, **during a live tournament** |

- **States:** pre-game, live, final, offseason. A card can help before kickoff
  and be useless mid-game.
- **Out of scope:** Scan and slate pages (operator decision 2026-08-14), except
  each sport's games strip.

## How each card is judged

**First, the two questions.** Each card gets one verdict:

| verdict | meaning |
|---|---|
| **keep** | makes sense for this sport and helps; at most small polish |
| **rework** | the idea helps, but the way it's shown doesn't make sense here |
| **replace** | this slot should say something different for this sport |
| **remove** | doesn't help; the page is better without it |

**Then, for anything not "remove", what "makes sense" requires.** These are the
checks behind the verdict, not separate scores:

| check | the question |
|---|---|
| **Sentence** | What one sentence does this card say? Does the visual say it faster than the sentence would? |
| **Sport-native form** | Is this how this sport's own fans and bettors picture it (a field, a court, a rink, a pitch, a scorecard)? |
| **Scope** | What time window is each number over, is that stated, and is it the right one (this season by default)? |
| **Encoding** | Do colors, axes, units and "better" direction mean what they look like they mean? |
| **Duplication** | Does something else on the page already say this? |
| **Identity** | Real player headshots and team logos wherever they exist, with fallbacks that don't break |
| **Interaction** | Hover detail, tooltips, smooth transitions, deliberate loading and empty states |
| **Rendering** | No text collisions or overflow, works at phone width and in dark mode |

**And for every rework, replace or remove: what should be there instead.** The
answer to "doesn't help" is never just a deletion when the page has a real
question going unanswered.

---

## Phase E — Render every card

- Render every sport × surface × archetype × state in the dev server. Capture
  the full page, then each card on its own.
- Produce a **card × sport × archetype matrix** of what a real user actually
  sees, with each card's component and data source noted so later fixes know
  where to go.
- **Calendar-aware:** NFL live on Sundays, CFB on Saturdays, soccer on
  matchdays. **MLB has about two weeks of regular season left**, so its live
  states go first. NBA/NHL: judged on the pages as they render today, live
  states in October. Golf: during a tournament.
- Per-card images that back a verdict are committed as compressed JPEG.
  Full-page captures stay in the gitignored `.playwright-mcp/`.

**Deliverable:** `design-audit/E-inventory.md` + matrix. **Stop.**

## Phase F — Verdict on every card

- Every card in the matrix, per sport and archetype: its sentence (or "none"),
  **keep / rework / replace / remove**, the checks it fails with a one-line
  reason each, and **what should be there instead**.
- Written per sport so the sports sit side by side. That shows where one card
  helps in one sport and not another, which is exactly where the page should
  differ by sport.

**Deliverable:** `design-audit/F-card-verdicts.md`. **Stop.**

## Phase F2 — Visual system, UX and interaction

**Added 2026-09-14 at operator request. APPROVED 2026-09-14 with decisions 4–6 as recommended. COMPLETE 2026-09-14.** Phases E and F
judged what each card *says*. F2 judges how the whole app **looks, reads,
flows and responds**, including making every card feel interactive where it
can be. Charcoal (the graphite palette) is the approved color direction and
stays; everything else is open.

### Why: measured before proposing, 2026-09-14

| area | measured |
|---|---|
| Type sizes | `tailwind.config.ts` defines a 10-step scale (`micro` 9px … `display-lg` 44px). Components use **795 hand-typed `text-[Npx]` sizes vs 266 scale tokens**, across **21 distinct pixel values** (8, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13 … 28), plus 154 Tailwind default sizes. |
| Weights | semibold 422, medium 162, bold 99, normal 23, extrabold 4 |
| Card headers | **at least 12 distinct heading class strings**: uppercase bold 10.5px on a tinted bar, sentence-case 12px, `text-meta` tracked uppercase, 15px plain… |
| Colors | 130 hardcoded color literals in components beyond the tokens. The `card` token (93% lightness) is darker than `paper` (96%), inverting elevation (recorded 2026-08-29, still true). |
| Hover | hover styles in **30 of 73** component files; `cursor-pointer` 13 times; **24% of rendered cards** have any hover (Phase E) |
| Focus | **0** `focus-visible` styles: no keyboard focus indication anywhere |
| Tooltips | 97 native `title=` tooltips; almost no styled tooltip component |
| Motion | the `motion` library is imported by **1 file**; 111 `transition` classes; keyframes only for pulse and shimmer |
| Font | system `ui-sans-serif` for text, IBM Plex Mono loaded for numbers |

### Scope — three layers

**A. Visual system**

1. **Typography:** every rendered size, weight and line height mapped to a
   proposed ramp; numeric style (tabular figures, mono vs sans for stats);
   typeface choice (system sans today).
2. **Color in use:** within the charcoal palette, how semantic colors (good,
   bad, warn, heat ramps, live) are applied; the 130 hardcoded literals; text
   contrast (WCAG AA) of every ink tone on every surface; the card/paper
   elevation inversion.
3. **Spacing and density:** card padding, gaps, header heights, table row
   heights, rail and column widths, measured per page.
4. **Card anatomy:** one proposed anatomy (header · scope/subtitle · body ·
   caption · actions) against the 12+ header variants; tabs and segmented
   controls, chips, tables, buttons and pills as a component inventory.
5. **Imagery:** photo, logo and flag sizes, crops and fallbacks.
6. **Data-viz styling:** axis, tick and label type; gridlines; color ramps;
   whether charts use the shared `components/charts/` primitives.

**B. UX**

7. **Page structure:** section order, what's above the fold, main column vs
   rail, section navigation on long pages (the NFL game page runs 16+ cards).
8. **Navigation and flow:** every player, team and game name linked; player ↔
   team ↔ game cross-links; back behavior; the games strip.
9. **States:** loading (skeletons), empty, error (D5's raw error text), stale,
   offseason, live, final, and what each looks like.
10. **Responsive:** 400 / 768 / 1024 / 1440px per surface (every phone capture
    overflows today).
11. **Accessibility:** keyboard navigation and focus, ARIA on interactive
    controls, contrast, motion sensitivity (`prefers-reduced-motion`).

**C. Interaction and motion** (the operator's emphasis)

12. **Interaction inventory per card:** what can be clicked, hovered, toggled,
    sorted or expanded today, and what should be. The baseline target: every
    stat, name, logo and chart mark does something.
13. **Target interaction model**, per card type:
    - Hover detail on every chart mark.
    - A shared crosshair across charts of the same games.
    - Click a stat to open its trend and splits.
    - Scope toggles (season / last N / career).
    - Sortable tables.
    - Compare mode (player vs player, team vs team).
    - Drill-down panels instead of navigating away.
    - Deep links that preserve state.
14. **Motion:** duration and easing tokens, transitions for tabs, expansion and
    data changes, number transitions and change flashes on live values, loading
    to content, reduced-motion fallbacks.
15. **Feedback:** hover, pressed, selected and disabled states; styled
    tooltips; confirmations (added to slip, tracked).

### Method

- **Code measurement:** token vs arbitrary usage, component variants, interaction
  and motion primitives (as the table above, but per component and per page).
- **Rendered measurement:** a Playwright pass over the Phase E pages collecting
  **computed** font size, weight, line height, color and padding for every text
  node and card, so the audit reports what users actually see, not what class
  names say.
- **Interaction probe:** per card, hover every interactive-looking element and
  record whether anything changes; tab through the page and record focus order
  and visibility; check links on names and logos.
- **States:** force loading (throttled network), empty, error and phone width.
- **External references** (for example Baseball Savant, FBref, NBA.com stats)
  are used as inspiration for patterns in Phase G, **not as a standard**.

### Deliverables

- `design-audit/F2-visual-system.md`: measured inventory plus a proposed
  system (type ramp, spacing scale, card anatomy, component inventory, color-use
  rules, motion tokens). Proposal only.
- `design-audit/F2-ux-interaction.md`: per-page UX findings, and a per-card
  interaction inventory with the target interaction for each.

**Stop** after F2. Phase G's mockups are then drawn in the proposed system with
the proposed interactions, and Phase H merges F2's system work into the build
plan as the foundation, ahead of card-level changes.

## Phase G — New ideas and mockups

Phase F says which slots need something different. Phase G says what.

- **Per sport, per surface: what does someone on this page actually need to know
  that it doesn't show?** Starting from the sport, not from the cards that
  already exist.
- Each idea: the sentence it says, the form that says it fastest, the data it
  needs, and whether we **hold** that data (card audit Phase A ledger),
  **could get** it, or **can't**.
- For each page, which cards the ideas replace or remove. A page that only gains
  cards gets worse.
- **Visual mockups** of the strongest ideas (2–3 per surface, Decision 3), so
  they're judged by looking at them. The operator picks. Nothing gets built
  from a mockup nobody chose.

**Deliverable:** `design-audit/G-ideas.md` + mockup boards. **Stop for
operator picks.**

## Phase H — Merge into the build plan

Fold every verdict and every picked idea into `build-plan.md` alongside the data
correctness work, **grouped by the shared fix that delivers them**, so a fix
that spans sports is one job, not eight (for example, one spatial-surface
component covering every sport's "where" card). Sequenced so dependencies hold:

- **Scope before deep history** (build Phase 7): more years of data behind
  numbers that ignore seasons makes them worse.
- **Identity and interaction first:** every later card uses them.
- **Card changes before the field-rename cleanup** (build Phase 6), so nothing
  is renamed twice.

**Deliverable:** revised `build-plan.md`. **Requires approval before any code.**

---

## Decisions for the operator

| # | decision | recommendation |
|---|---|---|
| 1 | Archetype set above | as listed |
| 2 | Do build Phase 1's pure data bugs proceed during the audit? | **Yes: 1a (men on WTA), 1c (spelling), 1d (NFL dead link).** None changes how a card looks. **Hold 1b (team header)**, which the audit will judge. |
| 3 | Mockups per surface in Phase G | 2–3 of the strongest ideas |
| 4 | *(F2)* Typeface: stay on system sans, or evaluate a brand typeface? | **Evaluate 2–3 in Phase G mockups** beside system sans; decide by looking |
| 5 | *(F2)* Dark mode: none exists. Design for it now or not? | **Build the proposed tokens so dark mode is possible**; decide whether to ship it separately |
| 6 | *(F2)* Interaction ambition | **Two tiers:** a baseline on every card (hover detail, linked names, scope toggles, focus states) and deeper interactions (drill-downs, compare mode) where they add real insight |

## Ground rules

- **Judge, don't fix** during E–G.
- Render every card; never judge from code alone.
- Check the calendar, including the weekday, before calling an empty card a
  problem.
- Pooler caps at 15 connections and the NBA Phase 7 session is active. Check for
  running jobs before heavy rendering.
- Don't touch `docs/CURRENT.md`. This thread's baton is `RESUME-PROMPT.md`,
  updated at each stop.
