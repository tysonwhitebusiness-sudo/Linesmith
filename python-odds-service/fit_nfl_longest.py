"""Phase 4.4 — longest reception as an EXTREME VALUE, not a total.

    python fit_nfl_longest.py

WHY THIS IS NOT `fit_nfl_props.py` WITH A DIFFERENT STAT KEY. Every model in this
repo projects a SUM: `count_prop_engine` multiplies a rate by a volume, the
Beta-Binomial priors count successes, the plate-appearance simulation adds up
outcomes. Longest reception is a MAXIMUM. Its distribution has a different shape
and a different tail, and the tail is the part a line at 24.5 yards actually
asks about.

THE MODEL, which needs no new data:

    P(longest > L)  =  1 - F(L)^N

where N is the receptions in the game and F is the distribution of ONE
reception's length. Both inputs already exist — 4.3 fitted receptions and
receiving yards, so N and the mean length mu = yards/receptions come free.

CHOOSING F BY MEASUREMENT, NOT BY ASSUMPTION. The obvious first guess is
exponential, which has a clean closed form. It is wrong, and the data says so
sharply. Under Exp(mu), E[max of N] = mu * H_N, so the ratio of actual to
predicted should sit at 1.00 for every N. Measured over 52,573 player-games:

    N        1      2      3      4      5      6      8     10
    ratio  1.000  0.951  0.926  0.906  0.897  0.878  0.878  0.868

The decline is monotone and large: exponential over-predicts the longest catch
by about 13% at ten receptions. Real reception lengths have a LIGHTER tail than
exponential — a receiver's catches cluster more than a memoryless process would.

So F is Weibull, the one-parameter generalisation that can express exactly that:

    F(L) = 1 - exp(-(L/lambda)^k),   lambda = mu / Gamma(1 + 1/k)

k = 1 recovers the exponential; k > 1 gives the lighter tail the data shows. The
shape is fitted on SELECT seasons by matching those E[max]/mu ratios, then
checked on held-out seasons and finally scored at the market's own real lines.

**Projection only.** 4.5 owns the probability gate and needs the 2026 season.
"""
import asyncio
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from corpus_reads import load_prop_archive  # noqa: E402

PROJ_CUTOFF = 2024
MAX_N = 12          # beyond this the per-N sample thins out fast


def season_of(d) -> int:
    s = str(d)
    y, mo = int(s[:4]), int(s[5:7])
    return y - 1 if mo <= 2 else y


def weibull_scale(mu: float, k: float) -> float:
    """lambda such that a Weibull(lambda, k) has mean mu."""
    return mu / math.gamma(1.0 + 1.0 / k)


def p_longest_over(line: float, n: int, mu: float, k: float) -> float:
    """P(max of n Weibull draws > line). The whole model, in one line."""
    if n <= 0 or mu <= 0:
        return 0.0
    if line <= 0:
        return 1.0
    lam = weibull_scale(mu, k)
    f = 1.0 - math.exp(-((line / lam) ** k))      # F(line) for one reception
    return 1.0 - f ** n


def expected_max(n: int, mu: float, k: float, grid: int = 4000) -> float:
    """E[max of n] by numerical integration of the survival function.

    E[X] = integral of P(X > t). Integrating rather than sampling keeps this
    deterministic — a Monte Carlo here would put noise into the thing being
    fitted.
    """
    lam = weibull_scale(mu, k)
    hi = lam * (math.log(max(n, 2)) ** (1.0 / k) + 6.0)
    step = hi / grid
    total = 0.0
    for i in range(grid):
        t = (i + 0.5) * step
        f = 1.0 - math.exp(-((t / lam) ** k))
        total += (1.0 - f ** n) * step
    return total


def ll(p: float) -> float:
    return -math.log(min(1 - 1e-12, max(1e-12, p)))


