"""One-off smoke test, not a permanent suite: confirms entity resolution
wired into providers.py actually produces real, correctly-resolved rows
against today's real MLB slate — not just that it runs without crashing.
Only touches SharpAPI and Odds-API.io (both confirmed healthy) — skips
SportsGameOdds (account issue under investigation) and ParlayAPI (credit
exhausted) entirely, so this makes no calls against either.
"""
import asyncio

import httpx

import config
from game_context import load_mlb_games
from providers import fetch_oddsapiio, fetch_sharpapi


async def main():
    games = [g for g in await load_mlb_games() if not g.is_final]
    print(f"{len(games)} live MLB games\n")

    async with httpx.AsyncClient() as client:
        print("=== SharpAPI ===")
        out = await fetch_sharpapi(client, config.SHARPAPI_KEY, games)
        print(f"resolved rows: {len(out.rows)}, unresolved: {len(out.unresolved)}, warnings: {out.warnings}")
        for r in out.rows[:5]:
            print(f"  {r.subject_name:25s} {r.market_key:20s} line={r.line} {r.side:5s} {r.bookmaker:12s} {r.american_odds}")
        if out.unresolved:
            print("  sample unresolved:")
            for u in out.unresolved[:5]:
                print(f"    [{u.kind}] {u.raw_value!r} ({u.context})")

        print("\n=== Odds-API.io ===")
        out2 = await fetch_oddsapiio(client, config.ODDSAPIIO_KEY, games, config.ODDSAPIIO_RATE_PER_HOUR)
        print(f"resolved rows: {len(out2.rows)}, unresolved: {len(out2.unresolved)}, warnings: {out2.warnings}")
        for r in out2.rows[:5]:
            print(f"  {r.subject_name:25s} {r.market_key:20s} line={r.line} {r.side:5s} {r.bookmaker:12s} {r.american_odds}")
        if out2.unresolved:
            print("  sample unresolved:")
            for u in out2.unresolved[:5]:
                print(f"    [{u.kind}] {u.raw_value!r} ({u.context})")


if __name__ == "__main__":
    asyncio.run(main())
