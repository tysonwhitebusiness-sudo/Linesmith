# Resume prompt — card & design audit thread (2026-09-13)

Paste everything below the line into a fresh session on any account.

---

I'm resuming the card and design audit thread in this repo. Read `CLAUDE.md`
first, then the files below **before doing anything**. Don't restate them back
to me.

## Where the work is

1. **Card audit (Phases A–D): DONE.** Data correctness per card.
   `docs/card-audit-plan-2026-09-13.md` and `docs/audit-2026-09-13/phase-*.md`.
2. **Build plan: APPROVED, Phase 0 done, then ON HOLD.**
   `docs/audit-2026-09-13/build-plan.md`. The "before" baseline is in
   `before/README.md`.
3. **Design audit: APPROVED. Phases E, F, F2, G and G2 COMPLETE (2026-09-14), including game states (before start / live / final) and the compare control.** G2 built
   sport-switchable, real-data mockups of the player, game and team pages
   (`docs/design/phase-g2/`, `PLAN.md` explains rebuilding). **Waiting on the operator's
   picks G1–G7** in `design-audit/G-ideas.md`, which now opens with the G2 boards and the
   G2 data findings (prop main lines, post-start odds capture, NBA rim origin and miss point
   values, season conventions, innings pitched, ESPN ranks). **Next: Phase H** — merge the
   verdicts, picks and data findings into the build plan. Don't start H before the picks.
   `docs/audit-2026-09-13/design-audit-plan.md`. Every single card on every
   player/team/game page, every sport, judged by two questions: **does this make
   sense at all for this sport, and does this help at all?** Phases:
   E render inventory → F verdict per card (keep / rework / replace / remove +
   what instead) → G new ideas + mockups (I pick) → H merge into the build plan.
   Stop after each.
   - Operator examples: `design-findings.md` D1–D5. These are **examples of
     the kind of problem to find everywhere**, not a to-do list.
   - Results: `design-audit/E-inventory.md` (coverage + facts), `F-card-verdicts.md` (REDONE 2026-09-14 under the research frame: every card, a depth ledger per sport, slate research views, 13 data bugs F-B1..B13), `F2-visual-system.md` and `F2-ux-interaction.md` (measured system + two-tier interaction target + live-game layout; ESPN's NFL game page is an operator-supplied inspiration, not a standard), `G-ideas.md` + five real-data mockup boards in `docs/design/phase-g/` (see its README; rebuild with `node docs/design/phase-g/build.mjs`; boards must never show invented values),
     `E-matrix.md` (generated), `E-raw/` (captured card data).

## Decisions already made — don't reopen

- **Pages are in-depth research pages, not betting pages.** Any stat relevant to an
  informed decision belongs on player/team/game pages; odds and lines are one
  section, never the frame cards are judged by (operator, 2026-09-14).

- **The design audit looks forward.** Don't try to work out what went wrong or
  who caused it. **No earlier design is the standard**, including the Aug 29
  per-sport mockups in `docs/design/`. The only standard is the two questions.
- Don't fix only the operator's screenshots; judge every card.
- Player archetypes per sport, as listed in the design audit plan.
- During the audit, build-plan items **1a (men on WTA), 1c (defence spelling)
  and 1d (NFL dead game link)** may be fixed; **1b (team header) waits** for
  the audit.
- 2–3 mockups per surface in Phase G.
- Golf is held until a live tournament. NBA/NHL live states wait for October.
- Scan and slate pages are out of scope, except the games strip.

## How Phase E captures (if continuing it)

- Playwright MCP, against the dev server already running on :3000 (another
  chat's). Capture script: `.playwright-mcp/install.js` (gitignored). Run it
  once with `browser_run_code_unsafe` `filename`; it installs
  `page.context().__cap(page, url, label, {mobile, pause})`. Card data
  accumulates in `page.context().__auditAll`. Save it by setting
  `window.__all = JSON.stringify(...)` and calling `browser_evaluate` with a
  `filename` under `docs/audit-2026-09-13/design-audit/E-raw/`.
- **Matrix generator** lives in the session scratchpad and won't survive. Rebuild it
  if needed: rows = normalised card title, columns = captures, flags for
  image/initials/hover.
- **Traps:** the API limiter shares 60 requests/min across routes, so pace
  pages (~3/min) and watch for "Limit is 60 per 60s". **Don't put a `#`
  fragment in phone-width URLs**; it rendered zero cards. Loading shells look
  settled, so wait for real cards.

## Standing constraints

- Postgres pooler caps at 15 connections. OddsHarvester Python processes run
  on this machine on a ~20-minute cycle; the NBA Phase 7 session may be active.
- Don't touch `docs/CURRENT.md` (another session's baton). This file is
  this thread's baton. Rewrite it at every stop.
- Never `git add -A` or `git add docs/`. Add explicit paths.
- Ask before deploying to Render. At ~92% context, stop and hand off.
