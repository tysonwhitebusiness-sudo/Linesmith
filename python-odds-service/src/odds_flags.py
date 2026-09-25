"""P12 §3 — odds research flags: four `RankingDef`s in slate_rankings.py.

Each is a spotlight (`kind='spotlight'`, never graded) and freezes with the
slate like the rest: it is pre-game research, a fact about how the market
moved, never a pick.

  odds-steam        steam on a player prop main line in the last 6 h: three or
                    more books moved it the same way within 30 minutes
  odds-pulled       a first-hand book pulled a player's main line and reposted
                    it at a new number in the last 6 h
  odds-money-split  a GAME whose DraftKings customers' money % and bets % sit 15
                    or more points apart on the moneyline, spread or total
  odds-first-mover  Pinnacle led a main-line move by 10+ minutes that 3+ books
                    followed

A book's MAIN line at any moment is the line where it quotes both sides
closest to even money — the same rule `lib/db/oddsRead.ts` `histFromChanges`
applies to the player page's chart, so the flag and the chart agree about
what moved. Exchanges and pick'em apps quote ladders, not a main line, and are
left out of the series.

The pure functions (`main_line_series`, `line_moves`, `steam_runs`,
`first_mover_runs`, `money_split_gap`) are tested in src/test_slate_rankings.py.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from predict.odds_math import american_to_decimal

FLAG_WINDOW = timedelta(hours=6)
STEAM_WINDOW = timedelta(minutes=30)
STEAM_MIN_BOOKS = 3
FIRST_MOVER_LEAD = timedelta(minutes=10)
FIRST_MOVER_MIN_FOLLOWERS = 3
MONEY_SPLIT_GAP = 15.0

NO_MAIN_LINE = frozenset({"kalshi", "polymarket", "polymarketus", "novig", "prophetx",
                          "underdog", "sleeper", "prizepicks", "dabble", "betr", "parlayplay"})
FIRST_HAND_PROVIDERS = frozenset({"scraper:draftkings", "scraper:fanduel", "scraper:betmgm", "scraper:betrivers",
                                  "scraper:pinnacle", "scraper:vsin"})


@dataclass(frozen=True)
class Move:
    at: datetime
    book: str
    frm: float
    to: float
    source: str | None = None      # who we read the move from: one relay snapshot moving five books is ONE observation

    @property
    def dir(self) -> int:
        return 1 if self.to > self.frm else -1


def _implied(american: int) -> float:
    d = american_to_decimal(american)
    return 1 / d if d else 0.5


def main_line_series(rows) -> dict[str, list[tuple[datetime, float]]]:
    """{book: [(at, main line[, source]), ...]} from one market's over/under
    changes, oldest first. `rows` carry observed_at, bookmaker, side, line,
    american_odds and (optionally) provider_id."""
    state: dict[str, dict[float, dict[str, int]]] = {}
    out: dict[str, list[tuple[datetime, float]]] = {}
    for r in sorted(rows, key=lambda r: r["observed_at"]):
        book, line = r["bookmaker"], r["line"]
        if book in NO_MAIN_LINE or line is None or r["side"] not in ("over", "under"):
            continue
        st = state.setdefault(book, {})
        st.setdefault(float(line), {})[r["side"]] = int(r["american_odds"])

        def score(p: dict[str, int]) -> float:
            two = 0 if ("over" in p and "under" in p) else 10
            return two + sum(abs(_implied(p[s]) - 0.5) if s in p else 1 for s in ("over", "under"))

        main = min(st, key=lambda ln: (score(st[ln]), ln))
        series = out.setdefault(book, [])
        if not series or series[-1][1] != main:
            series.append((r["observed_at"], main, r.get("provider_id") if hasattr(r, "get") else None))
    return out


def line_moves(series: dict[str, list[tuple[datetime, float]]]) -> list[Move]:
    out = [Move(p[0], book, pts[i - 1][1], p[1], p[2] if len(p) > 2 else None)
           for book, pts in series.items() for i, p in enumerate(pts) if i > 0]
    return sorted(out, key=lambda m: (m.at, m.book))


def steam_runs(moves: list[Move], window: timedelta = STEAM_WINDOW, min_books: int = STEAM_MIN_BOOKS) -> list[list[Move]]:
    """Runs of `min_books`+ books moving the same way within `window` of the
    first mover (the TS `detectSteam` rule, at the spec's 30 minutes). A book
    counts once per run; a move belongs to one run."""
    used: set[int] = set()
    runs: list[list[Move]] = []
    for i, lead in enumerate(moves):
        if i in used:
            continue
        idx, books = [i], {lead.book}
        for j in range(i + 1, len(moves)):
            m = moves[j]
            if m.at - lead.at > window:
                break
            if j in used or m.dir != lead.dir or m.book in books:
                continue
            books.add(m.book)
            idx.append(j)
        # Independent observations, not just books: a relay that re-reads five
        # books in one snapshot moves them at one instant from one source.
        observed = {(moves[k].source, moves[k].at) for k in idx}
        if len(books) >= min_books and len(observed) >= min_books:
            used.update(idx)
            runs.append([moves[k] for k in idx])
    return runs


def first_mover_runs(moves: list[Move]) -> list[tuple[Move, list[Move]]]:
    """Pinnacle moved first, the next book followed 10+ minutes later, and 3+
    books followed in all (within the steam window of the first follower)."""
    out = []
    for i, lead in enumerate(moves):
        if lead.book != "pinnacle":
            continue
        later = [m for m in moves[i + 1:] if m.dir == lead.dir and m.book != "pinnacle"]
        if not later or later[0].at - lead.at < FIRST_MOVER_LEAD:
            continue
        seen, followers = set(), []
        for m in later:
            if m.book in seen or m.at - later[0].at > STEAM_WINDOW:
                continue
            seen.add(m.book)
            followers.append(m)
        if len(followers) >= FIRST_MOVER_MIN_FOLLOWERS:
            out.append((lead, followers))
    return out


def money_split_gap(pct_money: float | None, pct_bets: float | None) -> float | None:
    if pct_money is None or pct_bets is None:
        return None
    return abs(float(pct_money) - float(pct_bets))


def bare_subject(subject_id: str) -> str:
    """`espn:football:3117256` -> `3117256`: the id the player pages use."""
    return subject_id.rsplit(":", 1)[-1] if subject_id.startswith("espn:") else subject_id


MARKET_WORDS = {"sp": "spread", "tot": "total", "ml": "moneyline"}


def market_word(key: str) -> str:
    return MARKET_WORDS.get(key, key.replace("-", " ").replace("_", " "))
