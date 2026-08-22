'use client';

import Link from 'next/link';
import type { SlateEntry } from '@/lib/odds/matching';
import { projectLine } from '@/lib/odds/display';
import { computeMoneylineEdge, computeTotalEdge } from '@/lib/odds/gameEdge';
import { computeRecommendedMoneylinePick, computeTotalLean, type RecommendedMoneylinePick, type TotalLean } from '@/lib/odds/recommendedPick';
import { gradeConfidence } from '@/lib/core/confidence';
import { TeamLogo } from './SubjectAvatar';
import { OddsChip, EdgeBadge } from './OddsChip';
import { BookLogo } from './BookLogo';
import { BookmakerBreakdown } from './GameLine';
import { useGamePickHistory, type GamePickView } from './useGamePickRecord';
import { useMarketCalibration } from './useMarketCalibration';
import { ConfidenceChip } from './ConfidenceChip';
import { StarIcon } from './icons';

function teamLogoUrl(teamId: number | undefined): string | undefined {
  return teamId ? `https://www.mlbstatic.com/team-logos/${teamId}.svg` : undefined;
}

/**
 * Compact overview badge — same pick, same confidence grade as the game
 * detail page, one line.
 *
 * Before a game's 3-hour lock, `pick` only holds the ~6am initial read
 * (see /diagnostics), which can already be stale by the time someone's
 * looking at Scan later in the day. The game detail page's own Linesmith
 * Pick card falls back to a freshly-computed live lean (`recommendedPick`/
 * `totalLean`) for exactly that pre-lock window — this mirrors that same
 * fallback so the two surfaces agree instead of one showing a live lean and
 * the other showing a stale snapshot for the same unlocked game.
 */
function PickStrip({
  pick,
  recommendedPick,
  totalLean,
  awayTeamName,
  homeTeamName,
  awayAbbrev,
  homeAbbrev,
}: {
  pick: GamePickView | undefined;
  recommendedPick: RecommendedMoneylinePick | null;
  totalLean: TotalLean | null;
  awayTeamName?: string;
  homeTeamName?: string;
  awayAbbrev?: string;
  homeAbbrev?: string;
}) {
  const mlLocked = pick?.moneyline.locked ?? false;
  const mlTeam = mlLocked
    ? pick?.moneyline.pickTeamName
    : recommendedPick
      ? ((recommendedPick.side === 'home' ? homeTeamName : awayTeamName) ?? (recommendedPick.side === 'home' ? homeAbbrev : awayAbbrev))
      : null;
  const mlConfidence = mlLocked ? pick?.moneyline.confidence : recommendedPick ? gradeConfidence(recommendedPick.modelProb) : null;

  const totalLocked = pick?.total.locked ?? false;
  const totalSide = totalLocked ? pick?.total.pickSide : (totalLean?.side ?? null);
  const totalLine = totalLocked ? pick?.total.line : (totalLean?.line ?? null);
  const totalConfidence = totalLocked ? pick?.total.confidence : null;

  if (!mlTeam && !totalSide) return null;
  const locked = mlLocked || totalLocked;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-masters/20 bg-accent-soft/50 px-2 py-1.5 text-[11px]">
      <span className="inline-flex items-center gap-1 font-semibold text-masters">
        <StarIcon size={11} /> Linesmith Pick
      </span>
      {mlTeam ? (
        <span className="inline-flex items-center gap-1 lb-chip bg-card text-ink-muted">
          {mlTeam} ML
          {mlConfidence ? <ConfidenceChip letter={mlConfidence.letter} pct={mlConfidence.pct} size="sm" /> : null}
        </span>
      ) : null}
      {totalSide ? (
        <span className="inline-flex items-center gap-1 lb-chip bg-card text-ink-muted">
          {totalSide === 'over' ? 'Over' : 'Under'} {totalLine ?? ''}
          {totalConfidence ? <ConfidenceChip letter={totalConfidence.letter} pct={totalConfidence.pct} size="sm" /> : null}
        </span>
      ) : null}
      {!locked ? <span className="text-ink-faint">not locked yet</span> : null}
    </div>
  );
}

/**
 * The simple game-lines view a Scan toggle away from the player-prop table —
 * moneyline/total per game, with G6's model edge, one card per game. Not
 * interleaved into ScanTable's rows: that table is keyed on a player+market
 * candidate, and a game-level line doesn't have either, so it gets its own
 * small view rather than forcing an awkward row shape onto both.
 */
