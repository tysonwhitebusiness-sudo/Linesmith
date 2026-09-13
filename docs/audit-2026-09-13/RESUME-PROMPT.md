# Resume prompt — card & data-depth audit (2026-09-13)

Paste everything below the line into a fresh session on any account.

---

I'm resuming a card and data-depth audit of this repo. Read `CLAUDE.md` first,
then `docs/CURRENT.md`, then the four audit docs below **before doing anything**.

## Where the work is

Audit of all sport player/team/game pages, run 2026-09-13. **Phases A, B and C
are COMPLETE. Phase D is PROPOSED and awaiting my approval. No code has been
changed — every phase was log-only by my instruction.**

    docs/card-audit-plan-2026-09-13.md          the approved plan
    docs/audit-2026-09-13/phase-a-data-depth.md  what data exists vs what pages read
    docs/audit-2026-09-13/phase-b-read-paths.md  what actually fires, rendered
    docs/audit-2026-09-13/phase-c-card-verdicts.md  per-sport card sense
    docs/audit-2026-09-13/phase-d-remediation.md    proposed fixes, needs approval

**Do not restate these back to me.** Read them, then tell me what you'd do next
and wait.

## Decisions I already made — do not reopen

- **Scope:** all three surfaces (PlayerDetail, TeamDetail, GameDetail). 21
  sport-surface combinations, not 24 — golf has no team or game adapter, tennis
  has no team adapter.
- **Log everything, fix nothing** during A–C. That rule ends at Phase D, which
  needs my explicit sign-off before any code changes.
- **Golf is HELD** until a live tournament. It has been unassessed for three
  phases. Do not score it blind.
- **NBA/NHL verdicts are provisional** — both were offseason on audit day.
  Re-score in October.

## The findings, compressed

**The deep history exists and the frontend cannot see it.** `game_result` holds
184,108 rows — NFL from 1999, NBA/NHL 2007, MLB 2010, MLS 2012, CFB 2013, EPL and
tennis 2015 — and `grep -rn "game_result" lib/ app/ components/` returns
**nothing**. Python-only. Separately, `player_game_history` holds only 2–4
seasons per sport (~766k rows, **not** the 2.75M its own doc comment claims).

**The MLB-grid hypothesis is true at the API layer, false at the adapter layer.**
MLB's games-strip objects carry 25 fields; every other sport carries the same 5 —
and the start-time field is named `firstPitch` in tennis, soccer, NFL and CFB.
But TeamDetail and GameDetail adapters are genuinely well-unified.

**Highest severity-to-effort item: the WTA page shows men's matches.**
`espnTennis.ts:53` iterates every ESPN grouping with no slug filter; the correct
filter already exists in `schedule.ts:279` reading the same endpoint.

**Best ratio group: parts that exist but aren't wired.** Five LiveTab components
(`Nba`, `Nhl`, `Football`, `Soccer`, `Tennis`) are built and wired into
GameDetail only — `PlayerDetailData.liveGame` is MLB-only. Tennis surface exists
for 56,386 matches in `game_result` and never reaches the page. `seasonStatus` is
populated and unread, so NBA's offseason header renders `0-0 · 0th seed`.

**One card, two sport-named fields.** `hitterStats` (MLB only) and
`nflSeasonStats` (**nfl, cfb, nba, nhl, soccer**) render the same season-stats
card. This is a fresh worked example of `CLAUDE.md` §4's port-artifact pattern.

**CFB pages are entirely blank while CFB is playing** — two independent faults,
see overlap warning below.

## Overlap warnings — read before acting

- **CFB provider coverage is ALREADY a PARKED item** in `docs/CURRENT.md`. My
  B1 finding adds two things that section does **not** cover: the `cfb:snapshot`
  rebuilds on schedule but produces **ten-day-old content** (payload lists games
  dated 2026-09-03/04), and `refreshCfbJob` reports **cold tier, zero requests**
  against a 146-game live slate. Everything about harvester cost and SharpAPI
  429s is already known and parked — don't re-derive it.
- **`provider_matrix.py` records that Propline's absence from CFB is
  DELIBERATE** (1+N requests vs SharpAPI's 1). Do not "fix" it.
- **Phase 7 (NBA prop model) is ACTIVE in another session**, with an approved
  6-step gameplan. **Phase 5 (egress) is OPEN**, monitoring only. This audit is a
  parallel thread — **do not rewrite `docs/CURRENT.md`**, you would destroy
  another session's baton. Add a section if you must.

## Measurement traps this audit actually hit — you will hit them too

- **`fetchedAt` inside a snapshot payload is NOT the cache write time.** MLB's
  payload reads 2026-09-11 while `snapshot_cache.fetched_at` reads the same day
  as the audit, and the page renders live games. Judging freshness by the
  in-payload stamp produces a false "six sports are stale" finding.
- **A cache can rebuild mid-audit.** `/api/nba/teams` returned `ATL 46-36` and
  then `ATL 0-0` an hour later — season rollover, not a wiring bug. Re-fetch
  anything you are about to write down.
- **Static greps cannot tell which cards render.** An attempt to build a field
  matrix by grep claimed only MLB sets the *required* `chart` field, which is
  impossible. Fields are set via variables, shorthand and spreads. **Render the
  page.** Soccer's 259-game career history was invisible to every static read and
  only appeared on screen.
- **The calendar decides what an empty card means.** On audit day MLB/NFL/soccer
  were in season, NBA/NHL were not. Establish the calendar before judging any
  empty card.
- Cross-check any windowed rate against the lifetime rate before believing it —
  `docs/CURRENT.md` documents two false conclusions from this.

## Standing constraints

- Postgres pooler caps at **15 connections** — check for running model fits
  before any DB work.
- **Ask before deploying to Render.**
- **Never `git add -A` or `git add docs/`** — `docs/discord-community-prompt.md`
  is mine.
- Python tests are standalone: `.venv/Scripts/python.exe <file>.py`.
- At ~92% context, stop and hand off.

## What I want next

Read Phase D's recommended sequence and tell me which group you'd start with and
why. **Do not start writing code until I say go.** If you disagree with the
sequence, say so before starting, not after.
