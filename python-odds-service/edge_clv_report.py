"""P13 (E3): the closing-line test for the market edge — a background measurement.

For every `market_edge_log` row with `displayed = true` whose game has started:

  * the soft book's CLOSE — its last price at the shown line and side before
    the start (the history tables, through price_history.py, the one reader);
  * the sharp FAIR CLOSE — the reference book's last two-sided pair at the same
    line before the start, de-vigged by the method the edge was shown with;
  * moved_toward — the close's implied probability is nearer the fair price
    than the shown price's was;
  * clv — fair_close x shown decimal - 1 (the shown price measured at the close);
  * the edge's life — ended_at - shown_at; an edge that ended within one poll
    (120 s) is counted as a timing artefact.

Split by sport, market group (game lines / props), soft book and reference
source. Below n = 30 a split prints "not enough data" rather than a number.
The mean CLV carries a 95% bootstrap interval (2,000 resamples, fixed seed).

    .venv/Scripts/python.exe edge_clv_report.py [--since YYYY-MM-DD]

writes docs/design/odds-build/results/e3-<today>.md. When to read it and what
the operator decides from it: docs/design/odds-build/P13-closing-line-test.md.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import statistics
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from predict.odds_math import american_to_decimal, devig_by  # noqa: E402

MIN_N = 30
BOOTSTRAP = 2000
POLL_S = 120
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "design", "odds-build", "results")


@dataclass
class EdgeOutcome:
    sport: str
    group: str            # 'game lines' | 'props'
    book: str
    reference: str
    shown_american: int
    fair_at_show: float
    close_american: int | None
    fair_close: float | None
    life_s: float | None

    @property
    def measured(self) -> bool:
        return self.close_american is not None and self.fair_close is not None

    @property
    def moved_toward(self) -> bool | None:
        if not self.measured:
            return None
        imp = lambda a: 1 / american_to_decimal(a)  # noqa: E731
        return abs(imp(self.close_american) - self.fair_at_show) < abs(imp(self.shown_american) - self.fair_at_show)

    @property
    def clv(self) -> float | None:
        if self.fair_close is None:
            return None
        return self.fair_close * american_to_decimal(self.shown_american) - 1

    @property
    def artefact(self) -> bool | None:
        return None if self.life_s is None else self.life_s <= POLL_S


def last_before(rows: list[tuple[datetime, int]], start: datetime) -> int | None:
    """The last price observed strictly before the start."""
    before = [p for at, p in sorted(rows) if at < start]
    return before[-1] if before else None


def fair_close(ref_a: list[tuple[datetime, int]], ref_b: list[tuple[datetime, int]], start: datetime,
               method: str) -> float | None:
    """Side A's fair probability from the reference's last pre-start pair."""
    a, b = last_before(ref_a, start), last_before(ref_b, start)
    if a is None or b is None:
        return None
    r = devig_by(method, american_to_decimal(a), american_to_decimal(b))
    return r[0] if r else None


def bootstrap_ci(xs: list[float], n: int = BOOTSTRAP, seed: int = 7) -> tuple[float, float]:
    rng = random.Random(seed)
    means = sorted(statistics.fmean(rng.choices(xs, k=len(xs))) for _ in range(n))
    return means[int(0.025 * n)], means[int(0.975 * n) - 1]


def summarize(rows: list[EdgeOutcome]) -> dict:
    measured = [r for r in rows if r.measured]
    lives = [r.life_s for r in rows if r.life_s is not None]
    out = {"n": len(rows), "measured": len(measured)}
    if len(measured) < MIN_N:
        out["enough"] = False
        return out
    clvs = [r.clv for r in measured]
    lo, hi = bootstrap_ci(clvs)
    out.update(enough=True, moved_toward=sum(bool(r.moved_toward) for r in measured) / len(measured),
               clv_mean=statistics.fmean(clvs), clv_median=statistics.median(clvs), clv_ci=(lo, hi),
               half_life_s=statistics.median(lives) if lives else None,
               artefacts=(sum(bool(r.artefact) for r in rows if r.artefact is not None) / len(lives)) if lives else None)
    return out


def splits(rows: list[EdgeOutcome]) -> dict[str, dict[str, list[EdgeOutcome]]]:
    out: dict[str, dict[str, list[EdgeOutcome]]] = {"all": {"all edges": rows}}
    for name, key in (("sport", lambda r: r.sport), ("market group", lambda r: r.group),
                      ("soft book", lambda r: r.book), ("reference", lambda r: r.reference)):
        groups: dict[str, list[EdgeOutcome]] = {}
        for r in rows:
            groups.setdefault(key(r), []).append(r)
        out[name] = dict(sorted(groups.items()))
    return out


def render(rows: list[EdgeOutcome], since: date | None, today: date) -> str:
    pct = lambda x: f"{x * 100:+.2f}%"  # noqa: E731
    lines = [f"# E3 closing-line test — {today}", "",
             f"Edges shown (`market_edge_log.displayed`) whose game has started{f', since {since}' if since else ''}: "
             f"**{len(rows)}**, of which **{sum(r.measured for r in rows)}** have a soft close and a fair close.",
             "", "Method: `python-odds-service/edge_clv_report.py` (P13). CLV = fair close x shown decimal - 1; "
             "moved toward = the close's implied probability is nearer the fair price than the shown price's was; "
             f"half-life = median edge life; artefact = ended within one poll ({POLL_S} s). "
             f"A split under n = {MIN_N} measured says \"not enough data\".", ""]
    for name, groups in splits(rows).items():
        lines += [f"## By {name}" if name != "all" else "## All edges", "",
                  "| split | n | measured | moved toward | mean CLV (95% CI) | median CLV | half-life | artefacts |",
                  "|---|---|---|---|---|---|---|---|"]
        for label, rs in groups.items():
            s = summarize(rs)
            if not s["enough"]:
                lines.append(f"| {label} | {s['n']} | {s['measured']} | not enough data | | | | |")
                continue
            hl = f"{s['half_life_s'] / 60:.1f} min" if s["half_life_s"] is not None else "—"
            art = f"{s['artefacts'] * 100:.0f}%" if s["artefacts"] is not None else "—"
            lines.append(f"| {label} | {s['n']} | {s['measured']} | {s['moved_toward'] * 100:.0f}% | "
                         f"{pct(s['clv_mean'])} ({pct(s['clv_ci'][0])} to {pct(s['clv_ci'][1])}) | "
                         f"{pct(s['clv_median'])} | {hl} | {art} |")
        lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------- the reads

async def load(since: date | None) -> list[EdgeOutcome]:
    import db
    import price_history as ph

    pool = await db.get_pool()
    rows = await pool.fetch(
        """SELECT l.*, gr.event_start FROM market_edge_log l
             LEFT JOIN LATERAL (SELECT event_start FROM game_result WHERE event_ref = l.game_id
                                 AND event_start IS NOT NULL LIMIT 1) gr ON true
            WHERE l.displayed AND ($1::date IS NULL OR l.shown_at >= $1::date)""", since)
    now = datetime.now(timezone.utc)
    # A row logged before `reference.start` existed, whose game is not final yet: today's scoreboards.
    from predict.market_edge import game_starts
    sched = await game_starts(now) if any(not (json.loads(r["reference"]) if isinstance(r["reference"], str)
                                                else r["reference"]).get("start") for r in rows) else {}
    out: list[EdgeOutcome] = []
    cache: dict[tuple, list] = {}
    for r in rows:
        ref = json.loads(r["reference"]) if isinstance(r["reference"], str) else r["reference"]
        start = ref.get("start") or (r["event_start"].isoformat() if r["event_start"] else None)             or (sched[r["game_id"]][1].isoformat() if r["game_id"] in sched else None)
        if not start:
            continue
        start = datetime.fromisoformat(start.replace("Z", "+00:00"))
        if start > now:
            continue                                    # not closed yet
        if r["kind"] == "prop":
            key = ("prop", r["game_id"], r["subject_id"], r["market"], r["line"])
            if key not in cache:
                cache[key] = [dict(h) for h in await ph.read_prop_history_for_key(pool, r["game_id"], r["subject_id"], r["market"], r["line"])]
            hist = cache[key]
            at_line = lambda h: True  # noqa: E731 (the read is already at the line)
        else:
            key = ("game", r["game_id"], r["period"], r["market"])
            if key not in cache:
                cache[key] = [dict(h) for h in await ph.read_game_history_for_market(pool, r["game_id"], r["period"], r["market"])]
            hist = cache[key]
            home_line = -r["line"] if (r["market"] == "sp" and r["side"] == "away" and r["line"] is not None) else r["line"]
            at_line = lambda h, hl=home_line: (  # noqa: E731
                (-h["point"] if (r["market"] == "sp" and h["side"] == "away" and h["point"] is not None) else h["point"]) == hl)
        soft = [(h["observed_at"], h["american_odds"]) for h in hist
                if h["bookmaker"] == r["bookmaker"] and h["side"] == r["side"] and at_line(h)]
        sides = sorted((ref.get("prices") or {}).keys(), key=lambda s: s != r["side"])
        rbook = ref.get("book") or "pinnacle"
        ra = [(h["observed_at"], h["american_odds"]) for h in hist if h["bookmaker"] == rbook and h["side"] == r["side"] and at_line(h)]
        other = next((s for s in sides if s != r["side"]), None)
        rb = [(h["observed_at"], h["american_odds"]) for h in hist if h["bookmaker"] == rbook and h["side"] == other and at_line(h)]
        life = (r["ended_at"] - r["shown_at"]).total_seconds() if r["ended_at"] else None
        out.append(EdgeOutcome(
            sport=r["sport"], group="props" if r["kind"] == "prop" else "game lines", book=r["bookmaker"],
            reference=ref.get("source") or rbook, shown_american=r["soft_american"], fair_at_show=r["fair_prob"],
            close_american=last_before(soft, start), fair_close=fair_close(ra, rb, start, r["method"]), life_s=life))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", type=date.fromisoformat, default=None)
    args = ap.parse_args()
    rows = asyncio.run(load(args.since))
    today = datetime.now(timezone.utc).date()
    path = os.path.normpath(os.path.join(OUT_DIR, f"e3-{today}.md"))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(render(rows, args.since, today) + "\n")
    print(f"{len(rows)} closed edges, {sum(r.measured for r in rows)} measured -> {path}")


if __name__ == "__main__":
    main()
