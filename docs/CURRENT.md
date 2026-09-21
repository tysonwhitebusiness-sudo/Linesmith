# CURRENT — pick up here

**Rewritten 2026-09-21. The U and S tracks are finished. Track C (card
redesign) is approved and planned, and no code has been written for it yet.
Start with C7.**

---

## Where the work is

**Track C, the card redesign.** Approved by the operator on 2026-09-21 after
four rounds of mockup edits. No open questions remain.

- **Target, built 1:1:** `docs/design/card-redesign-2026-09-21.html`.
  Open it in a browser. It shows 8 surfaces at 1440 and 390.
- **Plan:** `docs/design/card-redesign-gameplan-2026-09-21.md`. It has phases
  C0–C8, file paths and line numbers checked against the tree, data sources,
  guards, "done when" for each phase, and the operator's answers in §9.
- **Order:** C7 → C0 → C1 → C2 → C3 → C4 → C6, with **C5's Python half
  starting alongside C2** (it needs real slates graded before its UI can
  show anything true). One commit per phase, named `C{n}: …`. Update the
  table below after each one.

| phase | what | status |
|---|---|---|
| C7 | delete the live line tracker (six role keys → five) | **next** |
| C0 | Electric Turf tokens + `-ink` text tokens, one ESPN team-colour source, kit pieces | — |
| C1 | charcoal band section headers (variant A) | — |
| C2 | player hero: team band, ranked tiles, collapsible body with a one-time peek | — |
| C3 | player rail: one row shape, adapter-chosen headline stat, kit filters | — |
| C4 | Slate imagery: logos, team stripes, headshots, book marks | — |
| C6 | props: tabs → filters, Home Runs deleted, ≤ 2 control rows on phones | — |
| C5 | receipts breakdown + MLB longest HR / NFL longest reception / NHL 2+ goals | — |
| C8 | guards, `/kit`, render sweep, CLAUDE.md | — |

## Decisions that bind track C (all answered in plan §9)

- **Electric Turf**: good `#00d26a` / bad `#ff4d4f` / warn `#ffb020`. Text
  always uses the darker **ink** shade; the fill used as text fails
  contrast.
  - **It recolours the frozen Scan table too.** That's approved. The
    file-length pins on `ScanTable`/`ScanCard` stay.
- **Green never marks structure.** Headers are pure charcoal with a 2px
  `#6e727a` top line. Colour comes from team and player content.
- **Stats never look like buttons**: labelled values with a percentile, never
  chips.
- **Specials are forecasts** (a ranked top five, graded the next morning),
  never leaderboards of what already happened.
- **Home Runs** tab and board: deleted outright.
- **Weather** comes from the linked Open-Meteo feed
  (`python-odds-service/src/predict/weather.py`). Never add a second client.
  Wind *out/in* waits on a 30-park orientation table that the operator
  spot-checks before it ships.

## What renders now (unchanged since the S/U close)

- The Slate on every sport: Games · Books · Spotlights · Specials · Model ·
  Props. Swept at 1440 and 400 on 2026-09-21, clean.
- Nothing was deployed. `render.yaml` is `autoDeploy: false`; the worker is
  on `c5baee4`. Prod on :3000 was built from `fb9498e`.

## Still open from before track C

- `docs/design/SIGNOFF-QUEUE.md` Q0–Q19: the operator's sign-off. Q16, Q18,
  Q19 and Q14 change what you see the most. Q15 and `/diagnostics` need a
  signed-in session.
- `docs/design/movers-and-spotlights-gameplan.md` (commit `7c38e0d`): Movers
  and sport-specific Spotlights. **Queued behind track C**, not started.
- M4 (promotion tests) and M5 (prop baselines, needs approval).

## Findings worth knowing

- **`DataTable.tone` is a RESULT chip ("W 6–3"), not a colour.** Use `ink`
  for a value that's good or bad by definition, and `heat` for a rank.
- **Scan's cell components stay frozen** (`StatCells`, `OddsChip`). C6
  unfreezes only the filter bar files (`FilterBar`, `FilterSidebar`,
  `PlayerFilterDrawer`, `DateGameStrip`, `useFilters`, `SegmentedToggle`).
- **A worn browser tab stalls effects** and React Aria's exit animations.
  Render in a fresh tab.
- **The mockup's stat lines are illustrative.** Its player IDs, logos and
  teams were checked against ESPN's athlete API on 2026-09-21 (three were
  wrong and got fixed). Don't sign off C5 on placeholder data.
- **Bash heredocs eat backslashes and quotes** in this environment. Write
  scripts with the Write tool and run them.
- **The browser pane can't load `file://` pages in Playwright.** To check the
  mockup, serve `docs/design` with `python -m http.server`.

## Standing constraints

- Ask before deploying to Render. `git push` does not deploy.
- Never `git add -A` or `git add docs/`: `docs/discord-community-prompt.md`
  is the operator's. Add named files only.
- Prod on :3000 serves `.next`: stop it, `npm run build`, restart
  `linesmith-prod`. `/kit` is dev-only: `linesmith-dev-verify` on :3001.
- The Postgres pooler caps at 15 connections. Check for long-running
  fits/scripts before running DB-touching Python.
- At ~92% context, stop and hand off by rewriting this file.
