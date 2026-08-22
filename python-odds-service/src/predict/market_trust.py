"""Direct port of lib/odds/props/marketTrust.ts — not a reimplementation.

Prop Score v1's Market Trust badge — kept deliberately SEPARATE from the
score itself (see prop_score.py's file header for why folding it in as a
multiplicative term was wrong). This only answers "how much should you
weigh any score from this market at all," a question about the market,
not the pick.

Live Brier Skill Score, not raw Brier: BSS = 1 - (live_brier / naive_brier),
naive_brier = p_bar*(1-p_bar) from that dimension's own live win rate —
fair across rare-event and common markets alike, unlike comparing raw
Brier scores directly. Computed from non-backfill pick_history rows only
(db.live_market_skill).
"""
from typing import Literal

MarketTrust = Literal["proven", "weak", "building", "excluded"]

MARKET_TRUST_LABEL: dict[MarketTrust, str] = {
    "proven": "Proven",
    "weak": "Weak",
    "building": "Building Track Record",
    "excluded": "Excluded",
}

# Below this many live-graded rows, a BSS estimate is noise, not evidence.
TRUST_MIN_LIVE_SAMPLE = 50
# A market whose live model shows this much real skill over its own naive baseline earns Proven.
TRUST_PROVEN_BSS = 0.02
# A market whose live BSS is this far below naive earns a hard Excluded.
TRUST_EXCLUDED_BSS = -0.08


def trust_tier_from_live_bss(bss: float | None, n: int) -> MarketTrust:
    """n < TRUST_MIN_LIVE_SAMPLE -> building, regardless of what the
    (noisy) BSS number happens to say. Only once a dimension has enough
    live-graded rows to say something real does its BSS sign/magnitude
    decide proven / weak / excluded."""
    if bss is None or n < TRUST_MIN_LIVE_SAMPLE:
        return "building"
    if bss <= TRUST_EXCLUDED_BSS:
        return "excluded"
    if bss >= TRUST_PROVEN_BSS:
        return "proven"
    return "weak"
