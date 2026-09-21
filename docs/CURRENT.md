# CURRENT — pick up here

**Rewritten 2026-09-21, before the unattended run. Track C (card redesign)
and the sport-specific Spotlights are approved, audited, and every question
is answered. Start at phase 1 (C7) of the run order and don't stop to ask.**

---

## Read, in this order

1. **`docs/design/unattended-run-2026-09-21.md`**: the run order (§2), the
   operator's standing answers (§1, including **Render deploys authorised**
   for this run), the six corrections to the plans (§3), and what to do when
   blocked (§4).
2. `docs/design/card-redesign-gameplan-2026-09-21.md`: WHAT each Track C
   phase builds. The visual target is
   `docs/design/card-redesign-2026-09-21.html`; serve it with the
   `design-mockups` preview on :8125. The mockup wins on looks; the plan wins
   on where the data comes from.
3. `docs/design/movers-and-spotlights-gameplan.md`: WHAT the Spotlight phases
   build (the eight new ideas N1–N8, where each one renders, sources per
   sport). Movers MV0–MV4 is done (`1bad903`).

## Where the work is

| # | phase | status |
|---|---|---|
| 1 | C7 delete the live line tracker (six role keys → five) | **next** |
| 2 | C0 Electric Turf + `-ink` tokens, ESPN team colours, kit pieces | — |
| 3 | C1 charcoal section bands (Movers included) | — |
| 4 | PY-A shared Python: C5 grading + 3 new Specials + park table + spotlight `kind` (**deploy**) | — |
| 5 | C2 player hero | — |
| 6 | PY-B spotlight rankings, NFL/NBA/NHL first (**deploy**) | — |
| 7 | C3 player search rail | — |
| 8 | C4 Slate imagery (Movers included) | — |
| 9 | C6 props controls (tabs → filters, Home Runs deleted) | — |
| 10 | F0-UI research-page flags + Slate spotlight cards | — |
| 11 | C5-UI receipts table + new Specials (needs a real graded slate) | — |
| 12 | DJ-GOLF tournament → course backfill (**deploy**) | — |
| 13 | DJ-TEN TML-Database ingest, licence check first (**deploy**) | — |
| 14 | SP-GOLF, SP-TEN | — |
| 15 | C8 close Track C | — |
| 16 | SPC close Spotlights | — |

Update this table and the run doc's §2 after every phase commit, then push.

## Deploys

| when | commit | service | what it enables |
|---|---|---|---|
| — | — | — | none yet. The worker is on `c5baee4`. |

## Decisions that bind this run

- **Electric Turf**: good `#00d26a` / bad `#ff4d4f` / warn `#ffb020`. Text
  always uses the `-ink` shade. It recolours the frozen Scan table
  (approved); Scan's layout and the length pins stay.
- **Green never marks structure.** Headers are charcoal with a 2px `#6e727a`
  top line.
- **Stats never render as chips or buttons**: a labelled value + percentile.
- **Specials are forecasts** graded next morning, never leaderboards.
- **Weather** only from `python-odds-service/src/predict/weather.py`
  (Open-Meteo). **Park orientation ships on cited sources with wind
  direction on**, plus a queue row listing five parks for the operator to
  check after the fact.
- **Tennis** data from TML-Database, after a licence check.
- **Blocked? Skip ahead, come back** (run doc §4).

## Still open from before

- `docs/design/SIGNOFF-QUEUE.md` Q0–Q20: operator sign-off. Q15 and
  `/diagnostics` need a signed-in session.
- M4 (promotion tests) and M5 (prop baselines, needs approval).

## Findings worth knowing

- **`DataTable.tone` is a RESULT chip ("W 6–3"), not a colour.** Use `ink`
  for good/bad-by-definition values, and `heat` for a rank.
- **Scan's cell components stay frozen** (`StatCells`, `OddsChip`). C6
  unfreezes only the filter-bar files.
- **A worn browser tab stalls effects** and React Aria's exit animations.
  Render in a fresh tab.
- **The Playwright browser can be locked by another session.** Fall back to
  the built-in browser pane with `tabs_create` for a fresh tab.
- **The mockup's stat lines are illustrative.** Don't sign off C5 on
  placeholder data.
- **Bash heredocs eat backslashes, quotes and `\n`** in this environment.
  Write scripts and regex-bearing tests with the Write/Edit tools.
- The browser can't load `file://`. Use the `design-mockups` preview.

## Standing constraints

- Render deploys: **authorised for this run's Python phases** (run doc §1
  A1). Record each one above. `git push` itself does not deploy.
- Never `git add -A` or `git add docs/`: `docs/discord-community-prompt.md`
  is the operator's. Add named files only.
- Prod on :3000 serves `.next`: stop it, `npm run build`, restart
  `linesmith-prod`. `/kit` is dev-only: `linesmith-dev-verify` on :3001.
- The Postgres pooler caps at 15 connections. Check for long-running
  fits/scripts first.
- At ~92% context, stop and hand off by rewriting this file.
