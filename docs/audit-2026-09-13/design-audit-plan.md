# Design audit — plan

**Status: AWAITING OPERATOR APPROVAL. Created 2026-09-13. Nothing started.**

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

## Ground rules

- **Judge, don't fix** during E–G.
- Render every card; never judge from code alone.
- Check the calendar, including the weekday, before calling an empty card a
  problem.
- Pooler caps at 15 connections and the NBA Phase 7 session is active. Check for
  running jobs before heavy rendering.
- Don't touch `docs/CURRENT.md`. This thread's baton is `RESUME-PROMPT.md`,
  updated at each stop.
