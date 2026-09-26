# Title Case — gameplan (2026-09-26)

**Status: T0 and T1 DONE (2026-09-26). The audit is waiting on the operator:
`http://localhost:8125/title-case/` (`docs/design/title-case/`).** 976 distinct
changes in 1,478 places, 171 marked "needs a look". The operator marks
Keep/Edit, presses *Copy my decisions* and pastes the result. T2 applies it.
This work lands **before** the game page build, which is written in Title Case
from its first line.

## 1. The ask

Short text that *names* something gets Title Case. Text that *reads as a
sentence* stays ordinary sentence case.

| Title Case | Unchanged (sentence case) |
|---|---|
| Column headers and stat names: "Hit rate" → **Hit Rate** | A row's sentence ("Plays in a park scoring 25% more runs…") |
| Market names: "Batter strikeouts" → **Batter Strikeouts** | Captions, notes, `info` tooltip bodies |
| Tabs, filters, buttons, chips, legends | Empty-state explanations |
| Section, card and flag titles: "Where the money is" → **Where the Money Is** | Anything with a full stop, or more than one clause |
| Short status words: "Best price" → **Best Price** | |

## 2. The rule, exactly

One function, `titleCase()` in `lib/text/titleCase.ts`, used by the codemod and
by the guard, so the two can never disagree:

1. Capitalise the first letter of every word that is **entirely lowercase
   letters**.
2. **Small words stay lowercase** unless they are the first or last word: a, an,
   the, and, or, of, to, in, on, at, per, vs, by, for.
3. **Anything that already has a capital, a digit or a symbol is left exactly
   as it is:** HR/PA, K/9, SLG, OPS, EV, TOI, aDOT, xwOBA, L10, 3PT, +EV.
   This is what keeps "aDOT" from becoming "ADOT".
4. **Hyphenated words** capitalise each part: HR-Friendly, Pick-3, Two-Way.
5. Names from outside (teams, players, parks, books) are never touched.

Examples: "Pitcher to hit a home run" → **Pitcher to Hit a Home Run** · "HOU vs
ATH" unchanged · "Hits + runs + RBIs" → **Hits + Runs + RBIs** · "Last 10"
unchanged.

## 3. What is measured (2026-09-26)

| Where | Multi-word sentence-case label literals |
|---|---|
| `lib/` (adapters, specs, shared shapes, label maps) | ~523 |
| `components/` | ~79, plus ~72 JSX text labels |
| `app/` | ~17 |

Shared label maps each fix every page at once:

| Map | What it names |
|---|---|
| `MARKET_LABELS` and `SPORT_MARKET_LABELS` (`lib/odds/props/marketLabels.ts`) | every market name, on every page |
| `lib/slate/specials.ts`, `lib/slate/flags.ts` | Specials and flags: titles and factor labels |
| `PITCH_TYPE_LABELS`, `INSIGHT_LABEL`, `RARE_MARKET_TAB_LABEL`, `SPORT_LABEL` etc. | |
| each sport's `playerResearchSpec.ts` / `teamResearchSpec.ts` | research-card column headers |

What this does **not** need:

- **No database change.** `slate_rankings` rows hold ids, numbers and
  sentences, not titles. The flag and Special titles the UI shows come from
  TypeScript (`flagsRead.ts` reads `def.title` from `SPOTLIGHT_RANKINGS`, and skips a ranking it has no words for).
  Python's own `RankingDef` titles are never rendered; they will be matched
  anyway so the two stay alike. The audit confirms no other stored text is
  shown as a label.
- ~~No test rewrites~~ **Corrected in T1:** 42 distinct labels are named in
  20 test files (the first measure only looked for `toContain`/`toBe`). T2/T3
  update each test in the same commit as its label, by applying the approved
  list to `tests/` too, never by loosening an assertion.
- **Card and section titles look the same**, because CSS already draws them in
  capitals. Their source text still changes, which is what tooltips, screen
  readers and page titles use.

## 4. How: fix the source, not the screen