async def main() -> int:
    import db

    pool = await db.get_pool()
    async with pool.acquire(timeout=1800.0) as c:
        games = await c.fetch("""
            SELECT game_date, athlete_id,
                   (stats->>'receiving.receptions')::numeric::int  AS n,
                   (stats->>'receiving.receivingYards')::numeric    AS yds,
                   (stats->>'receiving.longReception')::numeric     AS longest
              FROM player_game_history
             WHERE sport='nfl' AND stats ? 'receiving.longReception'
               AND (stats->>'receiving.receptions')::numeric > 0
               AND (stats->>'receiving.receivingYards')::numeric > 0""")
    rows = [(season_of(r["game_date"]), str(r["athlete_id"]), int(r["n"]),
             float(r["yds"]), float(r["longest"])) for r in games]
    print(f"{len(rows):,} player-games with a longest reception")

    sel = [r for r in rows if r[0] < PROJ_CUTOFF]
    held = [r for r in rows if r[0] >= PROJ_CUTOFF]
    print(f"SELECT (<{PROJ_CUTOFF}) {len(sel):,}   HELD OUT {len(held):,}\n")

    def ratios(data):
        by_n: dict[int, list] = {}
        for _s, _a, n, yds, lg in data:
            if 1 <= n <= MAX_N:
                by_n.setdefault(n, []).append((yds / n, lg))
        return {n: (len(v), sum(x[0] for x in v) / len(v), sum(x[1] for x in v) / len(v))
                for n, v in by_n.items() if len(v) >= 150}

    sel_r = ratios(sel)

    # --- fit the shape on SELECT -------------------------------------------
    best = None
    for i in range(1, 61):
        k = 0.8 + 0.05 * i                     # 0.85 .. 3.80
        err = 0.0
        for n, (cnt, mu, act) in sel_r.items():
            pred = expected_max(n, mu, k, grid=1200)
            err += cnt * (act - pred) ** 2
        if best is None or err < best[0]:
            best = (err, k)
    k = best[1]
    print(f"fitted Weibull shape k = {k:.2f}   (k=1 would be the exponential)\n")

    print("=== FIT ON SELECT, then the SAME k on HELD OUT ===")
    print(f"  {'N':>3}{'games':>8}{'actual':>9}{'Weibull':>9}{'ratio':>7}"
          f"{'  |':>3}{'games':>8}{'actual':>9}{'Weibull':>9}{'ratio':>7}")
    held_r = ratios(held)
    for n in sorted(sel_r):
        cnt, mu, act = sel_r[n]
        pred = expected_max(n, mu, k)
        line = f"  {n:>3}{cnt:>8,}{act:>9.2f}{pred:>9.2f}{act/pred:>7.3f}"
        if n in held_r:
            hc, hmu, hact = held_r[n]
            hpred = expected_max(n, hmu, k)
            line += f"  |{hc:>8,}{hact:>9.2f}{hpred:>9.2f}{hact/hpred:>7.3f}"
        print(line)

    # --- score at the market's own lines, against the exponential ----------
    async with pool.acquire(timeout=1800.0) as c:
        xw = {}
        for r in await c.fetch(
                "SELECT espn_athlete_id, athlete_id FROM athlete_crosswalk WHERE sport='nfl'"):
            a = str(r["athlete_id"])
            xw[a] = a
            if r["espn_athlete_id"]:
                xw[str(r["espn_athlete_id"])] = a
        # Phase 5.S.6 — see fit_mlb_props.load_props. The table is split
        # between Postgres and the Parquet corpus; `load_prop_archive` is the
        # only reader that sees both halves.
        props = await load_prop_archive(
            c, "nfl", ["Longest Reception (incl. overtime)"])

    truth = {}
    for s, a, n, yds, lg in rows:
        key = (a, s)
        truth.setdefault(a, {})[None] = None
    by_key = {}
    for r in games:
        by_key[(str(r["athlete_id"]), r["game_date"])] = (
            int(r["n"]), float(r["yds"]), float(r["longest"]))

    scored_w, scored_e, n_used = [], [], 0
    for p in props:
        aid = xw.get(str(p["athlete_id"]))
        if aid is None:
            continue
        got = by_key.get((aid, p["game_date"]))
        if got is None:
            continue
        n, yds, longest = got
        mu = yds / n
        line = float(p["line"])
        hit = longest > line
        pw = p_longest_over(line, n, mu, k)
        pe = p_longest_over(line, n, mu, 1.0)      # the exponential it replaces
        scored_w.append(ll(pw if hit else 1 - pw))
        scored_e.append(ll(pe if hit else 1 - pe))
        n_used += 1

    print(f"\n=== AT THE MARKET'S REAL LINES (n={n_used:,}) ===")
    if n_used >= 200:
        mw = sum(scored_w) / n_used
        me = sum(scored_e) / n_used
        d = [a - b for a, b in zip(scored_w, scored_e)]
        m = sum(d) / len(d)
        var = sum((x - m) ** 2 for x in d) / (len(d) - 1)
        t = m / math.sqrt(var / len(d)) if var > 0 else float("nan")
        print(f"  Weibull(k={k:.2f})  log-loss {mw:.5f}")
        print(f"  exponential(k=1)   log-loss {me:.5f}")
        print(f"  delta {m:+.5f}  t={t:+.2f}  "
              f"{'WEIBULL BETTER' if t < -1.96 else 'EXPONENTIAL BETTER' if t > 1.96 else 'TIE'}")
        print("\n  NOTE this uses each game's ACTUAL receptions and yards, so it")
        print("  isolates the DISTRIBUTION choice. Serving needs projected N and mu")
        print("  from 4.3, which adds their error on top — 4.5 owns that gate.")
    else:
        print("  too few joined rows — untested, not passing")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
