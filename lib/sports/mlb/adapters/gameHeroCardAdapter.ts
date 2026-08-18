import type { GameDetailGame } from '@/components/GameDetail';
import type { GameHeroModel, GameHeroTeamPanelData, VenueForecastData } from '@/components/GameHeroCard';
import type { RecentGameResult } from '@/lib/sports/mlb/statsapi';
import type { MoneylineResult } from '@/lib/sports/mlb/gameModel';
import { computeRecommendedMoneylinePick, computeTotalLean } from '@/lib/odds/recommendedPick';
import type { GamePickView } from '@/components/useGamePickRecord';
import { teamPrimaryColor, withAlpha } from '@/lib/sports/mlb/teamColors';
import { mlbTeamLogoUrl } from '@/components/SubjectAvatar';
import { toTeamRecordsData, computeStreak, toRecentResultRow, type TeamRecordsData } from './gameDetailAdapter';

/**
 * MLB → generic transforms for `GameHeroCard.tsx`, per
 * `docs/sport-adapter-design.md` §2. Phase 2: `GameHeroCard.tsx` itself is
 * now genericized (`GameHeroModel`/`GameHeroTeamPanelData`/
 * `VenueForecastData` live there, canonically, and are imported here rather
 * than redeclared — same precedent `PicksPanelGame` established) — these
 * functions produce its real props from data GameDetail.tsx's own hero-card
 * call site already computes (GameDetail.tsx:1708-1720, 1759-1770) or that
 * `TeamPanel`/`VenueForecastFooter` already read. Reuses
 * `gameDetailAdapter.ts`'s `toTeamRecordsData`/`computeStreak`/
 * `toRecentResultRow` rather than duplicating that logic, as instructed.
 */
type TeamGameContext = NonNullable<GameDetailGame['away']>;

// ---------------------------------------------------------------------------
// §2 — model field (recommendedPick / totalLean / gamePick)
// ---------------------------------------------------------------------------

/**
 * Composes the two pure model functions GameDetail.tsx already calls
 * (`computeRecommendedMoneylinePick`, `computeTotalLean` —
 * GameDetail.tsx:1713-1714) into the single `model` object
 * `GameHeroCardProps` wants (design doc §2). `gamePick` is passed through
 * rather than recomputed here: it comes from `useGamePickHistory()`
 * (GameDetail.tsx:1716-1720), a React hook, which can't run inside a plain
 * adapter function — the caller (still GameDetail.tsx today, a future
 * generic `GameHeroCard` in Phase 2/3) calls the hook and hands its result
 * in.
 */
export function toGameHeroModel(
  gameModel: MoneylineResult | null | undefined,
  moneyline: { away?: number | null; home?: number | null } | null | undefined,
  total: { point?: number | null } | null | undefined,
  trustedMarkets: ReadonlySet<string>,
  gamePick: GamePickView | null,
): GameHeroModel {
  return {
    recommendedPick: computeRecommendedMoneylinePick(gameModel, moneyline, trustedMarkets),
    totalLean: computeTotalLean(gameModel, total),
    gamePick,
  };
}

// ---------------------------------------------------------------------------
// §2 — GameSummary team-side fields for the hero card: record, divisionRank, streak
// ---------------------------------------------------------------------------

export interface GameHeroTeamSummary extends TeamRecordsData {
  /** From `computeStreak` over that team's last 5 results — `TeamPanel`'s `streak` prop (GameHeroCard.tsx:249, computed at GameHeroCard.tsx:392/402). */
  streak: number;
}

/**
 * `TeamPanel`'s three data-driven fields — record, `divisionRank`, and
 * streak (GameHeroCard.tsx:234-279) — folded into one call, reusing
 * `toTeamRecordsData` for record/divisionRank and the widened
 * `computeStreak`/`toRecentResultRow` for streak instead of duplicating
 * either. `recentGames` should already be sliced to the last 5 the same way
 * `MatchupTab` does today (`(awayRecent?.recent ?? []).slice(0, 5)`,
 * GameHeroCard.tsx:392) — this function doesn't re-slice, it trusts the
 * caller the same way `computeStreak` itself always has.
 */
export function toGameHeroTeamSummary(
  ctx: TeamGameContext,
  abbr: string,
  logoUrl: string,
  recentGames: RecentGameResult[],
): GameHeroTeamSummary {
  return {
    ...toTeamRecordsData(ctx, abbr, logoUrl),
    streak: computeStreak(recentGames.map(toRecentResultRow)),
  };
}

/**
 * Full `GameHeroTeamPanelData` for `GameHeroCard`'s `TeamPanel` — wraps
 * `toGameHeroTeamSummary` and adds the two fields only the hero card (not
 * `RecordsSection`/`LastFiveGames`) needs: a pre-resolved color tint (via
 * MLB's own `teamPrimaryColor()`/`withAlpha()`, `GameHeroCard.tsx`'s old
 * `TeamPanel` computed this inline at `withAlpha(teamPrimaryColor(teamId), '26')`,
 * same alpha value preserved here) and a team-page link href. `renderBadges`
 * is left undefined — MLB has no grade-chip equivalent, matching NFL's own
 * `grades` field staying null elsewhere in this design.
 *
 * `ctx` is optional because `GameDetailGame.away`/`.home` themselves are
 * (`GameDetail.tsx:70-77`) — the original `TeamPanel` read `game.away?.record
 * ?? null` etc. with optional chaining rather than assuming the context was
 * loaded; this mirrors that exact graceful-degradation instead of forcing
 * the caller to fabricate a `TeamGameContext`.
 */
export function toGameHeroTeamPanelData(
  ctx: TeamGameContext | undefined,
  teamId: number | undefined,
  abbr: string,
  name: string | undefined,
  recentGames: RecentGameResult[],
): GameHeroTeamPanelData {
  const logoUrl = mlbTeamLogoUrl(teamId) ?? '';
  const summary = ctx ? toGameHeroTeamSummary(ctx, abbr, logoUrl, recentGames) : null;
  return {
    abbr,
    teamId,
    name,
    href: teamId ? `/mlb/team/${teamId}` : undefined,
    logoUrl,
    record: summary?.record ?? null,
    divisionRank: summary?.divisionRank ?? null,
    streak: summary?.streak ?? computeStreak(recentGames.map(toRecentResultRow)),
    tintColor: withAlpha(teamPrimaryColor(teamId), '26'),
  };
}

// ---------------------------------------------------------------------------
// §2 — GameSummary weather field (VenueForecastFooter)
// ---------------------------------------------------------------------------

/**
 * `VenueForecastFooter`'s three props (GameHeroCard.tsx:96-104, called at
 * GameHeroCard.tsx:442) are already plain pass-throughs of fields
 * `SlateGame`/`GameDetailGame` carry natively (`venue`, `weather` —
 * lib/odds/matching.ts:32,42 — and `weatherNarrative` —
 * GameDetail.tsx:73) — no MLB-specific transform is actually needed, this
 * just names the grouping `GameSummary` needs. Real per the design doc's own
 * finding (§2 table): NFL's `GameMetaResponse` carries no weather field at
 * all, so this stays optional/nullable on the generic side, not something
 * every sport can populate.
 */
export function toVenueForecast(game: GameDetailGame): VenueForecastData {
  return {
    venue: game.venue,
    weather: game.weather,
    weatherNarrative: game.weatherNarrative,
  };
}
