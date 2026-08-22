"""Partial port of lib/core/windowedStat.ts — not a reimplementation of the
parts it covers. Scoped to exactly what predict/good_bets.py's Prop Score
chain needs (`fixed_window`/`open_window`/`subset_window`/`current_streak`/
`window_set`); the display-only pieces (`entryValue`'s numeric-token
parsing feeding `average`, `categoriseByLine`, `deltaFromLine`,
`rateOrNull`/`averageOrNull`) are skipped because nothing in that chain
reads them — `average` is set to 0.0 below rather than parsed, a disclosed
gap only relevant to display code this port doesn't build.

The rule this file exists to enforce (verbatim from the TS source): a
fixed window asks for exactly that many games, and resolves to
`insufficient` when they aren't there. It never quietly measures a shorter
window and labels it with the longer one's name. `insufficient` is a
first-class result, not an error and not a zero.
"""
from dataclasses import dataclass, field
from typing import Callable, Union


@dataclass
class HistoryEntry:
    """Prediction-relevant subset of the TS source's HistoryEntry — no
    `period`/`result`/`periodLabel` display fields, since nothing in the
    Prop Score chain reads them (see module docstring re: `average`)."""

    category: str  # 'over' | 'under'
    opponent_id: int | None = None
    is_home: bool | None = None


@dataclass
class WindowedStatOk:
    hits: int
    total: int
    rate: float
    average: float
    status: str = field(default="ok", init=False)


@dataclass
class WindowedStatInsufficient:
    available: int
    required: int
    status: str = field(default="insufficient", init=False)


WindowedStat = Union[WindowedStatOk, WindowedStatInsufficient]


def _summarise(entries: list[HistoryEntry], category: str) -> WindowedStatOk:
    hits = sum(1 for e in entries if e.category == category)
    total = len(entries)
    return WindowedStatOk(hits=hits, total=total, rate=(hits / total if total else 0.0), average=0.0)


def fixed_window(history: list[HistoryEntry], category: str, required: int) -> WindowedStat:
    """A fixed trailing window — L5, L10, L15. `history` is assumed
    ascending (oldest first); the last `required` entries are what "the
    last N games" means. Anything short of `required` is insufficient —
    no partial credit."""
    if required <= 0 or len(history) < required:
        return WindowedStatInsufficient(available=len(history), required=required)
    return _summarise(history[-required:], category)


def open_window(history: list[HistoryEntry], category: str, minimum: int = 1) -> WindowedStat:
    """An open-ended window — season to date. Its denominator is whatever
    history exists, so it can't be "short", but still reports insufficient
    below `minimum`."""
    if len(history) < minimum:
        return WindowedStatInsufficient(available=len(history), required=minimum)
    return _summarise(history, category)


def subset_window(history: list[HistoryEntry], category: str, predicate: Callable[[HistoryEntry], bool], minimum: int = 1) -> WindowedStat:
    """An open-ended window over an arbitrary subset — versus one opponent, home games only."""
    return open_window([e for e in history if predicate(e)], category, minimum)


def current_streak(history: list[HistoryEntry], category: str) -> int:
    """Consecutive most-recent periods matching the category, signed —
    positive for a hot streak, negative for a cold one, 0 for empty
    history."""
    if not history:
        return 0
    matching = history[-1].category == category
    run = 0
    for entry in reversed(history):
        if (entry.category == category) != matching:
            break
        run += 1
    return run if matching else -run


@dataclass
class WindowSet:
    l5: WindowedStat
    l10: WindowedStat
    l15: WindowedStat
    szn: WindowedStat  # season / all available history
    streak: int


def window_set(history: list[HistoryEntry], category: str) -> WindowSet:
    """The window set every dense surface needs, computed once per candidate."""
    return WindowSet(
        l5=fixed_window(history, category, 5),
        l10=fixed_window(history, category, 10),
        l15=fixed_window(history, category, 15),
        szn=open_window(history, category, minimum=1),
        streak=current_streak(history, category),
    )
