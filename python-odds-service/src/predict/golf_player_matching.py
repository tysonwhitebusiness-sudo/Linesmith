"""Direct port of lib/sports/golf/golfPlayerMatching.ts — not a
reimplementation.

Golfer identity resolution — canonical ID is ESPN's athlete id. Every
other golf data source (PGA Tour's own stats pages, a future screenshot
import) speaks names, not ids, so this is the one place that resolves a
raw name into that canonical id. Mirrors entity_resolution.py's MLB
roster matching, but golf has no team to scope a last-name fallback
against — reuses that module's normalize_name/_last_name_of directly
rather than re-porting identical logic a second time.
"""
from dataclasses import dataclass, field

from entity_resolution import _last_name_of, normalize_name


@dataclass
class GolfRosterEntry:
    espn_id: str
    name: str


@dataclass
class GolfRosterIndex:
    by_full_name: dict[str, GolfRosterEntry] = field(default_factory=dict)
    by_last_name: dict[str, list[GolfRosterEntry]] = field(default_factory=dict)


def build_golf_roster_index(subjects: list[tuple[str, str]]) -> GolfRosterIndex:
    """Build the match index from the live field — a list of
    (espn_id, name) pairs, refreshed every scan cycle."""
    by_full_name: dict[str, GolfRosterEntry] = {}
    by_last_name: dict[str, list[GolfRosterEntry]] = {}

    for espn_id, name in subjects:
        entry = GolfRosterEntry(espn_id=espn_id, name=name)
        normalized = normalize_name(name)
        if not normalized:
            continue
        by_full_name[normalized] = entry

        last = _last_name_of(normalized)
        by_last_name.setdefault(last, []).append(entry)

    return GolfRosterIndex(by_full_name=by_full_name, by_last_name=by_last_name)


def resolve_golfer(raw_name: str, index: GolfRosterIndex) -> GolfRosterEntry | None:
    """Resolve a raw golfer name (from PGA Tour's stats pages, or
    anywhere else) to the ESPN athlete id the rest of the app keys on.
    Exact normalized match first; falls back to last-name-only when
    unique in the current field. Returns None (never a guess) otherwise."""
    normalized = normalize_name(raw_name)
    if not normalized:
        return None

    exact = index.by_full_name.get(normalized)
    if exact:
        return exact

    last = _last_name_of(normalized)
    candidates = index.by_last_name.get(last)
    if candidates and len(candidates) == 1:
        return candidates[0]

    return None
