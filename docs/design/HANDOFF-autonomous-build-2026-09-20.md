# Handoff — the unattended run, 2026-09-20

**Paste this whole file as the first message of the new session.** It is written
to be the prompt, not a document about the prompt.

---

## What you are doing

You are continuing a build that is fully gameplanned. The operator is away for
**hours** and has asked you to keep building the whole time.

**In a perfect world you finish the entire gameplan before they are back.** That
is the target. It is a lot of work — fourteen numbered phases — and finishing
all of it is genuinely possible because every one of them is already specified
down to "what to read, what to build, what done means, what test it adds". You
are not designing. You are building what is written, carefully, one phase at a
time, and testing between every step.

**Second best, and still a good run: fewer phases, each of them actually
finished and verified.** A phase built and rendered and committed is worth more
than three phases half-built. Do not sacrifice the per-phase discipline to reach
a higher number. Nobody is counting phases; the operator is going to open the
app.

## Read these first, in this order

1. `CLAUDE.md` — repo conventions. Non-negotiable. The sport-adapter section and
   the API-route caching section both apply to nearly everything you are about
   to build.
2. `docs/design/master-gameplan-ui-and-slate.md` — **the plan.** §2 is the
   standing rules for every phase, §4 is the build in order, §5 is the phase
   table you update as you go, §6 the open questions (each now carries a
   default), §7 the findings ledger.
3. `docs/design/ui-system-master-prompt.md` — the U track's spec. The gameplan
   wins on order and scope; this file wins on detail.
4. `docs/design/slate-sheet-cards.md` — the S track's spec, including §4's
   per-sport measurements of what data actually exists.
5. `docs/design/slate/slate.html` — the approved mockup. Open it. This is what
   the Slate is supposed to look like.
6. `docs/design/SIGNOFF-QUEUE.md` — where your decisions go instead of stopping.
7. `docs/CURRENT.md` — the baton. Where everything stands.

## The one rule that is different this run

**Every phase in the plan says "stop for sign-off". You do not stop.**

Instead: take the decision, write a row in `docs/design/SIGNOFF-QUEUE.md` naming
the question, the default you took, the files it touched and **what reversing it
costs**, and move to the next phase. The four decisions already in front of you
have defaults recorded in the gameplan's §6 — read them before you need them, so
you recognise the shape: pick the reading whose reversal is a small named edit,
never the one that would require rebuilding a phase.

This is the only rule that relaxes. Everything else tightens, because nobody is
watching.

## What genuinely stops you

This list is exhaustive. If it is not on here, decide it and keep building.

1. **A Render deploy.** The standing rule is ask first, and the operator cannot
   answer. **Good news: phases 5–18 all say `deploy: no` in the phase table.**
   The whole U and S track is frontend and needs no worker deploy. If you find
   something that genuinely needs one, leave it built-and-committed but
   undeployed, write the row, and continue with the rest.
2. **Anything destructive or outward-facing** — force-pushing, deleting a table,
   dropping data, posting anywhere, touching production config. Write the row.
3. **A phase whose premise is measurably false.** Three of the M-phase task
   premises turned out to be wrong when someone actually measured them. If you
   read a phase and the data says it is built on something untrue, do not build
   it anyway and do not quietly redesign it: write what you measured into the
   findings ledger (§7), skip that phase, and go on to the next one. Say so
   clearly in the final write-up.
4. **Two phases in a row failing verification for reasons you cannot diagnose.**
   Stop building forward, write down precisely where it broke and what you
   tried, and spend the remaining time on the diagnosis rather than stacking
   more broken work on top.
5. **~92% context.** Hand off: rewrite `docs/CURRENT.md`, commit, push. Do not
   start a phase you cannot finish before that line.

## The loop, for every phase

From the gameplan's §2, and it is not optional:

- read the phase and its spec section
- build
- `npx tsc --noEmit`
- the phase's tests, plus the existing suite
- `npm run build` (with `LB_DIST_DIR=.next-verify` if a dev server holds `.next`)
- **render it** and compare against the mockup
- commit by explicit path
- update the phase's row in the gameplan's §5 table, and add a queue row if you
  decided something
- next phase

**"Render it" means open the page.** A fresh browser tab (`tabs_create` — worn
tabs stop running effects, and a "nothing loads" finding has already turned out
to be that rather than a real bug), at **1440 and 400**, for **every sport the
phase touches**: MLB, NFL, CFB, EPL, MLS, NBA, NHL, ATP, WTA, golf. A sport out
of season renders its real empty state; name it in the write-up. A test built on
the same wrong model as the code will agree with the bug — the render is what
catches that.

## Constraints that do not bend

- **`git add` by explicit path. Never `git add -A`. Never `git add docs/`** —
  `docs/discord-community-prompt.md` is the operator's own file. Name each file.
- **The Scan table does not change.** `ScanTable.tsx` and `ScanCard.tsx`:
  columns, cells, colors, heat, rank chips, row layout — frozen (D3). Everything
  *around* it may change. U0's mechanical Tailwind conversion is the one allowed
  edit. Add the content-hash guard in S1 as the plan says.
- **The model vocabulary is internal.** `baseline`, `gated`, `simple`,
  `advanced`, "not validated" — these are how *we* decide what a page may show.
  **None of them may appear on a customer surface.** The operator was blunt
  about this. `/diagnostics` is the one exception, because it is their page.
  M1's spec originally said the opposite; it is struck through and corrected in
  the gameplan, but if you find any other copy of that instruction, the
  operator's version wins. Add the guard test in S1.
