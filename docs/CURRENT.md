# CURRENT — pick up here

**Rewritten 2026-09-21, mid-run (checkpoint before U6).** If this is the last
rewrite you see, the session ended during U6 — check `git log` for anything
after `9846360`.

---

## Where the work is

`docs/design/master-gameplan-ui-and-slate.md` §5 is current. **Done:** U0, U1,
U2, U5, S1, S2 (part — Movers not built, Q9), S3, **S4, S5, U3, U4**.
**Left:** U6 (page sweep), S6 (Slate close), U7 (UI close). Nothing deployed —
`render.yaml` is `autoDeploy: false`; pushing is safe. The worker is still on
`c5baee4`.

| commit | phase | what |
|---|---|---|
| `3973f18` | S4 | Specials from `slate_rankings` (MLB HR + K, NFL TD, EPL/MLS goalscorer), receipts under each; **and the right-edge page cutoff fixed** (SL-25) |
| `403e790` | S5 | MLB Model section (pick + price + lock; no probability/record, Q0); Your lines (signed-in only); `TodaysPicksModal`, `useGamePickRecord` and the win–loss chips deleted |
| `a23c96e` | U3 | the field family; 0 raw input/select/textarea in scope; five hand-built listboxes → `PickList`; every field 16px on phones |
| `9846360` | U4 | Modal / SlideoutMenu / Dropdown / Popover on React Aria; slip, account menu, diagnostics dialog and `DrillDownPanel` moved |

## What renders now that did not before

- `/mlb` Slate nav: **Games · Books · Spotlights · Specials · Model · Props**.
- **Specials**: tabs per ranking, every factor a column with its source, score
  bar, "why" on expand, and **real receipts** — 2026-09-20's HR top five
  graded (2 of 5 who played). Caption: a ranking, not a probability; equal
  weights until a pre-registered backtest.
- **Model** (MLB only, declared by the slate adapter): today's locked picks,
  the price taken, "Can still move / Locked". MLB's game cards now name the
  SAME locked pick (they disagreed on 2 of 3 games — SL-27).
- **Your lines**: hidden signed out (verified — no section, no nav entry, no
  `/api/bets` request). Signed-in render is **owed** (Q15).
- **The operator's "right portion cut off" report** (2026-09-20): `sr-only`
  labels in table cells escaped their scroller and stretched the document
  (/nfl at 390px was 853px wide). Swept 8 pages × 7 widths after the fix:
  document width = viewport everywhere.
- Every select is a React Aria popover (no iOS focus zoom); the slip is a
  bottom sheet on phones and traps focus.

## Queue rows added this run (`docs/design/SIGNOFF-QUEUE.md`)

Q12 did-not-play counts as neither · Q13 CFB ranking has no rows · **Q14 phone
header on soccer/tennis is cramped** (design call) · **Q15 signed-in render of
Your lines owed** · **Q16 the win–loss chips are gone for every sport** · Q17
no graded-picks record in the Model section.

## Findings this run (ledgers)

SL-24 (factor units), SL-25 (the cutoff), SL-26 (no game-model row in
`model_calibration`, so the calibration note has no source), SL-27 (card vs
pick disagreement), SL-28 (`commence_time` arrives as a `Date`); U-11
(listboxes were PickLists, not Selects), U-12 (SelectBox zoomed iOS), U-13
(slip had no focus trap), **U-14 (a worn tab stalls React Aria's exit
animation — verify overlays in a fresh tab)**.

## Next: U6, then S6, then U7

U6 = the ratchets to zero in scope: `text-[Npx]` outside charts, native
`title=`, hex literals; diagnostics last (13 raw buttons, 11 tables, 16 legacy
chips). Golf's leaderboard + three hole grids onto `DataTable`. Read §8 of
`docs/design/ui-system-master-prompt.md` for the page list and
`tests/ui-primitives.test.ts` for the current ratchet numbers.

## Owed by you

- **A deploy**, only if you want any of this live. Nothing needs the worker.
- **Signed-in check of Your lines** (Q15).
- Sign-off on the queue (Q0–Q17) and the phase rows.

## Standing constraints

- Ask before deploying to Render. `git push` does not deploy.
- Never `git add -A` or `git add docs/` — `docs/discord-community-prompt.md`
  is the operator's. Add named files only.
- Prod on port 3000 serves `.next`: stop it, `npm run build`, restart
  (`linesmith-prod`) after every phase. `/kit` is dev-only — use
  `linesmith-dev-verify` (port 3001).
- **Render in a fresh tab** (Playwright `context.newPage()`); worn tabs stop
  running effects and animations.
- `/mlb` takes a while to settle; wait for data before judging a render.
- The Postgres pooler caps at 15 connections.
- At ~92% context, stop and hand off by rewriting this file.
