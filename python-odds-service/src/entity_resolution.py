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
    # Propline's own MLB vocabulary, captured LIVE 2026-08-29 (task 5.1,
    # P2 C1). THIS is why "Propline's entire MLB batter-prop feed is
    # discarded" — not the alt-lines the plan focuses on, but the fact that
    # this map had no `batter_*` prefixed entries AT ALL. It carried bare
    # names ("hits"), a `batting_*` prefix, and `pitcher_strikeouts` — but
    # Propline sends `batter_hits`, `batter_rbis`, `batter_home_runs`, and so
    # on, so every single one resolved to None and every row was dropped.
    # Confirmed against the live feed: propline's only surviving MLB market in
    # prop_odds was `pitcher-strikeouts`, the one pitcher key that happened to
    # already be here.
    "batter_hits": "hits",
    "batter_rbis": "rbis",
    "batter_runs": "runs",
    "batter_singles": "singles",
    "batter_doubles": "doubles",
    "batter_triples": "triples",
    "batter_walks": "walks",
    "batter_home_runs": "home-runs",
    "batter_total_bases": "total-bases",
    "batter_strikeouts": "batter-strikeouts",
    "batter_stolen_bases": "stolen-bases",
    "batter_hits_runs_rbis": "hits-runs-rbis",
    "pitcher_outs": "pitcher-outs",
    "pitcher_earned_runs": "earned-runs",
    "pitcher_hits_allowed": "pitcher-hits-allowed",
    "pitcher_walks_allowed": "pitcher-walks-allowed",
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

    # --- NHL (2026-08-22) — kept in lockstep with entityResolution.ts's
    # own NHL section.
    "goals": "goals",
    "player_goals": "goals",
    "shots-on-goal": "shots-on-goal",
    "shots on goal": "shots-on-goal",
    "player_shots_on_goal": "shots-on-goal",
    "blocked-shots": "blocked-shots",
    "blocked_shots": "blocked-shots",
    "player_blocked_shots": "blocked-shots",
    "goals-against": "goals-against",
    "goals_against": "goals-against",

    # --- Scraper vocabulary (P2, 2026-09-24) ---
    # The new canonical keys (scraper_markets.NEW_KEYS), as identity aliases so
    # labels and the drift test know them, and comparenbet's SportsGameOdds
    # spellings, which the paid feeds share. Kept in lockstep with
    # entityResolution.ts (tests/config-drift.test.ts).
    "pass-rush-yards": "pass-rush-yards",
    "targets": "targets",
    "tackles-assists": "tackles-assists",
    "solo-tackles": "solo-tackles",
    "defensive-interceptions": "defensive-interceptions",
    "fumbles-lost": "fumbles-lost",
    "extra-points-made": "extra-points-made",
    "last-td-scorer": "last-td-scorer",
    "fantasy-points": "fantasy-points",
    "to-receive-card": "to-receive-card",
    "pitcher-pitches-thrown": "pitcher-pitches-thrown",
    "pitcher-strikes-thrown": "pitcher-strikes-thrown",
    "pitcher-batters-faced": "pitcher-batters-faced",
    "pitcher-hits-walks-earned-runs": "pitcher-hits-walks-earned-runs",
    "pitcher-runs-allowed": "pitcher-runs-allowed",
    "longest-pass": "longest-pass",
    "rush-yards-per-attempt": "rush-yards-per-attempt",
    "sets-won": "sets-won",
    "sets-played": "sets-played",
    "games-played": "games-played",
    "tiebreakers-played": "tiebreakers-played",
    "double-faults": "double-faults",
    "break-points-won": "break-points-won",
    "points-won": "points-won",
    "strokes": "strokes",
    "birdies-or-better": "birdies-or-better",
    "bogeys-or-worse": "bogeys-or-worse",
    "goalie-fantasy-points": "goalie-fantasy-points",
    "player_touchdowns": "anytime-td",
    "player_reception_yds": "receiving-yards",
    "player_rush_yds": "rushing-yards",
    "player_pass_yds": "passing-yards",
    "player_1st_td": "first-td-scorer",
    "player_anytime_td": "anytime-td",
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
# Propline alt-line folding (task 5.1, P2 C1 / P2 H2, Q4).
#
# BUILT FROM A LIVE PROPLINE RESPONSE on 2026-08-29, per 5.1's own warning
# ("build the map from Propline's live response, not from memory"), using the
# propline_2 key under operator decision Q31. 45 MLB events, 27 market keys.
#
# The plan's four-row table (batter_2plus_hits / _3plus_hits / _2plus_rbis /
# _3plus_rbis) turned out to be REAL but INCOMPLETE. Propline actually offers
# eight key-encoded alt-lines, and — the part no table anticipated — it encodes
# the same information in THREE different places depending on the book:
#
#   1. in the market key      "batter_2plus_hits", point: null
#   2. in the outcome name    key "batter_strikeouts", name "2+ Strikeouts"
#   3. as a real point        key "batter_hits", name "Over", point 0.5
#
# Only (3) was ever handled. (1) and (2) both arrived with point=null and an
# outcome name that is not "Over"/"Under", so _normalize_row's
# `side = "under" if "under" in name else "over"` labelled every one of them an
# over at line=None — which is also why prop_odds holds 37,939 'over' against
# 5,111 'under'.
#
# WHAT THIS DELIBERATELY DOES NOT DO. There is a fourth shape: Bovada sends the
# PLAYER NAME as the outcome name with no point at all (key "batter_home_runs",
# name "Ali Sanchez (NYY)", price +1100). That is almost certainly an anytime
# market, i.e. over 0.5 — but "almost certainly" is exactly what 5.1 warns
# against, because a wrong line creates a duplicate proposition at the wrong
# number, which is worse than discarding the feed. Those rows are left to the
# existing path and now land in odds_unresolved where they are visible. Both
# rules below are LITERAL: the threshold is stated in the string being parsed,
# never inferred from a price.
#
# "2+" is over 1.5, not over 2 — a 2+ bet wins on exactly 2.
# ---------------------------------------------------------------------------

