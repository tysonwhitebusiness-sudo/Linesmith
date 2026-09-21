"""Which way each MLB park faces, so a wind reading can be turned into "out" or "in".

`lib/sports/mlb/adapter.ts` has refused to use wind direction because one wrong
park silently corrupts that game. This table is the reviewed piece that
refusal was waiting for: one row per 2026 venue, each with its source.

`cf_bearing` is the compass bearing (clockwise from true north) from home plate
through the mound to center field.

SOURCES, and why these and not the Stats API
- The 21 open-air parks come from `apelt001/ballpark-shadow-geometry`,
  `data/park_geometry.csv` (CC BY 4.0), hand-measured in Google Earth Pro as a
  plate->mound path and checked against USGS lidar. That repo documents the
  Stats API's own `azimuthAngle` as wrong for several parks (CLE, SD, MIN,
  ATL), which is why it is not the primary source here.
- Sutter Health Park (the A's, Sacramento) is not in that set. Its row uses
  the Stats API `azimuthAngle` and is the first park on the operator's
  spot-check list (docs/design/SIGNOFF-QUEUE.md).
- Roofed parks carry the Stats API bearing for completeness, but no wind or
  temperature factor is computed for them: a fixed roof has no weather, and a
  retractable roof's open/closed state is in no feed we read.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

_LIDAR = "apelt001/ballpark-shadow-geometry park_geometry.csv (CC BY 4.0), Google Earth Pro plate->mound"
_STATSAPI = "MLB Stats API venue location.azimuthAngle, 2026"


@dataclass(frozen=True)
class Park:
    venue_id: int
    name: str
    team: str
    cf_bearing: float
    roof: str          # 'open' | 'retractable' | 'fixed'
    source: str


PARKS: dict[int, Park] = {p.venue_id: p for p in (
    # --- open air, hand-measured (lidar repo) ---
    Park(1, "Angel Stadium", "LAA", 44.0, "open", _LIDAR),
    Park(2, "Oriole Park at Camden Yards", "BAL", 32.0, "open", _LIDAR),
    Park(3, "Fenway Park", "BOS", 45.0, "open", _LIDAR),
    Park(4, "Rate Field", "CWS", 126.0, "open", _LIDAR),
    Park(5, "Progressive Field", "CLE", 359.4, "open", _LIDAR),
    Park(7, "Kauffman Stadium", "KC", 47.0, "open", _LIDAR),
    Park(17, "Wrigley Field", "CHC", 37.0, "open", _LIDAR),
    Park(19, "Coors Field", "COL", 5.0, "open", _LIDAR),
    Park(22, "UNIQLO Field at Dodger Stadium", "LAD", 26.0, "open", _LIDAR),
    Park(31, "PNC Park", "PIT", 116.0, "open", _LIDAR),
    Park(2394, "Comerica Park", "DET", 150.0, "open", _LIDAR),
    Park(2395, "Oracle Park", "SF", 85.0, "open", _LIDAR),
    Park(2602, "Great American Ball Park", "CIN", 122.0, "open", _LIDAR),
    Park(2680, "Petco Park", "SD", 0.0, "open", _LIDAR),
    Park(2681, "Citizens Bank Park", "PHI", 9.0, "open", _LIDAR),
    Park(2889, "Busch Stadium", "STL", 62.0, "open", _LIDAR),
    Park(3289, "Citi Field", "NYM", 13.0, "open", _LIDAR),
    Park(3309, "Nationals Park", "WSH", 28.0, "open", _LIDAR),
    Park(3312, "Target Field", "MIN", 90.0, "open", _LIDAR),
    Park(3313, "Yankee Stadium", "NYY", 75.0, "open", _LIDAR),
    Park(4705, "Truist Park", "ATL", 157.8, "open", _LIDAR),
    # --- open air, Stats API only (spot-check first) ---
    Park(2529, "Sutter Health Park", "ATH", 46.0, "open", _STATSAPI),
    # --- roofed: no weather factor ---
    Park(12, "Tropicana Field", "TB", 359.0, "fixed", _STATSAPI),
    Park(14, "Rogers Centre", "TOR", 345.0, "retractable", _STATSAPI),
    Park(15, "Chase Field", "AZ", 0.0, "retractable", _STATSAPI),
    Park(32, "American Family Field", "MIL", 129.0, "retractable", _STATSAPI),
    Park(680, "T-Mobile Park", "SEA", 49.0, "retractable", _STATSAPI),
    Park(2392, "Daikin Park", "HOU", 343.0, "retractable", _STATSAPI),
    Park(4169, "loanDepot park", "MIA", 128.0, "retractable", _STATSAPI),
    Park(5325, "Globe Life Field", "TEX", 30.0, "retractable", _STATSAPI),
)}

BY_NAME: dict[str, Park] = {p.name: p for p in PARKS.values()}

# Parks the operator checks against a map after the fact (A5): the one with no
# hand measurement, and the four where the Stats API disagrees with it.
SPOT_CHECK = ("Sutter Health Park", "Progressive Field", "Truist Park", "Target Field", "Petco Park")


def park_for(venue_id: int | None = None, name: str | None = None) -> Park | None:
    if venue_id is not None and venue_id in PARKS:
        return PARKS[venue_id]
    return BY_NAME.get(name or "")


def wind_out_mph(park: Park | None, wind_mph: float | None, wind_from_deg: float | None) -> float | None:
    """The part of the wind blowing from home plate toward center field.

    Positive = blowing out, negative = blowing in. `wind_from_deg` is the
    meteorological direction the wind comes FROM, so a wind from behind home
    plate (from `cf_bearing + 180`) blows straight out. None for a roofed park
    or a missing reading: that is "not measured", never zero.
    """
    if park is None or park.roof != "open" or wind_mph is None or wind_from_deg is None:
        return None
    if not (math.isfinite(wind_mph) and math.isfinite(wind_from_deg)):
        return None
    return round(wind_mph * math.cos(math.radians(wind_from_deg - (park.cf_bearing + 180.0))), 1)


def wind_label(park: Park | None, wind_mph: float | None, out_mph: float | None) -> str | None:
    """The Wind cell's words: "Out 11", "In 6", "Cross 4", or the roof."""
    if park is not None and park.roof == "fixed":
        return "Roof"
    if park is not None and park.roof == "retractable":
        return "Roof — may close"
    if out_mph is None or wind_mph is None:
        return None
    if abs(out_mph) < max(2.0, 0.4 * wind_mph):
        return f"Cross {round(wind_mph)}"
    return f"{'Out' if out_mph > 0 else 'In'} {round(abs(out_mph))}"
