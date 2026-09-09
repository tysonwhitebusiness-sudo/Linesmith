"""Phase 4.0 — the NFL audit that must happen before anything is fitted.

    python audit_nfl_phase4.py

Phase 3 spent most of its cost on premises that were wrong in ways no code
review would catch: a market declared unmodellable that had 37,252 unread rows,
a calibration with the best ECE in the book that was inverted, an entry price
that was really an in-play price. Each was cheap to check and expensive to miss.
This runs the three checks Phase 4 owes before an NFL model exists.

THE HEADLINE RESULT, and it changes the architecture rather than a constant:

**NFL CANNOT SERVE PROPS AT A FIXED BOARD LINE.** MLB does — every batter is
shown at 0.5 hits — and that is legitimate there only because 84-93% of really
posted hits lines ARE 0.5. NFL is not like that. Measured 2026-09-08, the share
of rows sitting at each market's single most common line:

    Total Rushing Plus Receiving Yards    7.1%
    Total Rushing Yards                   8.5%
    Total Receiving Yards                10.3%
    Longest Reception                    12.8%
    Total Carries                        14.9%
    ...
    Total Sacks                          96.4%
    Total Defensive Interceptions       100.0%

Phase 3.0 measured that this concentration predicts the fitted calibration slope
at **r = +0.849**, and that `pitcher-outs` — the worst MLB market at **16%** —
came out with a NEGATIVE slope and put backup catchers at the top of the board.
**Fifteen NFL markets sit below that 16%.** Serving them at one fixed line would
reproduce that failure fifteen times over.

The reason is physical, not a data defect: a WR1's receiving line is 70.5 and a
WR3's is 15.5. There is no single number that describes both. So NFL serves each
player at HIS OWN posted line.

WHICH RESTATES PHASE 3.0'S LESSON MORE GENERALLY. The rule is not "calibrate at
a fixed board line" — that was the fix for a board that serves a fixed line. The
rule is **CALIBRATE WHERE YOU SERVE**. MLB serves fixed, so MLB calibrates
fixed. NFL serves per-player, so NFL calibrates at each row's own market line —
which is what the pre-3.0 MLB fitter did, and it was right for a board that had
not yet been built. Getting this backwards in either direction is the same bug.

`Total Sacks` and `Total Defensive Interceptions` are the two exceptions: they
concentrate at 0.5 like MLB's batter markets and can be served fixed.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

# Markets whose line genuinely does not move, and which may therefore be served
# at a fixed board line the way every MLB market is. Everything else is
# per-player. Measured, not assumed — `check_line_concentration` reprints the
# evidence on every run.
FIXED_LINE_MARKETS = {
    "Total Sacks (incl. overtime)": 0.5,
    "Total Defensive Interceptions": 0.5,
}

# The twenty integer-lined MILESTONE schemes. A milestone line L means "L or
# more", so the ordinary-line equivalent is L - 0.5 — the same off-by-one Phase
# 3.2 found in MLB, where one such scheme carried 37,252 rows and was the sole
# 2026 coverage of a market this plan had written off as unmodellable.
#
# NFL's are TINY: 415 rows across all twenty, largest 59, and NOT ONE carries a
# two-sided price. They are therefore EXCLUDED rather than mapped — there is not
# enough there to fit anything, and folding them into an ordinary market's
# `names` would import the off-by-one for no gain. Listed explicitly so that a
# later reader adds them deliberately or not at all.
MILESTONE_SCHEMES = (
    "Receiving Yards Milestones", "Receptions Milestones", "Sacks Milestones",
    "Receiving Yards Milestones - 1st Half", "Receiving Yards Milestones - 1st Quarter",
    "Rushing Yards Milestones", "Rushing Attempts Milestones",
    "Rushing Yards Milestones - 1st Quarter", "Rushing Yards Milestones - 1st Half",
    "Rushing + Receiving Yards Milestones", "Passing Yards Milestones - 1st Half",
    "Passing Yards Milestones", "Passing Completions Milestones",
    "Passing Yards Milestones - 1st Quarter", "Passing + Rushing Yards Milestones",
    "Field Goals Made Milestones", "Kicking Points Milestones",
    "Passing Attempts Milestones", "Passing Touchdown Milestones",
    "Interceptions Thrown Milestones",
)

# Not player props at all — game and team markets that live in the same table.
GAME_OR_TEAM = (
    "1st Half Spread", "1st Quarter Spread", "2nd Quarter Spread",
    "3rd Quarter Spread", "4th Quarter Spread", "1st Half Total",
    "1st Quarter Total", "2nd Quarter Total", "3rd Quarter Total",
    "4th Quarter Total", "Team Total Points", "Team 1st Half Total Points",
    "Team Total Touchdowns", "Football Game Prop", "Football Team Prop",
)


async def check_type_names(c) -> None:
    rows = await c.fetch("""
        SELECT type_name, COUNT(*) n,
               SUM((line = ROUND(line))::int)::float / COUNT(*) fi,
               COUNT(*) FILTER (WHERE over_price IS NOT NULL
                                 AND under_price IS NOT NULL) two_sided
          FROM prop_odds_archive
         WHERE sport = 'nfl' AND line IS NOT NULL
         GROUP BY 1 ORDER BY n DESC""")
    print("=== 4.0a  EVERY type_name CLASSIFIED ===")
    buckets: dict[str, list] = {"player": [], "milestone": [], "game/team": []}
    for r in rows:
        name = r["type_name"]
        if name in MILESTONE_SCHEMES:
            k = "milestone"
        elif name in GAME_OR_TEAM:
            k = "game/team"
        else:
            k = "player"
        buckets[k].append((name, r["n"], r["fi"], r["two_sided"]))

    for k, items in buckets.items():
        tot = sum(i[1] for i in items)
        print(f"  {k:<10} {len(items):>3} schemes, {tot:>8,} rows")
    print()

    # Nothing may be classified 'player' while carrying integer lines: that is
    # exactly the unread-milestone defect, and it would be silent.
    bad = [i for i in buckets["player"] if i[2] > 0.9]
    print(f"  player-prop schemes with INTEGER lines (must be zero): {len(bad)}")
    for name, n, fi, _ in bad:
        print(f"     UNCLASSIFIED MILESTONE: {name!r}  n={n}  integer share {fi:.2f}")
    unknown = [i for i in buckets["milestone"] if i[2] <= 0.9]
    print(f"  declared milestones that are NOT integer-lined (must be zero): {len(unknown)}")
    for name, n, fi, _ in unknown:
        print(f"     MISCLASSIFIED: {name!r}  n={n}  integer share {fi:.2f}")
    ms_rows = sum(i[1] for i in buckets["milestone"])
    ms_two = sum(i[3] for i in buckets["milestone"])
    print(f"\n  milestone totals: {ms_rows:,} rows, {ms_two} of them two-sided")
    print("  -> EXCLUDED from fitting: too few to model, and mapping them into an")
    print("     ordinary market's `names` would import the L vs L-0.5 off-by-one.")
    return len(bad) == 0 and len(unknown) == 0


async def check_join(c) -> bool:
    """4.0b — resolve prop athlete ids and verify by DATE AGREEMENT."""
    xw: dict[str, str] = {}
    for r in await c.fetch(
            "SELECT espn_athlete_id, athlete_id FROM athlete_crosswalk WHERE sport='nfl'"):
        a = str(r["athlete_id"])
        xw[a] = a
        if r["espn_athlete_id"]:
            xw[str(r["espn_athlete_id"])] = a

    by_athlete: dict[str, set] = {}
    for r in await c.fetch(
            "SELECT athlete_id, game_date FROM player_game_history WHERE sport='nfl'"):
        by_athlete.setdefault(str(r["athlete_id"]), set()).add(r["game_date"])

    props = await c.fetch("""
        SELECT athlete_id, game_date, COUNT(*) n FROM prop_odds_archive
         WHERE sport='nfl' AND athlete_id IS NOT NULL AND line IS NOT NULL
         GROUP BY 1, 2""")

    exact = off1 = within_week = never = unresolved = 0
    rows_exact = rows_total = 0
    for r in props:
        rows_total += r["n"]
        aid = xw.get(str(r["athlete_id"]))
        if aid is None:
            unresolved += 1
            continue
        days = by_athlete.get(aid)
        d = r["game_date"]
        if days and d in days:
            exact += 1
            rows_exact += r["n"]
        elif days and any(abs((d - x).days) <= 1 for x in days):
            off1 += 1
        elif days and any(abs((d - x).days) <= 7 for x in days):
            within_week += 1
        else:
            never += 1

    print("\n=== 4.0b  JOIN RATE, BY DATE AGREEMENT ===")
    print("  A numeric id matching the expected shape is not evidence it is the")
    print("  right id: 399 MLB ids once matched by shape and 0.00% landed on the")
    print("  right game date. Only date agreement settles it.")
    tot = exact + off1 + within_week + never + unresolved
    print(f"    exact date match       : {exact:>6,} ({100*exact/tot:.1f}%)"
          f"   {rows_exact:,} rows ({100*rows_exact/rows_total:.1f}%)")
    print(f"    off by exactly one day : {off1:>6,} ({100*off1/tot:.1f}%)"
          "   <- a date bug would live here")
    print(f"    within a week, not 1   : {within_week:>6,} ({100*within_week/tot:.1f}%)"
          "  <- bye week / DNP")
    print(f"    no game within a week  : {never:>6,} ({100*never/tot:.1f}%)"
          "  <- inactive / never played")
    print(f"    id never resolved      : {unresolved:>6,} ({100*unresolved/tot:.1f}%)")
    ok = off1 == 0 and rows_exact / rows_total > 0.90
    print(f"  VERDICT: {'PASS' if ok else 'FAIL'} — zero off-by-one is the real test;"
          " the rest are players who did not play.")
    return ok


async def check_line_concentration(c) -> bool:
    """4.0c — can this market be served at ONE fixed line, MLB-style?"""
    rows = await c.fetch("""
        WITH m AS (SELECT type_name, line, COUNT(*) n FROM prop_odds_archive
                    WHERE sport='nfl' AND line IS NOT NULL AND athlete_id IS NOT NULL
                    GROUP BY 1, 2),
             t AS (SELECT type_name, SUM(n) tot FROM m GROUP BY 1)
        SELECT m.type_name, t.tot, MAX(m.n)::float / t.tot AS conc
          FROM m JOIN t USING (type_name)
         GROUP BY m.type_name, t.tot HAVING t.tot >= 800
         ORDER BY conc ASC""")
    print("\n=== 4.0c  LINE CONCENTRATION: fixed board line, or per-player? ===")
    print("  Phase 3.0: concentration predicts calibration slope at r = +0.849.")
    print("  pitcher-outs INVERTED at 16%. MLB hits/singles are safe at 84-93%.")
    print()
    severe = []
    for r in rows:
        conc = float(r["conc"])
        tag = ("SERVE PER-PLAYER" if conc < 0.40
               else "borderline" if conc < 0.72 else "fixed line OK")
        if conc < 0.16:
            severe.append(r["type_name"])
        print(f"    {r['type_name'][:44]:<46}{r['tot']:>8,}{conc*100:>7.1f}%   {tag}")
    print(f"\n  {len(severe)} markets sit BELOW the 16% that inverted pitcher-outs.")
    print("  -> NFL props are served at each player's OWN posted line, and are")
    print("     therefore CALIBRATED at that line. The rule is not 'calibrate at a")
    print("     fixed board line' — that was the fix for a board that serves fixed.")
    print("     The rule is CALIBRATE WHERE YOU SERVE.")
    declared = set(FIXED_LINE_MARKETS)
    actually_safe = {r["type_name"] for r in rows if float(r["conc"]) >= 0.72}
    ok = declared == actually_safe
    print(f"\n  FIXED_LINE_MARKETS declared: {sorted(declared)}")
    print(f"  measured >= 72% concentration: {sorted(actually_safe)}")
    print(f"  VERDICT: {'PASS' if ok else 'FAIL — declaration does not match measurement'}")
    return ok


async def main() -> int:
    import db
    pool = await db.get_pool()
    async with pool.acquire(timeout=1800.0) as c:
        a = await check_type_names(c)
        b = await check_join(c)
        d = await check_line_concentration(c)
    print("\n" + "=" * 72)
    print(f"  4.0a type_name classification : {'PASS' if a else 'FAIL'}")
    print(f"  4.0b join by date agreement   : {'PASS' if b else 'FAIL'}")
    print(f"  4.0c line concentration       : {'PASS' if d else 'FAIL'}")
    return 0 if (a and b and d) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
