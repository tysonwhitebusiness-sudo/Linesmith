"""Phase 5.3 — assert the shared engine and `nhl_props` are the SAME model.

`count_prop_engine.py` was extracted from `nhl_props.py` so MLB and NHL cannot
grow two implementations of one idea. NHL is deliberately NOT migrated yet: its
numbers are measured, persisted and serving a live board, and rewriting code
underneath a verified result is how a verified result stops being one.

That leaves a real risk — two copies that quietly disagree — so this asserts
they produce BIT-IDENTICAL output on the same inputs. If they ever diverge, this
fails instead of the difference passing unnoticed.

Run from python-odds-service/:
    python test_count_prop_engine.py
"""
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))

from predict import count_prop_engine as eng  # noqa: E402
from predict import nhl_props as npx  # noqa: E402

FAIL = 0


def global_fail(msg: str) -> None:
    global FAIL
    FAIL += 1
    print(f"  FAIL {msg}")


def check(name: str, a, b) -> None:
    global FAIL
    if a != b:
        FAIL += 1
        print(f"  FAIL {name}: {a!r} != {b!r}")


def main() -> int:
    rng = random.Random(20260905)

    print("shrunk_rate — identical across the parameter space")
    for _ in range(4000):
        ev = rng.uniform(0, 400)
        vol = rng.choice([0.0, rng.uniform(0.1, 3000)])
        lr = rng.uniform(0.001, 0.6)
        k = rng.choice([0.0, 1.0, 5.0, 10.0, 20.0, 40.0])
        # 18.0 is nhl_props' hard-coded minutes-per-game divisor, passed
        # explicitly here because the engine takes it as a parameter.
        check("shrunk_rate", eng.shrunk_rate(ev, vol, lr, k, 18.0),
              npx.shrunk_rate(ev, vol, lr, k))

    # FINITE dispersion must be exactly identical. The POISSON LIMIT must not:
    # this engine takes the exact limit where nhl_props evaluates the NB at
    # r=1e6, so the two differ by a small, bounded amount. Asserting equality
    # there would be asserting something untrue; the bound is measured instead.
    print("nb_prob_over — exact for finite dispersion, bounded at the Poisson limit")
    worst = 0.0
    for _ in range(4000):
        line = rng.choice([0.5, 1.5, 2.5, 3.5, 6.5, 16.5])
        mean = rng.uniform(0.001, 25.0)
        disp = rng.choice([1.0, 2.0, 4.0, 8.0, 20.0])
        check(f"nb_prob_over({line},{mean:.3f},{disp})",
              eng.nb_prob_over(line, mean, disp),
              npx.nb_prob_over(line, mean, disp))
    for _ in range(4000):
        line = rng.choice([0.5, 1.5, 2.5, 3.5, 6.5, 16.5])
        mean = rng.uniform(0.001, 25.0)
        worst = max(worst, abs(eng.nb_prob_over(line, mean, 1e6)
                               - npx.nb_prob_over(line, mean, 1e6)))
    print(f"    Poisson-limit max |difference|: {worst:.2e}")
    if worst > 1e-5:
        global_fail(f"Poisson limit drifted: {worst:.2e} > 1e-5")
    print(f"    within the 1e-5 bound (the gates tolerate 5e-2) — "
          f"{'PASS' if worst <= 1e-5 else 'FAIL'}")

    print("PlayerHistory + project — identical on the same event stream")
    for _ in range(400):
        he, hn = eng.PlayerHistory(), npx.PlayerHistory()
        n = rng.randint(1, 120)
        for _ in range(n):
            ev, vol = rng.uniform(0, 8), rng.uniform(1, 30)
            he.add(ev, vol)
            hn.add(ev, vol)
        check("games", he.games, hn.games)
        check("volume", he.volume, hn.minutes)
        check("events", he.events, hn.sog)
        lr, lv = rng.uniform(0.01, 0.5), rng.uniform(5, 25)
        for w in (0, 5, 10, 20, 40):
            check(f"mean_volume(w={w})", he.mean_volume(lv, w), hn.mean_toi(lv, w))
            k = rng.choice([0.0, 5.0, 20.0])
            pe = eng.project(he, lr, lv, k=k, volume_window=w, volume_per_game=18.0)
            pn = npx.project(hn, lr, lv, k=k, toi_window=w)
            check(f"project.expected(w={w})", pe.expected, pn.expected_sog)
            check(f"project.volume(w={w})", pe.projected_volume, pn.projected_toi)
            check(f"project.rate(w={w})", pe.rate_per_chance, pn.rate_per_min)

    print("the park multiplier is inert at 1.0, and scales the RATE when set")
    h = eng.PlayerHistory()
    for _ in range(30):
        h.add(1.0, 4.0)
    base = eng.project(h, 0.25, 4.0, k=10.0)
    same = eng.project(h, 0.25, 4.0, k=10.0, multiplier=1.0)
    check("multiplier 1.0 is a no-op", base.expected, same.expected)
    up = eng.project(h, 0.25, 4.0, k=10.0, multiplier=1.10)
    check("multiplier scales expected", round(up.expected, 12),
          round(base.expected * 1.10, 12))
    check("multiplier does NOT change volume", up.projected_volume,
          base.projected_volume)

    print(f"\n{'FAILED ' + str(FAIL) if FAIL else 'PASS'} — "
          f"the shared engine and nhl_props agree exactly")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
