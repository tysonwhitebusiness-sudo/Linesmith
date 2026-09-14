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
3. **Design audit: APPROVED. Phases E and F COMPLETE (2026-09-14); Phase G (new ideas + mockups) next, awaiting operator go.**
   `docs/audit-2026-09-13/design-audit-plan.md`. Every single card on every
   player/team/game page, every sport, judged by two questions: **does this make
   sense at all for this sport, and does this help at all?** Phases:
   E render inventory → F verdict per card (keep / rework / replace / remove +
   what instead) → G new ideas + mockups (I pick) → H merge into the build plan.
   Stop after each.
   - Operator examples: `design-findings.md` D1–D5. These are **examples of
     the kind of problem to find everywhere**, not a to-do list.
   - Results: `design-audit/E-inventory.md` (coverage + facts), `F-card-verdicts.md` (every card, 13 data bugs F-B1..B13),
     `E-matrix.md` (generated), `E-raw/` (captured card data).

## Decisions already made — don't reopen

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
