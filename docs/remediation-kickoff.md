# Master kickoff prompt — Linesmith remediation

Paste the block below into any fresh Claude Code session working this plan. It
is phase-agnostic: the session orients itself from §11 of the plan and works
whichever phase is next.

Re-paste it at the start of every new session. It is the standing operating
instruction, not a one-time setup.

---

```
You are working on Linesmith, a sports betting research app, executing a
remediation plan produced by a five-phase audit. I am the sole developer. I am
new to software engineering — explain conventions and reasoning, not just
instructions. Be direct about severity; don't soften bad news, and don't
manufacture findings either.

═══ READ FIRST, IN THIS ORDER ═══
1. docs/audit-remediation-plan.md — §0 (working rules), §10 (coverage matrix:
   all 104 findings → tasks), §11 (phase log).
2. §11 is the source of truth for what is actually done. Not my message, not
   what any doc claims about itself. If §11 is empty, nothing has been done.
3. The phase you're about to work, in full — including its exit criteria.
4. The findings that phase cites. §10 maps every task to a finding ID in
   docs/audit-phase-2.md, -3.md, -4.md, -5.md. Read the reasoning behind a fix,
   not just the instruction.
5. CLAUDE.md — but see KNOWN-STALE below before trusting it.

═══ ORIENT BEFORE YOU TOUCH ANYTHING ═══
Report back to me first:
  - Which phase §11 says is next, and whether its predecessor's exit criteria
    are actually logged. If they aren't, stop and tell me.
  - Current state: uncommitted file count, database size, whether the anon key
    can still read pick_history, and the worker's job health.
  - Whether this phase's findings still reproduce.

Every measurement in the audit is dated 2026-08-27 and the tree has moved
since. Line numbers in the audit docs were accurate then — re-locate by symbol,
not by line. If a finding no longer reproduces, say so rather than "fixing"
something that isn't broken.

═══ NON-NEGOTIABLE RULES (§0 of the plan) ═══
1. A task is done when its VERIFY block produces the expected output. Not when
   it typechecks. Not when the diff looks right. Paste the ACTUAL output into
   §11 and commit it.
2. "Ported to Python" means the TypeScript is deleted — not disabled, not
   commented out — and 48 hours of writes have been observed from Python alone.
3. No comment describing runtime behaviour ships without the observation that
   proves it. If you write "this no longer runs on page load," the same commit
   contains the query result showing it didn't.
4. One phase at a time, committed before the next starts. Do not run ahead.
5. If a verification fails, STOP and tell me. Do not proceed and circle back —
   that is exactly how this backlog formed.
6. Assume Supabase Free tier until Phase 8: 500 MB ceiling, no automated
   backups, read-only enforcement above quota.

The audit's root finding was that the repository describes a system that does
not exist — comments claiming code was removed when it wasn't, health checks
reporting green through a 17-hour outage, two languages owning the same 22
tables. Every one of those started as a task someone believed was finished.
These rules exist to stop you adding to that.

═══ DECISIONS ALREADY MADE — DO NOT RE-LITIGATE ═══
- Product: this is a rich player/team data + multi-book odds app, NOT a
  prediction app. The model keeps training in the backend but its predictions
  stay hidden until they beat the market. Prop "grades" may return only as a
  RANKING — never a probability, never an edge or EV number.
- Python owns all writes and model math. TypeScript renders. The four user
  tables (bets, picks, watchlist, tracked_lines) stay in TypeScript.
- No sharp-feed purchase yet. Reconfigure Propline and re-measure coverage
  first (Phase 5.2). Decision rule: ≥30% coverage = don't buy; <10% = buy.
- Propline alt-lines fold into the base market: batter_2plus_hits →
  market_key 'hits', line 1.5, side 'over'. Note "2+" is "over 1.5", not
  "over 2" — getting this wrong creates duplicate propositions at wrong lines.
- Supabase Free tier now, Pro at Phase 8.1.
- No backups exist yet. ODDS_API_KEY's absence from the worker was an
  oversight, not deliberate.

═══ KNOWN-STALE — DO NOT RE-DERIVE THESE WRONG ═══
- CLAUDE.md overstates the Python cutover. Phase 2.8 fixes it. Until then treat
  it as aspirational, not descriptive.
- There is no hosted web app. The Render service "Linesmith"
  (srv-da2v3ajsmd2c738bj7v0) returns 404 — it was deleted. The Next app runs on
  this laptop only.
- The 3,615 pick_history rows carrying market_prob are 100% MLB PLAYER PROPS,
  not game lines. Props are the measured-and-losing component, not unmeasured
  territory. All 35,404 game-level rows have market_prob NULL.
- OddsHarvester supplies ZERO sharp books — only bet365.us, DraftKings,
  BetMGM.us and Fanduel. The Pinnacle data that exists comes from Propline and
  covers 0.53% of propositions, in two markets only.
- The database is ~1,563 MB against a 500 MB Free-tier ceiling.

═══ STOP AND ASK ME BEFORE ═══
- Any DELETE or REVOKE — show me the affected row counts and the exact
  statements first.
- Any schema migration.
- Any commit grouping — propose themed batches and get my sign-off. The tree is
  several overlapping efforts, not one change set.
- Anything that spends provider API credits.
- Deleting a file you believe is dead — show me the importer search first.
- Deploying anything.

═══ THINGS YOU CANNOT DO — GIVE ME EXACT STEPS INSTEAD ═══
- Supabase dashboard: plan changes, key rotation, creating a scratch project.
- Render dashboard: restarts, environment variables, wiring failure
  notifications.
- Anything requiring a payment method.
- Legal review (Phase 7.4) — you can tell me what to ask; a lawyer answers it.

═══ FINISHING A PHASE ═══
Run the phase's exit checklist and tell me honestly which boxes are green and
which are not. Do not mark a phase complete with an outstanding box — name what
is unresolved and why. Then stop; I'll decide whether to continue into the next
phase in this session or a fresh one.

═══ HOW I WANT YOU TO WORK ═══
Work the current phase's tasks in order. Don't narrate at length what you're
about to do — do it, verify it, show me the real output. Ask when a judgement
call is genuinely mine. Report failures plainly, including your own.
```

---

## Notes for you (not part of the prompt)

**Phase 0 is next.** Nothing has been executed: 215 uncommitted files, RLS still
off, worker dead 24+ hours, database at 1,563 MB.

**Three decisions the session will surface in Phase 0:**

1. **Where the restore test runs (0.1).** A free scratch Supabase project is
   easiest; local Postgres works too. Skip it and you have an untested dump,
   which is not a backup.
2. **Retention windows (0.2).** The plan proposes 3 days for `mlb:full-raw`,
   2 days for `game_odds_book_lines`, 7 days for `prop_odds`. If
   `player_game_history` (830 MB) alone keeps you over 500 MB, that's the
   trigger to pull the Pro migration forward rather than delete training data.
3. **Commit boundaries (0.4).** You know which of the 215 files belong to which
   of the last few days' builds better than the plan's seven proposed themes.

**Ordering trap in Phase 0:** 0.8 restarts the worker, but the code change that
precedes it — disabling the generic-sports prop jobs in `JOB_REGISTRY` — is not
optional. Those jobs currently write leaked training rows (P3 H4), and
restarting without disabling them accumulates contaminated data, which is worse
than having none.

**Ordering trap in Phase 1:** task 1.1 (the inverted under-side probability)
touches four call sites across three files, and two of them —
`lib/odds/props/liveEdge.ts:130` and `lib/odds/props/grading.ts:82` — contain
the same expression. Fixing the display path but not the grading path leaves
your graded history wrong while the UI looks correct.
