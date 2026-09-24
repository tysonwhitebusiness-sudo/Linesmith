# Odds workstream — build specs (one file per phase)

These are the build specs for the phases in `../odds-build-phases-2026-09-24.md`
(the order, the audit findings F1–F14, and the time rule). Each spec says
exactly what to build, in which file, with which names, schemas, thresholds
and tests, so nothing is left to guess. Each was written from the code as it
stood on 2026-09-24; where a spec cites a line number, re-check it before
editing (lines move).

**Every phase starts only on the operator's green light.** Decisions the
operator still owns are marked ⚑ and are not made by the builder.

| phase | file | lane |
|---|---|---|
| P0 Keep the data flowing | `P0-keep-data-flowing.md` | laptop |
| P1 Fix what is broken | `P1-fix-what-is-broken.md` | app + Python |
| P2 Names: labels + book registry | `P2-names.md` | app + Python |
| P3 Matching | `P3-matching.md` | laptop |
| P4 Storage decision | `P4-storage-decision.md` | measurement ⚑ |
| P5 Schema + writers | `P5-schema-and-writers.md` | DB + Python + app |
| P6 Bridge | `P6-bridge.md` | laptop |
| P7 Timing | `P7-timing.md` | laptop / Python |
| P8 Odds sections (UI) | `P8-odds-sections.md` | app |
| P9 Live | `P9-live.md` | app |
| P10 Where the money is | `P10-money.md` | app |
| P11 Edge | `P11-edge.md` | Python + app |
| P12 Alerts, slip, flags | `P12-alerts-slip-flags.md` | app + Python |
| P13 Closing-line test | `P13-closing-line-test.md` | background |

## Conventions every phase follows

**Repos and runtimes**
- line-buddy (Next.js app + `python-odds-service/`, Postgres on Supabase,
  project `qsqzercvwnzaeboltvca`). odds-scraper
  (`C:\Users\occy3\Documents\odds-scraper`, SQLite + Parquet, laptop only).
- Python tests are standalone scripts, `python -u src/test_<name>.py`, **not
  pytest**. A hermetic one (no DB, no network) is added as its own named step
  in `.github/workflows/ci.yml`'s `python` job. One that needs the database
  uses a fake id nothing real will ever emit, cleans up after itself, and is
  listed in CI's "Not run here, and why" step instead.
- TypeScript tests: `tests/<name>.test.ts(x)`, run by `npm test`
  (`node --import tsx --test`).
- The scraper's tests: `test_*.py` at its repo root, and `test_infra.py`
  groups (`r1`, `r2`, …), run with its `.venv`.

**Standing checks** on any phase that touches the app: `npx tsc --noEmit`,
`npm test`, `npm run build`, and a render at 1440 and 400 in a **fresh tab**
on every sport it touches (a worn tab stalls effects), plus the kit guards
(`tests/ui-*`). Python phases run every test they touch plus
`test_entity_resolution.py` and `test_canonical_bookmaker.py`.

**Rules from CLAUDE.md that bind every phase**
- Python writes, TypeScript renders; a GET handler never writes. New tables
  get a row in `docs/table-ownership.md` and RLS like their neighbours.
- A new API route uses `cachedRoute()` or a direct Postgres read (pattern 2);
  grep the cache key first.
- Sport adapters: no `sport === 'x'` in a shared component; one adapter file
  per sport per component; hooks stay in the component.
- A page never styles a primitive; the kit gains a prop. Colour is a fill or
  an ink, never both.
- Migrations are additive and applied by hand before the deploy that needs
  them (the pattern of `20260921120000`). Every Render deploy needs the
  operator's go and gets a row in `docs/CURRENT.md`'s Deploys table.
- Never `git add -A` or `git add docs/`; add named files.
- At ~92% context: stop, rewrite `docs/CURRENT.md`, commit, push.

**Every phase ends the same way:** the build tests pass → the phase's
background checks are started and written into `docs/CURRENT.md` (what is
running, where to read its result) → commit + push → the operator is told
and the next phase waits for the green light.