# "batter_2plus_hits" -> ("hits", 2).  Key-encoded (shape 1).
_ALT_LINE_KEY_RE = re.compile(r"^(?:batter|pitcher)_(\d+)plus_(.+)$")
# "2+ Total Bases", "1+ Home Runs" -> 2 / 1.  Name-encoded (shape 2).
_ALT_LINE_NAME_RE = re.compile(r"^(\d+)\+\s")


def resolve_alt_line(raw_market_label: str, outcome_name: str | None) -> tuple[str, float] | None:
    """Fold a Propline alt-line onto its base market and a real line.

    Returns (canonical_market_key, line) for an over, or None when this is not
    an alt-line and the caller should carry on as before.

    An "N+" proposition is "over N-0.5": 2+ hits wins on exactly 2 hits, so the
    line is 1.5. Getting this off by one would create a duplicate proposition at
    the wrong number, which 5.1 correctly calls worse than discarding the feed.
    """
    key_match = _ALT_LINE_KEY_RE.match(raw_market_label.strip().lower())
    if key_match:
        threshold, base_label = key_match.group(1), key_match.group(2)
        base = resolve_market_key(base_label)
        if base:
            return base, int(threshold) - 0.5
        return None

    if outcome_name:
        name_match = _ALT_LINE_NAME_RE.match(outcome_name.strip())
        if name_match:
            base = resolve_market_key(raw_market_label)
            if base:
                return base, int(name_match.group(1)) - 0.5
    return None


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
    # Added 2026-08-29 (task 5.3). Every one of these was already arriving in
    # game_odds_book_lines under two or three spellings; they are listed here
    # so the registry is a real inventory of books this app has actually seen,
    # rather than only the ones the prop path happened to resolve. "lowvig"
    # and "mybookie" in particular MUST be here for the suffix rule below to
    # collapse "LowVig.ag"/"MyBookie.ag" onto them.
    "lowvig": "lowvig",
    "mybookie": "mybookie",
    "matchbook": "matchbook",
    "smarkets": "smarkets",
    "rebet": "rebet",
    "onexbet": "onexbet",
    "tabau": "tabau",
    # BetUS is a real book whose name genuinely ends in "us". Listing it
    # explicitly means the exact-match lookup wins before the suffix rule can
    # strip it down to the nonexistent "bet".
    "betus": "betus",

    # --- Scraper books (P2, 2026-09-24) ---
    # Identity aliases, so canonical_bookmaker keeps these books rather than
    # cleaning them to an unknown, plus the spellings the scraper already uses.
    # Kept in lockstep with entityResolution.ts (tests/config-drift.test.ts).
    "sugarhouse": "sugarhouse",
    "ladbrokes": "ladbrokes",
    "bookmaker": "bookmaker",
    "polymarketus": "polymarketus",
    "courtside": "courtside",
    "everygame": "everygame",
    "betmgmnv": "betmgmnv",
    "caesarsnv": "caesarsnv",
    "wynn": "wynn",
    "stations": "stations",
    "boomers": "boomers",
    "southpoint": "southpoint",
    "westgate": "westgate",
    "coolbet": "coolbet",
    "betanysports": "betanysports",
    "playup": "playup",
    "nordicbet": "nordicbet",
    "tabtouch": "tabtouch",
    "riverscasino": "riverscasino",
    "betfairexchange": "betfairexchange",
    "betfairsportsbook": "betfairsportsbook",
    "betfair": "betfair",
    "leovegas": "leovegas",
    "grosvenor": "grosvenor",
    "betsson": "betsson",
    "gtbets": "gtbets",
    "casumo": "casumo",
    "marathonbet": "marathonbet",
    "tab": "tab",
    "betvictor": "betvictor",
    "sportsbet": "sportsbet",
    "virginbet": "virginbet",
    "livescorebet": "livescorebet",
    "coral": "coral",
    "betway": "betway",
    "bet105": "bet105",
    "neds": "neds",
    "skybet": "skybet",
    "betrsportsbook": "betrsportsbook",
    "betano": "betano",
    "betanything": "betanything",
    "boylesports": "boylesports",
    "tipico": "tipico",
    "heritage": "heritage",
    "888sport": "888sport",
    "paddypower": "paddypower",
    "aceshigh": "aceshigh",
    "justbet": "justbet",
    "williamhill": "williamhill",
    "bookmakereu": "bookmaker",
    "1xbet": "onexbet",
    "pinnaclesports": "pinnacle",
    "prophetexchange": "prophetx",
    "thescorebet": "thescore",
    "bally": "ballybet",
    "hardrockbetfl": "hardrockbet",
}

