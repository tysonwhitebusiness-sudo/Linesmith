/**
 * The game page's venue/forecast strip, from the candidates already on the
 * page — Phase 6.15.
 *
 * WHY IT READS CANDIDATES. `GameDetailData.hero.venue` was `null` on every
 * sport but MLB, and the plan called this a sourcing gap. It was not: NFL's
 * and CFB's snapshot adapters have resolved per-game weather since 6.10 and
 * hang it on every candidate for that game as `context.weather`. The forecast
 * was already in the browser; nothing read it back out. 6.15 added the venue
 * NAME beside it (`PickContext.venueName`), which was the one piece genuinely
 * missing — the strip's heading is the stadium.
 *
 * NOT A SECOND FETCH, DELIBERATELY. A game route could ask ESPN for the venue
 * again, but the answer is already here and a page-load network call that
 * re-derives known data is the exact cost `CLAUDE.md`'s caching section exists
 * to stop.
 *
 * A GAME WITH NO CANDIDATES GETS NO STRIP. That is honest rather than a
 * degradation to hide: with no props tracked for a game, nothing on the page
 * carries its context, and an empty forecast card would claim a reading we do
 * not have.
 */

import type { PickCandidate } from '@/lib/core/types';
import type { VenueForecastData } from '@/components/GameHeroCard';

/**
 * `null` when no candidate carries a venue name or a forecast — the hero then
 * renders no strip at all, which is what `hero.venue`'s `null` already means.
 *
 * Returns on the FIRST candidate carrying context rather than merging across
 * them: every candidate for one game is stamped from the same per-game
 * resolution, so a second opinion would be the same opinion.
 *
 * `weatherNarrative` stays null. MLB writes a real sentence about how the air
 * plays for a batted ball; there is no equivalent for football and inventing
 * one from temperature and wind would be a sentence we made up.
 */
export function toVenueForecastFromCandidates(
  candidates: readonly PickCandidate[],
  /**
   * The venue name straight off the game's own meta, when the sport's game
   * route reports one. PREFERRED over the candidates' copy, because it is
   * there even for a game with no tracked props -- NFL's game response carries
   * `game.venue.fullName` on every event. CFB's `CfbGameMeta` does not parse a
   * venue at all, so it passes nothing and falls back to the candidates.
   */
  venueNameFromMeta?: string,
): VenueForecastData | null {
  for (const c of candidates) {
    const ctx = c.context;
    if (!ctx) continue;
    const { weather } = ctx;
    const venueName = venueNameFromMeta ?? ctx.venueName;
    if (!weather && !venueName) continue;
    return {
      ...(venueName ? { venue: venueName } : {}),
      ...(weather
        ? {
            weather: {
              tempF: weather.tempF,
              windMph: weather.windMph,
              windDir: weather.windDir,
              rainPct: weather.rainPct,
            },
          }
        : {}),
      weatherNarrative: null,
    };
  }
  // No candidate carried context, but the game's own meta may still name the
  // venue -- a game with no tracked props still has a stadium.
  return venueNameFromMeta ? { venue: venueNameFromMeta, weatherNarrative: null } : null;
}