- **No edge, anywhere.** `Model %` may sit beside `IP` only where the register
  says `gated`, and nothing computes, sorts by or colors the difference
  (`tests/scan-no-edge.test.ts`). Movement, price gaps and rankings are captioned
  as market information, not predictions.
- **Do not touch player props.** The model work that just finished was about
  **games only** — the operator said so directly. Render the prop data that
  exists; build no prop model, change no prop math, and do not "improve" a prop
  surface on your way past.
- **Python writes, TypeScript renders.** No GET handler writes. New tables get a
  `docs/table-ownership.md` row.
- **Routes go through `cachedRoute()`, and you grep the cache key first.** One
  flat `snapshot_cache` table, no namespacing — a collision type-checks cleanly
  and only shows up as a wrong response body.
- **Sport adapters, never `sport === 'x'`** inside a shared component. One
  adapter file per sport. A sport with no data for a section leaves it unset and
  the section hides.
- **Subtract in the same phase.** Replacing something deletes the old thing in
  the same commit.
- **Check the pooler before DB work.** 15 connections, shared; a harvester cycle
  or a model fit may be holding them.

## The phases, in order

From the gameplan's §5. Phases 1–4 are **done and deployed**; you start at 5.

| # | phase | what it is | watch for |
|---|---|---|---|
| 5 | **U0** | Tailwind 3.4 → 4, tokens into `@theme`, the Untitled UI bridge, `react-aria-components`, `tailwind-merge`, the `/kit` page skeleton | Touches nearly every file and **must not move a single pixel.** Before/after one `/{sport}` page per sport. The six traps in the U spec §9 are real |
| 6 | **U1** | Buttons | The table footer uses them, so it comes before U2 |
| 7 | **U2** | The Hybrid `DataTable` | The biggest visual change. Its kit fixtures gain the Slate's tables, so S1–S5 build on proven columns |
| 8 | **U5** | Borrowed pieces — `Chip.dot`, `AvatarLabel`, `FeaturedIcon`, `Tabs.count`, `Card.count`/`flush`, `SegmentedToggle` | Moved ahead of U3/U4 because the Slate needs them |
| 9 | **S1** | Scan's body becomes the Slate: chrome, `SectionNav`, Games, Props | The chrome is **unchanged** — `TopBar` (tab renamed Scan→Slate, keep `?tab=Scan` as an alias) and the date strip with the game scroller. No second sport picker, no date control, no page title. The table mounts unchanged under rebuilt controls |
| 10 | **S2** | Movers, Price outliers, Line disagreements | The opener is **not held** — "since first seen" is the truth and the caption must say so. A test asserts "since open" never appears |
| 11 | **S3** | Spotlights | Reads `slate_rankings` (live since this morning). Every factor is a column with an `info` tooltip naming its source |
| 12 | **S4** | Specials and receipts | Receipts grade the frozen **top 5** (D10). First real receipts exist 2026-09-21 |
| 13 | **S5** | Model section and Your lines | MLB only, under Q0's default. **Delete `TodaysPicksModal` and its button** |
| 14–15 | **U3, U4** | Form controls, overlays | Independent of the Slate; may interleave |
| 16 | **U6** | Page sweep | Needs U1–U5; now also sweeps the Slate. Scan's frozen files stay on `OUT_OF_SCOPE`; diagnostics last |
| 17 | **S6** | Slate close | Every sport, every section, both widths, in- and off-season states, against the mockup |
| 18 | **U7** | UI close | Remove the remaining allowlists, finish the kit page, `CLAUDE.md` gains the UI primitives section |

## Traps already measured in this codebase

Do not rediscover these:

- **A fresh tab for every render.** Worn browser-pane tabs stop running effects.
- **Diff the bytes, not the status code**, when you add a route. A cache-key
  collision returns 200 with the wrong shape.
- **ESPN rejects team-sport date ranges** (since ~2026-09-15) and silently
  returns 25 events for `limit` above ~500. Both are fixed and guarded; do not
  reintroduce either.
- **Stale and exchange quotes are in the data** — a +10000 moneyline and a `0`
  price were both live on 2026-09-19. S1's read rule drops `|odds| < 100` and
  anything more than 15 implied points from the median (SL-1).
- **NHL ids in `game_odds_history` are NHL API ids, not ESPN's** (SL-4) — the
  S1 adapter has to bridge them.
- **A port artifact looks exactly like a real difference.** Two of the three
  examples in `CLAUDE.md`'s own §4 turned out to be "whichever sport was ported
  first", not genuine data differences. Before adding a named field for a
  difference between sports, ask whether the sports differ **in the data**.

## When you are done, or when you run out of room

Write the final message for someone who has been away for hours and will read it
before opening anything. It needs, in this order:

1. **What renders now that did not before** — the operator's actual question.
2. **Phases finished**, and where the run stopped.
3. **The sign-off queue**, pointed at, with the expensive rows called out by
   name: which decisions would cost real work to reverse.
4. **What broke**, faithfully. A phase you skipped and why. A test that fails.
   A premise that measured false. Do not round these off.
5. **What is owed by them** — the port-3000 rebuild is still outstanding, and
   any deploy you could not do.

Then rewrite `docs/CURRENT.md` (rewrite, do not append), commit by explicit
path, and push.
