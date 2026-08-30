# Phase 6 handoff — resume prompt

**Rewritten 2026-08-29.** Supersedes the previous version of this file entirely,
which asked "how do we get an every-other-sport equivalent?" — that question is
now measured, answered and built three times over.

**State at handoff:** Phase 6 is fully planned and unblocked. Four mockups
committed, a data-gap audit committed, and `docs/audit-remediation-plan.md`
Phase 6 rewritten as the plan of record (24 tasks, four tracks). Operator
decisions taken: officials **cut**, tennis point-level **cut**, NBA/NHL shot
coordinates **approved**. No production code written yet.

The next session's job is to surface *every* remaining question in one pass, so
the operator can answer them all at once instead of being interrupted per task.

---

## Prompt to use

> I'm resuming Phase 6 of the Linesmith project (`C:\Users\occy3\Documents\line-buddy`).
>
> Read `docs/CURRENT.md` first, then `docs/audit-remediation-plan.md` **Phase 6**
> — that's the plan of record, rewritten 2026-08-29 into 24 tasks across four
> tracks. Supporting detail is in `docs/design/phase6-data-gap-audit.md` and the
> four committed mockups in `docs/design/` (`chart-grammar.html`,
> `player-detail-per-sport.html`, `team-detail-per-sport.html`,
> `game-detail-per-sport.html` — open them, they're self-contained).
>
> **Before writing any code, scan the whole of Phase 6 — all 24 tasks and the
> gate — and give me one consolidated list of everything that needs me.**
> Specifically:
>
> 1. **Decisions only I can make** — anything where two reasonable
>    implementations differ in a way that changes the product, or where a task
>    implies spending money, adding a vendor, or changing something user-facing.
> 2. **Blockers** — anything that can't start because it depends on access,
>    credentials, a purchase, a running process, or another task landing first.
>    Include the dependency order where it matters.
> 3. **Stale or wrong plan text** — the plan was written fast. Verify its claims
>    against the code and database rather than trusting them, and flag anything
>    that no longer holds. Past sessions have repeatedly found the plan's own
>    task text had gone stale.
> 4. **Anything you'd flag as risky, underspecified, or likely to be re-litigated
>    later** if we just started building it.
>
> Ask everything in one batch. I'd rather answer twelve questions now than be
> interrupted twelve times.
>
> Don't start implementing until I've replied. Two things to know while you
> scan: the database is a shared 15-connection pooler and a `next dev` server is
> already holding connections, so check before anything DB-heavy; and
> `docs/discord-community-prompt.md` is mine — never stage it.

---

## Two things the next session should not have to rediscover

- **Both chart-primitive fixes are unported.** `zoneGrid` (MLB number format,
  domain and caption hardcoded) and `rollingChart` (forced zero-based y-axis)
  are fixed in `docs/design/build-lib.mjs` only. `chart-grammar.html` still holds
  the unfixed originals, and neither fix exists in React yet. Task 6.4 carries
  them across; the gate checks for both.
- **The mockups' data is representative, not live** — the frame says so. They are
  a specification for layout and roles, not a source of numbers.