_BOOKMAKER_STRIP_RE = re.compile(r"[\s._-]+")


def normalize_bookmaker(raw: str) -> str | None:
    key = _BOOKMAKER_STRIP_RE.sub("", raw.strip().lower())
    return BOOKMAKER_ALIASES.get(key)


# Regional/licence suffixes the-odds-api appends to a book's key —
# `bet365.us`, `BetOnline.ag`, `LowVig.ag`, `MyBookie.ag`. Stripped ONLY when
# what remains is itself a known book, which is why the exact-match lookup in
# canonical_bookmaker runs first: "betus" is a real sportsbook whose name ends
# in "us", and a blind strip would turn it into the nonexistent "bet".
_BOOKMAKER_REGION_SUFFIXES = ("us", "ag", "au", "uk", "eu", "ca")


def canonical_bookmaker(raw: str | None) -> str | None:
    """Collapse a bookmaker string to one canonical spelling, for the GAME-LINE
    path. Deliberately NOT the same function as normalize_bookmaker above.

    The two differ in exactly one way, and the difference is the point:
    normalize_bookmaker returns None for a book it doesn't recognise, and the
    prop path relies on that — a None there is what pushes the row into
    `odds_unresolved` so an unknown book gets noticed instead of silently
    stored. Game lines have no such reporting path, and dropping a real price
    from 22 books because its spelling is new would be strictly worse than
    storing it under its own cleaned name. So this one always returns
    something for a non-empty input: an alias when it knows the book, and the
    punctuation-stripped lowercase form when it doesn't.

    Task 5.3 (P3 H9). Before this existed, all four Python producers
    (`_propline_game_line_rows`, the SharpAPI and SportsGameOdds builders in
    providers.py, and odds_lines_cycle.py's the-odds-api path) passed the
    provider's raw string straight through, so `game_odds_book_lines` held 33
    spellings for 22 real books — `fanduel`/`FanDuel`/`Fanduel` was 750 rows
    split three ways. That corrupts best-price selection, which is the core
    Tier B feature, and it is part of why 4.1's de-vig resolution rate sits at
    18%: `_two_sided_devigged_for_row` matches on bookmaker equality, so a
    `Fanduel` over never pairs with a `fanduel` under.
    """
    if not raw:
        return None
    key = _BOOKMAKER_STRIP_RE.sub("", raw.strip().lower())
    if not key:
        return None
    mapped = BOOKMAKER_ALIASES.get(key)
    if mapped:
        return mapped
    for suffix in _BOOKMAKER_REGION_SUFFIXES:
        if key.endswith(suffix):
            base = key[: -len(suffix)]
            if base in BOOKMAKER_ALIASES:
                return BOOKMAKER_ALIASES[base]
    return key




