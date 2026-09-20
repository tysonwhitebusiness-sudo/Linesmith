# Sign-off queue

**What this is.** The operator is away for a long stretch (2026-09-20) and the
build is running unattended through `docs/design/master-gameplan-ui-and-slate.md`.
Every phase in that plan ends with "stop for sign-off". An unattended session
cannot stop, so instead of stopping it **writes the row here and keeps going**.

**How to read it.** One row per thing the operator would have been asked. Each
says what was decided, what it cost, and — the part that matters — **what
reversing it costs**, so the operator can spend their review time on the
expensive ones first.

**How to write a row.** Append; never rewrite someone else's row. Keep
`reversing costs` honest: if changing your mind means rebuilding a phase, say
so plainly rather than softening it.

**Status values:** `awaiting` · `approved` · `changed` (operator picked
differently; the follow-up commit is named) · `moot`.

---

## Decisions taken on a default

| # | phase | question | default taken | reversing costs | status |
|---|---|---|---|---|---|
| Q0 | M1 / S5 | MLB's game model is `baseline`, not `gated` — its CLV backtest puts it below the close (−0.0563 prob-pts, 38.0% positive on 305/448, re-measured live 2026-09-20 07:46) | Follow M1's display rule literally: S5 shows MLB's picks and the calibration note, **no** probability beside a price, no record | Additive — switch the columns on | awaiting |
| Q1 | S1 | CFB's green ring: every game, or only against-the-favorite picks? | Only where the pick differs from the market favorite (D9's own wording; 97% of picks ARE the favorite, so ringing all of them is decoration) | One boolean on the adapter's game row | awaiting |
| Q2 | S1 | Keep the Watchlist and Home Runs tabs, or drop them? | Keep both. S1's delete list names three other things; neither of these is on it | Deleting later is cheap | awaiting |
| Q3 | M5 | Build simple prop baselines for the five sports with none? | **Not built.** Needs approval, and the operator's 2026-09-20 instruction was games-only, props untouched | n/a — nothing built | awaiting |

## Phase sign-offs owed

| phase | what to look at | status |
|---|---|---|
| R10 / R11 / R12 | The rebuilt player, team and game research pages. Built 2026-09-17/19, pushed, never reviewed. Gates nothing in U or S | awaiting |
| M1 | **The seeded model statuses — this is the list of what the app claims about itself.** `/diagnostics` → model status, or `GET /api/model-status` | awaiting |
| M2 | CFB's calibration numbers before they drive anything user-visible | awaiting |
| M3 | One day's frozen rankings against the mockup's columns. First real receipts: 2026-09-21 | awaiting |

## Still owed by the operator (not a decision — an action)

- **Rebuild and restart the port-3000 production server.** It predates the ESPN
  range fix (2026-09-19) and will blank NFL/CFB/soccer again on its next
  rebuild. Carried since M0; nothing an agent can do.
