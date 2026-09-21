# CURRENT — pick up here

**Rewritten 2026-09-21, end of the unattended run. The U and S tracks are
finished.**

---

## Where the work is

Every phase of `docs/design/master-gameplan-ui-and-slate.md` §5 rows 5–18 is
done except the one piece measured and left out: **S2's Movers** (queue Q9).
Nothing was deployed — `render.yaml` is `autoDeploy: false`; the worker is
still on `c5baee4`. Prod on port 3000 was rebuilt from `fb9498e` and is running.

| commit | phase | what |
|---|---|---|
| `3973f18` | S4 | Specials (MLB HR + K, NFL TD, EPL/MLS goalscorer) with receipts; **the right-edge cutoff fixed** |
| `403e790` | S5 | MLB Model section (pick, price, lock — no probability/record); Your lines (signed-in only); `TodaysPicksModal` deleted |
| `a23c96e` | U3 | the field family; every field 16px on phones; `PickList` |
| `9846360` | U4 | Modal / SlideoutMenu / Dropdown / Popover on React Aria |
| `66c050a` | U6 | page sweep: 378 sizes, 47 native titles, hex, every hand-rolled table/button/chip onto the kit |
| `73ab808` | S6 | no-edge guard over every Slate file; `CLAUDE.md` Slate section + Scan freeze; mockup historical |
| `fb9498e` | U7 | no allowlist left in scope; `/kit` complete; `CLAUDE.md` UI primitives section |

## What renders now

- **`/mlb`**: Games · Books · Spotlights · Specials · Model · Props. Specials
  carry real receipts (2026-09-20's HR top five: 2 of 5 who played). The game
  cards and the Model section name the same locked pick.
- **Every sport** swept at 1440 and 400 on 2026-09-21 in fresh tabs: no page
  errors, document width = viewport. In season: MLB, NFL (Monday's one game +
  Specials), CFB, MLS, WTA. Off season, with honest empty states: NBA (first
  game 10-03), NHL, ATP, golf (tournament finished), EPL (no Monday match).
- **The "right portion cut off" report**: fixed in S4 (SL-25). `sr-only`
  labels escaped their scroller and widened the page; /nfl at 390px was 853px.
- Selects are React Aria popovers (no iOS zoom), the slip is a bottom sheet on
  phones with a real focus trap, and nothing on a page is under 11px outside
  charts and the frozen Scan board.

## Read first: the queue (`docs/design/SIGNOFF-QUEUE.md`, Q0–Q19)

The ones that change what you see and cost the most to reverse:
- **Q16** — the ML/O/U win–loss chips are gone for **every** sport (a record;
  Q0's default shows none for an ungated model).
- **Q18** — sizes snapped to the ramp; 8–10px text grew to 11px (golf/tennis
  schedules, diagnostics).
- **Q19** — golf scores are coloured numbers now, not a gradient wash.
- **Q14** — the soccer/tennis phone header is cramped; a design call.
- Q15 and the diagnostics render are **owed**: both need a signed-in session.

## Findings worth knowing (full ledgers in the two plan docs)

- **`DataTable.tone` is a RESULT chip ("W 6–3"), not a colour.** Use `ink` for
  a value good/bad by definition, `heat` for a rank (U-15).
- **Scan's cell components are part of the freeze** — `StatCells`, `OddsChip`
  (U-16), and the glider `SegmentedToggle` (now `OUT_OF_SCOPE`).
- **A worn browser tab stalls React Aria's exit animation** (U-14). Render in
  a fresh tab (`context.newPage()`).
- **`model_calibration` has no game-model row** (SL-26); `game_picks`'
  `commence_time` arrives as a `Date` (SL-28).
- Bash heredocs eat backslashes in this environment: write regex-bearing
  scripts with the Write tool (`scripts/u6_*.py` are examples).

## Owed by you

- **A deploy**, only if you want any of this live. Nothing needs the worker.
- **Signed-in checks**: Your lines (Q15) and `/diagnostics` (redirects to
  login signed-out; covered by tests only).
- Sign-off on the queue rows and phase rows.

## What's next (not started)

M4 (promotion tests, ongoing) and M5 (prop baselines, needs approval) in the
gameplan; Movers once a per-book quote-quality pass exists (Q9); sport-specific
spotlights (SL-23), one data phase per sport.

## Standing constraints

- Ask before deploying to Render. `git push` does not deploy.
- Never `git add -A` or `git add docs/` — `docs/discord-community-prompt.md`
  is the operator's. Add named files only.
- Prod on :3000 serves `.next`: stop it, `npm run build`, restart
  `linesmith-prod`. `/kit` is dev-only — `linesmith-dev-verify` on :3001.
- The Postgres pooler caps at 15 connections.
- At ~92% context, stop and hand off by rewriting this file.