# ---------------------------------------------------------------------------
# Team-name normalisation (task 5.8, P3 M13).
#
# Moved here from harvester_scrape.py, unchanged, so there is ONE
# implementation rather than two. providers.py's _team_match used raw string
# equality, which means a provider changing "LA Galaxy" to "Los Angeles
# Galaxy" — or adding an accent — silently returns zero rows, the same class
# of failure as the 30-of-37 game drop. harvester_scrape.py had already solved
# this properly against real live mismatches; that work is what moved here,
# and harvester_scrape now imports these rather than keeping its own copies.
#
# Every alias below was verified against a real observed mismatch, not guessed
# — the original comments are preserved verbatim for that reason.
# ---------------------------------------------------------------------------

# Word-boundary-guarded aliases (never a blind substring replace — "la"
# would otherwise corrupt "Dallas"/"Atlanta"/etc.), verified against real
# mismatches this session, not guessed: "utd" (EPL: "Manchester Utd" vs our
# own "Manchester United"), "lafc" and standalone "la" (MLS: ESPN's own
# acronyms "LAFC"/"LA Galaxy" vs OddsPortal's spelled-out "Los Angeles
# FC"/"Los Angeles Galaxy" — LAFC has no separate nickname, "Los Angeles FC"
# IS its full name, not a different club).
TEAM_NAME_ALIASES: list[tuple[str, str]] = [
    (r"\butd\b", "united"),
    # P3 (odds build, 2026-09-24): the scraper's sources write "Man City" /
    # "Man Utd". Anchored at the start and to a whole word, so it can only
    # expand a leading "Man " (never "Mansfield"), and "Man Utd" becomes
    # "manchester united", which still never matches Manchester City.
    (r"^man\b", "manchester"),
    (r"\blafc\b", "los angeles fc"),
    (r"\bla\b", "los angeles"),
]

