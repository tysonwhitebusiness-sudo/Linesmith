"""Name/market/book normalization for the five-provider odds feed — a
faithful port of lib/odds/props/entityResolution.ts, not a reimplementation
from memory of what it does. Every alias table below is copied verbatim from
the TS source; the diacritic-stripping range (U+0300-U+036F) was confirmed
character-by-character against the real JS regex literal before porting,
not assumed to be "probably the combining marks block" — see
docs/phase2-python-odds-migration-audit-2026-08-19.md's own flag that this
exact detail was a real risk, not a formality.

Built and tested in isolation on purpose (see test_entity_resolution.py) —
NOT wired into providers.py or any live fetch path yet. The harness stays
measure-only until this is validated and a separate decision is made to
turn on real prop_odds writes.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# Player names
# ---------------------------------------------------------------------------

_SUFFIX_RE = re.compile(r"\b(jr|sr|ii|iii|iv)\b\.?", re.IGNORECASE)
_NON_ALPHA_RE = re.compile(r"[^a-zA-Z\s]")
_COMBINING_DIACRITICS_RE = re.compile("[̀-ͯ]")
_WHITESPACE_RE = re.compile(r"\s+")


def normalize_name(name: str) -> str:
    """Strips accents, punctuation, suffixes and casing so name variants
    compare equal. Mirrors entityResolution.ts's normalizeName exactly,
    including operation order (NFD -> strip diacritics -> strip suffixes ->
    strip non-letters -> lowercase -> collapse whitespace)."""
    decomposed = unicodedata.normalize("NFD", name)
    no_diacritics = _COMBINING_DIACRITICS_RE.sub("", decomposed)
    no_suffix = _SUFFIX_RE.sub("", no_diacritics)
    letters_only = _NON_ALPHA_RE.sub("", no_suffix)
    return _WHITESPACE_RE.sub(" ", letters_only.lower().strip())


def _last_name_of(normalized: str) -> str:
    parts = [p for p in normalized.split(" ") if p]
    return parts[-1] if parts else ""


@dataclass
class RosterEntry:
    subject_id: str
    subject_name: str
    team_abbr: str | None = None
    position: str | None = None
    headshot_url: str | None = None


@dataclass
class RosterIndex:
    by_full_name: dict[str, RosterEntry] = field(default_factory=dict)
    by_last_name_and_team: dict[str, list[RosterEntry]] = field(default_factory=dict)


def build_roster_index(roster: list[RosterEntry]) -> RosterIndex:
    index = RosterIndex()
    for entry in roster:
        normalized = normalize_name(entry.subject_name)
        index.by_full_name[normalized] = entry

        last = _last_name_of(normalized)
        key = f"{last}::{(entry.team_abbr or '').upper()}"
        index.by_last_name_and_team.setdefault(key, []).append(entry)
    return index


def resolve_player(raw_name: str, team_abbr: str | None, index: RosterIndex) -> RosterEntry | None:
    """Exact normalized match first. Falls back to last-name-plus-team when a
    provider abbreviates a first name or uses a nickname — scoped to team so
    "Smith" on the away side never matches "Smith" on the home side. Returns
    None (never a guess) when neither resolves, or when the team-scoped
    fallback is ambiguous (two roster players sharing a last name on one
    team)."""
    normalized = normalize_name(raw_name)
    if not normalized:
        return None

    exact = index.by_full_name.get(normalized)
    if exact:
        return exact

    if team_abbr:
        last = _last_name_of(normalized)
        candidates = index.by_last_name_and_team.get(f"{last}::{team_abbr.upper()}")
        if candidates and len(candidates) == 1:
            return candidates[0]

    return None


# ---------------------------------------------------------------------------
# Market keys — copied verbatim from entityResolution.ts's MARKET_KEY_ALIASES
# ---------------------------------------------------------------------------

MARKET_KEY_ALIASES: dict[str, str] = {
    # SharpAPI `stat_category`
    "hits": "hits",
    "doubles": "doubles",
    "triples": "triples",
    "home_runs": "home-runs",
    "rbis": "rbis",
    "runs": "runs",
    "earned_runs": "earned-runs",
    "hits_allowed": "pitcher-hits-allowed",
    "hits_runs_rbis": "hits-runs-rbis",
    "stolen_bases": "stolen-bases",
    "walks": "walks",
    "strikeouts": "batter-strikeouts",
    "pitcher_strikeouts": "pitcher-strikeouts",
    "outs": "pitcher-outs",
    # Odds-API.io Player Props labels (parsed out of "Player (Stat Type)")
    "total bases": "total-bases",
    "hits+runs+rbis": "hits-runs-rbis",
    "runs batted in": "rbis",
    "runs scored": "runs",
    "home runs": "home-runs",
    # SportsGameOdds `statID`
    "batting_hits": "hits",
    "batting_totalbases": "total-bases",
    "batting_homeruns": "home-runs",
    "batting_rbi": "rbis",
    "batting_basesonballs": "walks",
    "batting_strikeouts": "batter-strikeouts",
    "batting_hits+runs+rbi": "hits-runs-rbis",
    "batting_doubles": "doubles",
    "batting_triples": "triples",
    "batting_singles": "singles",
    "batting_stolenbases": "stolen-bases",
    "batting_runs+rbi": "runs-rbis",
    "batting_firsthomerun": "first-home-run",
    "pitching_basesonballs": "pitcher-walks-allowed",
    "pitching_earnedruns": "earned-runs",
    "pitching_hits": "pitcher-hits-allowed",
    "pitching_strikeouts": "pitcher-strikeouts",
    "pitching_outs": "pitcher-outs",
    "pitching_win": "pitcher-win",
    # --- NFL / CFB (ParlayAPI market names, TheRundown market catalog) ---
    "pass yards": "passing-yards",
    "passing yards": "passing-yards",
    "passing_yards": "passing-yards",
    "pass tds": "passing-tds",
    "passing touchdowns": "passing-tds",
    "passing_touchdowns": "passing-tds",
    "rush yards": "rushing-yards",
    "rushing yards": "rushing-yards",
    "rushing_yards": "rushing-yards",
    "rush tds": "rushing-tds",
    "receiving yards": "receiving-yards",
    "player_receiving_yards": "receiving-yards",
    "receptions": "receptions",
    "player_receptions": "receptions",
    "rec tds": "receiving-tds",
    "ints thrown": "interceptions-thrown",
    "int": "interceptions-thrown",
    "player_interceptions": "interceptions-thrown",
    "longest rush": "longest-rush",
    "longest reception": "longest-reception",
    "player_longest_reception": "longest-reception",
    "longest completion": "longest-completion",
    "fg made": "field-goals-made",
    "player_field_goals": "field-goals-made",
    "kicking points": "kicking-points",
    "rush + rec tds": "rush-rec-tds",
    "rush+rec tds": "rush-rec-tds",
    "player_rushing_receiving_yards": "rush-rec-yards",
    "sacks": "sacks",
    "anytime touchdowns": "anytime-td",
    "touchdowns": "anytime-td",
    "first td scorer": "first-td-scorer",
    "first_touchdown": "first-td-scorer",
    "player_passing_completions": "passing-completions",
    "player_pass_attempts": "pass-attempts",
    "player_rushing_attempts": "rushing-attempts",
    # --- Tennis (SharpAPI stat_category, live-verified) ---
    "aces": "aces",
    "games_won": "games-won",
    "tennis_to_win_set": "to-win-a-set",
    "tennis_player_aces": "aces",
    "tennis_player_total_aces": "aces",
    # --- Soccer (Propline market keys, SportsGameOdds statIDs — both live-verified) ---
    "anytime_goal_scorer": "anytime-goalscorer",
    "first_goal_scorer": "first-goalscorer",
    "2plus_goals": "two-plus-goals",
    "last_goal_scorer": "last-goalscorer",
    "assists": "assists",
    "shots": "shots",
    "shots_ongoal": "shots-on-target",
    "goals+assists": "goals-assists",
    "tackles": "tackles",
    "passes_attempted": "passes-attempted",
    "dribbles_attempted": "dribbles-attempted",
    "crosses_attempted": "crosses-attempted",
    "yellowcards": "yellow-cards",
    "goalie_saves": "saves",

    # --- NBA (2026-08-22) — kept in lockstep with entityResolution.ts's
    # own NBA section; see that file's comment for the same "not yet
    # live-verified" caveat.
    "points": "points",
    "player_points": "points",
    "rebounds": "rebounds",
    "player_rebounds": "rebounds",
    # "assists" itself already aliased above (shared with soccer's identical key).
    "player_assists": "assists",
    "three-pointers-made": "three-pointers-made",
    "threes made": "three-pointers-made",
    "three_pointers_made": "three-pointers-made",
    "player_threes": "three-pointers-made",
    "steals": "steals",
    "player_steals": "steals",
    "blocks": "blocks",
    "player_blocks": "blocks",
    "turnovers": "turnovers",
    "player_turnovers": "turnovers",
    "points-rebounds-assists": "points-rebounds-assists",
    "pts+reb+ast": "points-rebounds-assists",
    "points-rebounds": "points-rebounds",
    "pts+reb": "points-rebounds",
    "points-assists": "points-assists",
    "pts+ast": "points-assists",
    "rebounds-assists": "rebounds-assists",
    "reb+ast": "rebounds-assists",
}

_MARKET_KEY_WS_RE = re.compile(r"[\s_]+")

# The distinct set of canonical market keys (every value MARKET_KEY_ALIASES
# maps to, across every provider/sport) — same set entityResolution.ts's
# CANONICAL_MARKET_KEYS builds via `new Set(Object.values(MARKET_KEY_ALIASES))`.
CANONICAL_MARKET_KEYS = set(MARKET_KEY_ALIASES.values())


def candidate_dimension_to_market_key(dimension: str) -> str | None:
    """Which canonical market key a candidate's own dimension resolves to
    — every generic counting-stat dimension was deliberately named to
    equal its canonical MarketKey one-for-one, so this is mostly just
    confirming the dimension is a real, resolvable market."""
    if dimension == "hit-in-game":
        return "hits"
    if dimension in CANONICAL_MARKET_KEYS:
        return dimension
    return None


def candidate_category_to_side(category: str) -> str | None:
    """Which side of the prop line a candidate's category corresponds to."""
    if category in ("hit", "run", "over"):
        return "over"
    if category in ("no-hit", "no-run", "under"):
        return "under"
    return None


