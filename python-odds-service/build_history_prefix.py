"""Phase 5 — precompute the STATIC half of the history summary, off the worker.

    python build_history_prefix.py            # report; writes nothing
    python build_history_prefix.py --apply

WHY THIS EXISTS. `mlbHistorySummaryJob` used to build `player_history_summary`
from a UNION of the Parquet corpus and the Postgres hot window, and that corpus
read was the largest single step in the Render worker's memory climb — traced
across one worker lifetime on 2026-09-11: **272 MB before the job, 390 MB after,
+118 MB in one job, never released**. `corpus_store` had already measured why
(CPython does not return freed arenas to the OS) and barred the corpus EXPORT
from the worker for exactly that reason. The summary's corpus READ was never
costed the same way when 5.S.2 put it there.

Worker RAM is one of Phase 5's three ceilings, and it was the one that got WORSE
during the phase: 385 MB peak at the start, 489 resting / 560 peak by the end.

THE OBSERVATION THAT MAKES THIS EXACT RATHER THAN APPROXIMATE. The corpus half
never changes. `player_game_history` is pruned to a hot window and every game
before it is finished forever, so its contribution is static — compute it once,
here, and the daily job becomes a pure Postgres read of prefix + hot window.

All six aggregates decompose additively across the split:

    events, volume, games, baseline_over, baseline_total   ->  sum
    recent_volume                                          ->  (prefix ++ hot)[-MAX_RECENT:]

The concatenation is valid only because the prefix is ENTIRELY earlier than the
hot window, which is what `cutoff` pins down and why it is stored rather than
implied.

IT REPRODUCES THE UNION PATH'S BEHAVIOUR, INCLUDING A WART. `load_start_keys`
reads `player_game_history` from POSTGRES, which since 5.2d holds only the hot
window — so under the union path a pitcher market's baseline already counted
only hot-window starts, while its events/volume/games came from lifetime
history. That is not a rate error (numerator and denominator are gated
identically) but it IS an inconsistency, and this reproduces it exactly rather
than quietly fixing it, because the gate for this change is "the summary does
not move". Fixing it is a separate, deliberate decision.

WHERE THIS RUNS: THE OPERATOR'S MACHINE, beside `refresh_corpus.py`. It reads
the corpus, so it carries the same ~300 MB cost that is the whole reason the
worker must not. Re-run it when the hot window moves — i.e. after a
`prune_player_history` — and not otherwise; nothing else can change its answer.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))

import db                                                     # noqa: E402


async def main(apply: bool) -> int:
    from predict import count_prop_engine as eng
    from predict.mlb_board_lines import BOARD_LINES
    from predict.mlb_props import BY_SLUG, load_game_history_parquet, load_start_keys

    pool = await db.get_pool()
    async with pool.acquire(timeout=1800.0) as conn:
        await conn.execute("SET statement_timeout = '30min'")

        # The cutoff is derived from the data, not chosen: it is where Postgres
        # actually begins. Taking anything else would leave a gap or an overlap
        # between the two halves, and both are silent.
        cutoff = await conn.fetchval(
            "SELECT min(game_date) FROM player_game_history WHERE sport = 'mlb'")
        if cutoff is None:
            print("player_game_history holds no mlb rows; nothing to anchor to.")
            await _close(pool)
            return 1

        # Same eligibility source the union path used — Postgres, which holds no
        # rows before `cutoff`, so pitcher markets contribute 0 baseline from the
        # prefix. Reproduced deliberately; see the module docstring.
        start_keys = await load_start_keys(conn=conn)

        print(f"\n{'=' * 78}\nHISTORY PREFIX  (games strictly before {cutoff})\n{'=' * 78}")
        total_rows = 0
        per_market: dict[str, int] = {}

        for slug in BY_SLUG:
            spec = BY_SLUG[slug]
            line = BOARD_LINES.get(slug)
            eligible = start_keys if spec.side == "pit" else None

            rows = await asyncio.to_thread(load_game_history_parquet, slug)
            agg: dict[str, list] = {}
            for gd, aid, ev, vol in rows:
                if gd >= cutoff:
                    break                      # the hot window owns everything from here
                a = agg.get(aid)
                if a is None:
                    a = agg[aid] = [0.0, 0.0, 0, [], 0, 0]
                a[0] += ev
                a[1] += vol
                a[2] += 1
                a[3].append(vol)
                if len(a[3]) > eng.MAX_RECENT:
                    a[3].pop(0)
                if line is not None and (eligible is None or (gd, aid) in eligible):
                    a[5] += 1
                    if ev > line:
                        a[4] += 1

            per_market[slug] = len(agg)
            total_rows += len(agg)
            print(f"  {slug:<24}{len(agg):>6,} athletes   "
                  f"{sum(a[2] for a in agg.values()):>9,} games")

            if apply and agg:
                await conn.executemany(
                    """INSERT INTO player_history_prefix
                         (sport, market, athlete_id, cutoff, events, volume, games,
                          recent_volume, baseline_over, baseline_total, board_line,
                          computed_at)
                       VALUES ('mlb',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
                       ON CONFLICT (sport, market, athlete_id, cutoff) DO UPDATE SET
                         events = excluded.events, volume = excluded.volume,
                         games = excluded.games,
                         recent_volume = excluded.recent_volume,
                         baseline_over = excluded.baseline_over,
                         baseline_total = excluded.baseline_total,
                         board_line = excluded.board_line,
                         computed_at = now()""",
                    [(slug, aid, cutoff, a[0], a[1], a[2], a[3], a[4], a[5], line)
                     for aid, a in agg.items()])

        print(f"\n  {total_rows:,} (market, athlete) rows across {len(per_market)} markets")
        if not apply:
            print("\n  REPORT ONLY. Nothing written. Re-run with --apply.\n")
        else:
            held = await conn.fetchval(
                "SELECT count(*) FROM player_history_prefix WHERE cutoff = $1", cutoff)
            print(f"  player_history_prefix now holds {held:,} rows at cutoff {cutoff}\n")

    await _close(pool)
    return 0


async def _close(pool) -> None:
    try:
        await asyncio.wait_for(pool.close(), timeout=10.0)
    except Exception:                                         # noqa: BLE001
        pool.terminate()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    raise SystemExit(asyncio.run(main(a.apply)))