# Whole-name aliases, anchored (^...$) rather than substring - deliberately
# NOT added to TEAM_NAME_ALIASES above, because college football is full of
# real, distinct "X" vs "X State" school pairs (Michigan/Michigan State,
# Ohio/Ohio State, Washington/Washington State, ...) where a substring or
# missing-word rule would risk silently cross-matching two different real
# teams. These are narrow, exact full-name equivalents verified live this
# session, not a general pattern: OddsPortal spells NC State out in full
# ("North Carolina State") where ESPN's own name already uses the
# abbreviated "NC State Wolfpack"; OddsPortal renders Sacramento State's
# "California State" system prefix as "CS Sacramento" where ESPN uses
# "Sacramento State Hornets". Anchored so they can only ever replace the
# ENTIRE name, never a substring within some other school's longer name.
_FULLTEAM_NAME_ALIASES: dict[str, str] = {
    "north carolina state": "nc state",
    "cs sacramento": "sacramento state",
}

# Below this many characters, substring containment risks a coincidental
# false match rather than a real shortened-name relationship — real bug
# caught before shipping: naive containment on "la" (2 chars) happened to
# match "LA Galaxy" against "Los Angeles Galaxy" here, but only because "la"
# coincidentally appears inside "gaLAxy" itself; the same check would just
# as readily mismatch "la" against "Atlanta" or "Dallas" in a league that
# had one. The alias table above is the real fix for known short forms;
# this guard is what makes the FALLBACK safe for names it doesn't cover.
MIN_CONTAINMENT_LEN = 4


def strip_accents(name: str) -> str:
    """NFKD-decompose then drop combining marks (unicode category 'Mn') -
    "Montréal" -> "Montreal", "José" -> "Jose". Without this, the plain-a-z
    regex both _norm and _norm_words apply next silently DROPS accented
    letters instead of transliterating them ("Montréal" -> "montral", losing
    the e entirely) rather than matching what OddsPortal's plain-ASCII
    spelling normalizes to ("Montreal" -> "montreal") - real bug, not a data
    problem: confirmed live this session that ESPN's/NHL's own payloads
    already carry the correct real "é" character (json.dumps(...,
    ensure_ascii=True) on the raw NHL API response showed a clean \\u00e9);
    a Windows terminal's inability to DISPLAY that character as anything but
    a garbled replacement glyph earlier this session was mistaken for actual
    data corruption and wrongly written off as an out-of-scope upstream
    encoding bug. It wasn't - it was this normalization gap, and it would
    have silently broken every single Montreal Canadiens (NHL) game."""
    decomposed = unicodedata.normalize("NFKD", name)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalize_team_name(name: str) -> str:
    name = strip_accents(name.lower())
    name = _FULLTEAM_NAME_ALIASES.get(name, name)
    for pattern, replacement in TEAM_NAME_ALIASES:
        name = re.sub(pattern, replacement, name)
    return re.sub(r"[^a-z]", "", name)


def team_name_words(name: str) -> frozenset[str]:
    """Word-set form for the reordering fallback below — "Red Bull New
    York" vs "New York Red Bulls" (MLS, verified live) share every
    significant word, just not the same order, which no amount of prefix/
    substring matching on the joined string can bridge."""
    name = strip_accents(name.lower())
    name = _FULLTEAM_NAME_ALIASES.get(name, name)
    for pattern, replacement in TEAM_NAME_ALIASES:
        name = re.sub(pattern, replacement, name)
    words = re.findall(r"[a-z]+", name)
    return frozenset(w.rstrip("s") for w in words if len(w) >= 3)  # rstrip("s"): Bull vs Bulls


# ---------------------------------------------------------------------------
# Team-pair matching (P3, 2026-09-24). Moved here from harvester_scrape's
# _match_game so the harvester and the scraper bridge share ONE
# implementation; _match_game now calls these, with its pass order unchanged.
# ---------------------------------------------------------------------------
_SURNAME_INITIAL_RE = re.compile(r"^(.+?)\s+([A-Za-z])\.?$")


