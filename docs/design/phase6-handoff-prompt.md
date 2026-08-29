# Phase 6 handoff — resume prompt

**Written 2026-08-29.** Paste the "Prompt to use" block below into a fresh
Claude Code session on the other account. Everything above it is context for a
human deciding whether the prompt is still right.

---

## Where we actually are

Phase 4 and 5 are signed off. **Phase 6 is unblocked and has a design direction
but zero implementation.** `docs/CURRENT.md` §6 is the authoritative record;
this file exists so the next session does not have to re-derive the reasoning.

What happened this session, in order:

1. Explained what Phase 6 does (`docs/audit-remediation-plan.md` §6.1–6.12).
2. The operator redirected: the priority is **"rich per-player and per-team
   data"** — extensive stats, all in one place, premium graphs rather than raw
   numbers, and a UI that feels premium.
3. Agreed the direction: **a shared chart primitives library before any feature
   chart.** Eleven primitives, listed in `CURRENT.md` §6.
4. Built a mockup, published as an artifact.
5. **The operator rejected the first composed Player Detail** — *"doesn't have
   any stats / not nearly as in depth from a stats and visual standpoint."*
   Rebuilt it at real depth (~190 numbers on one page). Operator: *"I'm a fan of
   the page."*
6. **Operator raised the open question that stopped work here:** *"concerned
   with how we will get an every other sport equivalent."*

## The open question, stated precisely

The deep Player Detail is **MLB only**, and MLB has by far the richest public
data of the eight sports this app covers (MLB, NFL, NBA, NHL, CFB, soccer,
tennis, golf).

The architectural tension:

- `CLAUDE.md`'s sport-adapter convention says there is **one canonical
  `PlayerDetailData` interface**, declared in the MLB adapter
  (`lib/sports/mlb/adapters/playerDetailAdapter.ts`), and every other sport's
  adapter imports it.
- Rule §4 says genuinely different UI gets **named mutually-exclusive fields**,
  rendered behind a presence check, never a `sport === 'x'` branch.
- Rule §2 says a sport with no equivalent sets the field `null` and the
  component renders nothing.

Apply that naively to a deep MLB page and the other seven sports render **mostly
empty pages** — which is exactly the operator's worry. A page with nine of
fourteen sections missing does not read as "this sport has less data," it reads
as broken.

**This is a design question before it is a code question, and it is not
answered.** Do not start building the library until there is an answer the
operator has signed off on.

### Three candidate shapes (not yet evaluated — starting material only)

1. **Per-sport section manifest.** `PlayerDetailData` carries an ordered list of
   section descriptors rather than a fixed slot set; each sport's adapter
   declares which sections it populates and in what order. The component renders
   the manifest. Empty pages become impossible because a sport only declares
   what it has — but the layout stops being uniform across sports, which may or
   may not be acceptable.
2. **Common spine + sport extensions.** Identify the sections *every* sport can
   genuinely fill (identity, market, line movement, distribution vs line,
   rolling form, splits by home/away and opponent, game log, book dispersion,
   model contributions — all derivable from `player_game_history` + `prop_odds`,
   which are sport-generic), and treat the MLB-shaped extras (pitch mix, strike
   zone, platoon, park factors) as a declared extension block. Every sport gets
   a full-looking page; MLB gets more.
3. **Per-sport depth audit first.** Before deciding, actually measure what data
   exists per sport — what's in `player_game_history.stats` JSONB for each, what
   ESPN gives per sport, what each sport's adapter already fetches. The answer
   may be that NFL/NBA are nearly as rich as MLB and only tennis/golf are thin,
   which would change the shape of the fix.

**Recommendation to the next session: do (3) first.** It is the only one that
starts from measurement rather than assumption, and `CURRENT.md` §4's standing
lesson — *"the plan's own task text goes stale, repeatedly. Measure before
implementing"* — applies directly. `player_game_history` is generic across
sports and already populated; a few queries will say how deep each sport can go
before anyone designs anything.

## What already exists to build on

- **Artifact:** https://claude.ai/code/artifact/845e36d0-037c-4859-af5b-185a6aba795c
- **Source, committed:** `docs/design/chart-grammar.html` — self-contained, no
  build step, no dependencies beyond a Google Fonts link. All eleven primitives
  are implemented in plain SVG in that file's `<script>` blocks and are close to
  directly portable into React.
  - To view: open the file, or copy it to `C:/Users/occy3/Downloads` and run the
    `design-preview` config from `.claude/launch.json` (port 8123).
  - To update the published page: call `Artifact` **passing that URL as `url`**,
    or it forks into a separate artifact.
  - It is deliberately ASCII-only (entities in markup, `\uXXXX` in script) —
    the artifact wrapper owns `<head>`, so there is no `<meta charset>` to rely
    on. Keep it that way or the page renders mojibake.
- The primitives already respect: ≤24px bars with a 4px rounded cap square at
  the baseline, 2px surface gaps, 2px lines, ≥8px markers with a 2px surface
  ring, solid hairline grids (never dashed — dashes are reserved for real
  thresholds), legends for ≥2 series, selective direct labels, sample sizes
  always shown beside a rate, and a table-view twin on the dense charts.

---

## Prompt to use

> I'm resuming Phase 6 of the Linesmith project (`C:\Users\occy3\Documents\line-buddy`).
>
> Read `docs/CURRENT.md` first — §6 is the Phase 6 design direction agreed in the
> previous session — then `docs/design/phase6-handoff-prompt.md` for the open
> question, and `CLAUDE.md` for the sport-adapter and table-ownership conventions.
>
> Context: we agreed to build a shared chart primitives library
> (`components/charts/`) before any Phase 6 feature chart, and I approved a
> mockup of a full-depth MLB Player Detail page — source at
> `docs/design/chart-grammar.html`, published at
> https://claude.ai/code/artifact/845e36d0-037c-4859-af5b-185a6aba795c
>
> **My open concern, and what I want to resolve first: how do we get an
> equivalent for every other sport?** The mockup is MLB-only and MLB has the
> richest data. I don't want NFL/NBA/NHL/CFB/soccer/tennis/golf player pages that
> are mostly empty because they lack MLB's pitch-mix and strike-zone data.
>
> Start by **measuring, not designing**: for each of the eight sports, find out
> what player-level data actually exists today — what's in `player_game_history.stats`
> (it's JSONB and sport-generic), what each sport's adapter already fetches, what
> `prop_odds` covers per sport, and which of the eleven primitives each sport
> could genuinely fill. Report that as a per-sport coverage matrix before
> proposing any design.
>
> Then propose how `PlayerDetailData` should absorb this without either (a) a
> `sport === 'x'` branch inside the shared component, or (b) seven sports
> rendering mostly-null pages. `docs/design/phase6-handoff-prompt.md` lists three
> candidate shapes I have not evaluated yet — treat them as starting material,
> not a shortlist.
>
> Don't write implementation code until I've picked a direction. Note that the
> database is a shared 15-connection pooler, so check for other running processes
> before anything DB-heavy.

---

## Also carried, lower priority

- Two design-system findings from this session are recorded in `CURRENT.md` §6:
  the `FILL_STOPS` amber-midpoint problem (with the CVD validator numbers), and
  `card` being darker than `paper` in `tailwind.config.ts`. Neither blocks Phase
  6; both should be decided before the primitives harden around them — the ramp
  one especially, since every primitive reads from `lib/ui/heat.ts`.
- `CURRENT.md` §7 item 1 — the duplicate React key that can silently omit prop
  rows — is still unowned, one line, and pre-existing.