def resolve_market_key(raw_label: str) -> str | None:
    """Resolve a raw stat label to a canonical market key, or None if
    unmapped. Case/whitespace-insensitive so "Total Bases", "total_bases"
    and "totalBases" all land the same place — same triple-normalization
    fallback chain as the TS version, tried in the same order (as-is, then
    spaces/underscores collapsed to one underscore, then removed entirely)."""
    normalized = raw_label.strip().lower()
    return (
        MARKET_KEY_ALIASES.get(normalized)
        or MARKET_KEY_ALIASES.get(_MARKET_KEY_WS_RE.sub("_", normalized))
        or MARKET_KEY_ALIASES.get(_MARKET_KEY_WS_RE.sub("", normalized))
    )


# ---------------------------------------------------------------------------
# Bookmaker names — copied verbatim from entityResolution.ts's BOOKMAKER_ALIASES
# ---------------------------------------------------------------------------

BOOKMAKER_ALIASES: dict[str, str] = {
    "draftkings": "draftkings",
    "fanduel": "fanduel",
    "fanatics": "fanatics",
    "betmgm": "betmgm",
    "caesars": "caesars",
    "pinnacle": "pinnacle",
    "espnbet": "espnbet",
    "bovada": "bovada",
    "pointsbet": "pointsbet",
    "unibet": "unibet",
    "bet365": "bet365",
    "betrivers": "betrivers",
    "underdogfantasy": "underdog",
    "underdog": "underdog",
    "prizepicks": "prizepicks",
    "novig": "novig",
    "pick6(draftkings)": "pick6",
    "pick6": "pick6",
    "sleeper": "sleeper",
    "betr": "betr",
    "betrpicks": "betr",
    "hardrockbet": "hardrockbet",
    "hardrock": "hardrockbet",
    "fliff": "fliff",
    "parxcasino": "parx",
    "parx": "parx",
    "betparx": "betparx",
    "ballybet": "ballybet",
    "kalshi": "kalshi",
    "polymarket": "polymarket",
    "prophetx": "prophetx",
    "10bet": "10bet",
    "wynnbet": "wynnbet",
    "betonline": "betonline",
    "bodog": "bodog",
    "circa": "circa",
    "thescore": "thescore",
}

_BOOKMAKER_STRIP_RE = re.compile(r"[\s._-]+")


def normalize_bookmaker(raw: str) -> str | None:
    key = _BOOKMAKER_STRIP_RE.sub("", raw.strip().lower())
    return BOOKMAKER_ALIASES.get(key)


# ---------------------------------------------------------------------------
# Unresolved-row helpers
# ---------------------------------------------------------------------------


@dataclass
class UnresolvedRow:
    kind: str  # 'player' | 'market' | 'bookmaker'
    raw_value: str
    context: str | None = None


def unresolved_player(raw_value: str, context: str | None = None) -> UnresolvedRow:
    return UnresolvedRow("player", raw_value, context)


def unresolved_market(raw_value: str, context: str | None = None) -> UnresolvedRow:
    return UnresolvedRow("market", raw_value, context)


def unresolved_bookmaker(raw_value: str, context: str | None = None) -> UnresolvedRow:
    return UnresolvedRow("bookmaker", raw_value, context)
