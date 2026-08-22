"""Partial port of lib/sports/golf/venues.ts — not a reimplementation of
the part it covers. Ports `venueCoords` (the static, exact-coordinates
table for recurring PGA Tour venues) only. `resolveCourseCoords`'s
city-level geocode fallback (via lib/weather/openMeteo.ts's `geocode`,
for a course not in this table) is NOT ported — a disclosed
simplification: most major/recurring tournaments are already in this
24-venue table, and the wind signal it feeds (golf_models.py's
predict_round_score) is a minor effect gated behind wind > 10mph, not
worth a second geocoding integration for this pass. A course missing
from this table simply gets no weather this poll, same "degrade
honestly" contract as every other optional signal in this codebase.
"""
import re

VenueCoords = tuple[float, float]  # (latitude, longitude)

_VENUES: dict[str, VenueCoords] = {
    "tpc southwind": (35.0656, -89.7936),
    "augusta national golf club": (33.503, -82.02),
    "tpc sawgrass": (30.1975, -81.3959),
    "pebble beach golf links": (36.5681, -121.9483),
    "bethpage black": (40.7378, -73.4632),
    "oakmont country club": (40.5223, -79.8309),
    "pinehurst no. 2": (35.1954, -79.4695),
    "muirfield village golf club": (40.0784, -83.1652),
    "east lake golf club": (33.7385, -84.3097),
    "quail hollow club": (35.1499, -80.8781),
    "tpc scottsdale": (33.6467, -111.9192),
    "torrey pines golf course": (32.8944, -117.2531),
    "riviera country club": (34.0409, -118.5065),
    "harbour town golf links": (32.1465, -80.8187),
    "colonial country club": (32.7357, -97.3719),
    "the players stadium course": (30.1975, -81.3959),
    "valhalla golf club": (38.2298, -85.4249),
    "southern hills country club": (36.0736, -95.9411),
    "winged foot golf club": (40.9557, -73.7679),
    "shinnecock hills golf club": (40.891, -72.4501),
    "the old course at st andrews": (56.3433, -2.8028),
    "royal liverpool golf club": (53.3789, -3.1858),
    "tpc river highlands": (41.6081, -72.6262),
    "detroit golf club": (42.4237, -83.1385),
    "the concession golf club": (27.4467, -82.4531),
}

_NORMALIZE_RE = re.compile(r"[^a-z0-9\s]")
_WS_RE = re.compile(r"\s+")


def _normalize(name: str) -> str:
    return _WS_RE.sub(" ", _NORMALIZE_RE.sub("", name.lower())).strip()


def venue_coords(course_name: str | None) -> VenueCoords | None:
    """Exact coordinates for a known venue, or None when the course isn't
    in the table yet."""
    if not course_name:
        return None
    normalized = _normalize(course_name)
    exact = _VENUES.get(normalized)
    if exact:
        return exact

    # Loose fallback: a known venue name contained in (or containing) the
    # ESPN course name — catches "TPC Southwind" vs "TPC Southwind Golf Course".
    for key, coords in _VENUES.items():
        if key in normalized or normalized in key:
            return coords
    return None