The source strings are rewritten, not transformed at render time. With a
render-time transform, the same label would read differently in a tooltip, an
aria label, a page title and a test than on screen, and there would be two
places where the words live.

A render-time `titleCase()` is used in exactly one place: text arriving from
outside that the app does not write, such as a provider's market name that
`marketLabel` doesn't know. It is applied in the adapter, never in a component.

**What counts as a label is decided by the key it sits under:**

- Title Case: `label`, `title`, `header`, `navLabel`, `name` (of a tab or
  column), `short`, and the text inside a `Button`, `Chip`, `Tabs`,
  `SegmentedToggle` or `Column` header.
- Unchanged: `info`, `caption`, `sub`, `reason`, `note`, `detail`,
  `description`, and empty-state text.
- Anything under another key, or a literal with a full stop or comma, goes on
  the **ask list** in the audit for the operator to decide, not guessed.

## 5. Phases (one session each, per the session-per-phase rule)

| Phase | What | Done when |
|---|---|---|
| **T0** | `titleCase()` and its tests (every example in §2, plus the tricky cases: aDOT, xwOBA, "vs", hyphens, digits). The codemod in dry-run mode only. | Tests pass. |
| **T1: Audit** | Codemod dry run → one page listing every change as *current → new*, its file:line and the page it's seen on, grouped by surface (Slate, player, team, game, odds, Scan, kit). The ask list is separate. | **The operator approves the list** (edits welcome). |
| **T2** | Apply to the shared maps (markets, Specials/flags, pitch types, insights) and the kit's own strings. Match Python's `RankingDef` titles. | Rendered at 1440 and 400 on the Slate, a player page, a team page and a game page. |
| **T3** | Apply to every adapter, spec and in-scope component: the rest of the approved list. | `tsc` and all tests clean. |
| **T4** | Scan, per the operator's answer to §7(b). | |
| **T5: Guard** | `tests/title-case.test.ts` runs the same codemod over the tree and fails on any new sentence-case label, with an allowlist that names each exception and says why. It reads `tests/ui-scope.ts` like the other UI guards. | The guard fails on a planted "Hit rate". |
| **T6** | The game page mockup: re-run `build-data.ts`, which picks up every adapter string for free, then do the mockup's own hand-written strings. | The mockup and the app say the same words. |

Then the game page build starts.

## 6. Risks

- **Changing a label that is really a key.** Some strings are used as both a
  label and a lookup (a market label matched back to a key, a tab label in a
  URL). The codemod only touches literals under the §4 keys. The audit flags
  any string that is also compared with `===` or used in a URL, and those are
  checked by hand.
- **Stale processes.** The worker and the laptop bridge bind their code when
  they start, so Python-side word changes appear after they restart. Harmless,
  since Python titles are not rendered.

## 7. The operator's answers (2026-09-26)

a. "Red sats" means **stat labels**.
b. **Scan is included.** Its own words change too, and T4 re-cuts the
   `slate-shell` content-hash pin for `ScanTable.tsx` and `ScanCard.tsx` for
   this change only.
c. **Section subtitles start with a capital** and otherwise stay sentence case
   (`sentenceStart`).
d. **"vs" stays as it is.** It is lowercase even as the first word, and so are
   "v" and the units (mph, ft, yds, lbs, x).

## 8. What T0/T1 found that the plan did not expect

- **The Specials' titles are pinned across languages:** `specials.ts` says a
  test reads `slate_rankings.py` and compares the titles. The audit lists
  Python's `RankingDef` titles (46) beside the TypeScript ones, and T2 changes
  both in one commit.
- **Tests name labels:** 42 labels are named across 20 test files (see §3).
  The audit flags each one ("a test names this text").
- **Units and "v":** the first dry run made "mph" into "Mph" and tennis's "v"
  into "V". The rule now keeps them lowercase (tested).
- **Words split by values in JSX** ("Back to {name}") are read as one string,
  or the pieces came out as "Back To".
- **/kit is left out:** it is dev-only, and its demo text ("sm pill") is not a
  label anyone reads.