def team_side_match(raw_norm: str, game_full_name: str, game_abbr: str | None) -> str | None:
    """One side of a game: 'exact' | 'abbr' | 'contain' | None. `raw_norm` is
    normalize_team_name(raw). Abbreviation match is safe on its own (ESPN's
    abbr codes are unique official per-team codes: "TCU Horned Frogs" carries
    "TCU"); containment needs MIN_CONTAINMENT_LEN on both sides (EPL
    "Nottingham" for "Nottingham Forest")."""
    game_n = normalize_team_name(game_full_name)
    if raw_norm == game_n:
        return "exact"
    abbr_n = re.sub(r"[^a-z]", "", (game_abbr or "").lower())
    if abbr_n and raw_norm == abbr_n:
        return "abbr"
    if len(raw_norm) < MIN_CONTAINMENT_LEN or len(game_n) < MIN_CONTAINMENT_LEN:
        return None
    return "contain" if (raw_norm in game_n or game_n in raw_norm) else None


def team_words_match(raw: str, game_full_name: str) -> bool:
    """Word-set equality, order-independent (MLS "Red Bull New York" vs "New
    York Red Bulls")."""
    return team_name_words(raw) == team_name_words(game_full_name)


def surname_initial_matches(short_name: str, full_name: str) -> bool:
    """Tennis "Surname F." (OddsPortal: "Sinner J.") against ESPN's "Jannik
    Sinner". A single-letter initial is dropped by team_name_words, so no
    generic rule bridges it; this is its own parse."""
    m = _SURNAME_INITIAL_RE.match(short_name.strip())
    if not m:
        return normalize_team_name(short_name) == normalize_team_name(full_name)
    surname, initial = m.group(1).lower(), m.group(2).lower()
    full_words = re.findall(r"[a-z]+", full_name.lower())
    if surname.replace(" ", "") not in "".join(full_words):
        return False
    return any(w.startswith(initial) and w != surname for w in full_words) or len(full_words) == 1


def _person_parts(name: str) -> tuple[str, str]:
    """(first, last) of a normalized person name; "Last, First" turned around
    (the odds-scraper's entities._person_parts, same rule)."""
    s = (name or "").strip()
    if "," in s:
        last, _, first = s.partition(",")
        if first.strip() and last.strip():
            s = f"{first.strip()} {last.strip()}"
    parts = normalize_name(s).split()
    if not parts:
        return "", ""
    return ("", parts[0]) if len(parts) == 1 else (parts[0], parts[-1])


def person_names_match(a: str, b: str) -> bool:
    """Two spellings of one player: the "Surname F." form either way round, or
    the odds-scraper's person_match (same last name, and the first initials
    agree when both have one: "M. Andreeva" / "Mirra Andreeva")."""
    if surname_initial_matches(a, b) or surname_initial_matches(b, a):
        return True
    fa, la = _person_parts(a)
    fb, lb = _person_parts(b)
    if not la or la != lb:
        return False
    if not fa or not fb:
        return True
    return fa[0] == fb[0]


_SIDE_STRENGTH = {"exact": 0, "abbr": 1, "contain": 2}


def match_team_pair(home: str, away: str, game, person: bool = False) -> tuple[str, bool] | None:
    """(method, reversed) when (home, away) names `game`, else None. Tried in
    the stated orientation first, then swapped (reversed=True: the given home
    is the game's away). method: the weaker side of 'exact' | 'abbr' |
    'contain', else 'words' (word sets per side), or 'person' when `person`
    (tennis) and both players match by name."""
    for rev in (False, True):
        h, a = (away, home) if rev else (home, away)
        if person:
            if person_names_match(h, game.home_team_name) and person_names_match(a, game.away_team_name):
                return "person", rev
            continue
        hm = team_side_match(normalize_team_name(h), game.home_team_name, game.home_abbr)
        am = team_side_match(normalize_team_name(a), game.away_team_name, game.away_abbr)
        if hm and am:
            return max(hm, am, key=_SIDE_STRENGTH.__getitem__), rev
    if person:
        return None
    for rev in (False, True):
        h, a = (away, home) if rev else (home, away)
        if team_words_match(h, game.home_team_name) and team_words_match(a, game.away_team_name):
            return "words", rev
    return None


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