export function GameLinesView({ entries, onNavigate }: { entries: SlateEntry[]; onNavigate: (gamePk: number) => void }) {
  const pickHistory = useGamePickHistory('mlb');
  const calibration = useMarketCalibration();
  const picksByGame = new Map(pickHistory.rows.map((r) => [r.gameId, r]));

  if (entries.length === 0) {
    return <p className="p-8 text-center text-sm text-ink-muted">No games on today's slate.</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => {
        const gamePk = Number(entry.game.gamePk);
        const projected = entry.line ? projectLine(entry.line) : null;
        const gameModel = entry.game.gameModel ?? null;
        const moneylineEdge = computeMoneylineEdge(gameModel, projected?.moneyline);
        const totalEdge = computeTotalEdge(gameModel, projected?.total);
        const recommendedPick = computeRecommendedMoneylinePick(gameModel, projected?.moneyline, calibration.trustedMarkets);
        const totalLean = computeTotalLean(gameModel, projected?.total);

        return (
          <section key={gamePk} className="lb-card p-3">
            <PickStrip
              pick={picksByGame.get(String(gamePk))}
              recommendedPick={recommendedPick}
              totalLean={totalLean}
              awayTeamName={entry.game.awayTeamName}
              homeTeamName={entry.game.homeTeamName}
              awayAbbrev={entry.awayAbbrev}
              homeAbbrev={entry.homeAbbrev}
            />
            <div className="mb-2 flex w-full items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                <Link href={`/mlb/team/${entry.game.awayTeamId}`} className="flex items-center gap-1.5 hover:underline">
                  <TeamLogo logoUrl={teamLogoUrl(entry.game.awayTeamId)} abbreviation={entry.awayAbbrev} size={20} />
                  {entry.awayAbbrev}
                </Link>
                <span className="text-ink-faint">@</span>
                <Link href={`/mlb/team/${entry.game.homeTeamId}`} className="flex items-center gap-1.5 hover:underline">
                  <TeamLogo logoUrl={teamLogoUrl(entry.game.homeTeamId)} abbreviation={entry.homeAbbrev} size={20} />
                  {entry.homeAbbrev}
                </Link>
              </span>
              <button type="button" onClick={() => onNavigate(gamePk)} className="text-[11px] text-masters">
                {entry.game.state === 'Final' ? 'Final · ' : ''}View game →
              </button>
            </div>

            {!projected?.available ? (
              <p className="text-[12px] text-ink-faint">No game line yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {projected.moneyline ? (
                  <div className="rounded-lg border border-line bg-card p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">Moneyline</span>
                      <BookLogo bookId={projected.moneyline.book} size={12} withLabel />
                    </div>
                    <div className="flex gap-1.5">
                      <OddsChip price={projected.moneyline.away} source={projected.source} side={entry.awayAbbrev} className="flex-1 justify-center" />
                      <OddsChip price={projected.moneyline.home} source={projected.source} side={entry.homeAbbrev} className="flex-1 justify-center" />
                    </div>
                    {moneylineEdge ? (
                      <div className="mt-1 flex gap-1.5">
                        <EdgeBadge edge={moneylineEdge.away} modelProb={moneylineEdge.awayModelProb} marketProb={moneylineEdge.awayMarketProb} label={entry.awayAbbrev ?? 'Away'} />
                        <EdgeBadge edge={moneylineEdge.home} modelProb={moneylineEdge.homeModelProb} marketProb={moneylineEdge.homeMarketProb} label={entry.homeAbbrev ?? 'Home'} />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {projected.total?.point != null ? (
                  <div className="rounded-lg border border-line bg-card p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">Total {projected.total.point}</span>
                      <BookLogo bookId={projected.total.book} size={12} withLabel />
                    </div>
                    <div className="flex gap-1.5">
                      <OddsChip price={projected.total.overPrice} source={projected.source} side={`O${projected.total.point}`} className="flex-1 justify-center" />
                      <OddsChip price={projected.total.underPrice} source={projected.source} side={`U${projected.total.point}`} className="flex-1 justify-center" />
                    </div>
                    {totalEdge ? (
                      <div className="mt-1 flex gap-1.5">
                        <EdgeBadge edge={totalEdge.over} modelProb={totalEdge.overModelProb} marketProb={totalEdge.overMarketProb} label="Over" />
                        <EdgeBadge edge={totalEdge.under} modelProb={totalEdge.underModelProb} marketProb={totalEdge.underMarketProb} label="Under" />
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}

            {projected?.available ? (
              <BookmakerBreakdown
                bookmakers={projected.bookmakers}
                selectedBook={projected.headlineBook}
                awayLabel={entry.awayAbbrev ?? entry.game.awayTeamName ?? 'Away'}
                homeLabel={entry.homeAbbrev ?? entry.game.homeTeamName ?? 'Home'}
              />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export default GameLinesView;
