/**
 * MLB's Slate adapter (S1).
 *
 * `toSlateData` is the same export name every sport's slate adapter uses; only
 * the import path differs. The shared work is `buildSlateGames`; what is here
 * is what MLB genuinely has that the others do not — probable starters with
 * their season line, the park factor, an area-forecast weather chip, and its
 * own game model.
 *
 * THE MODEL ROW FOLLOWS M1's DISPLAY RULE, and MLB's game model is `baseline`,
 * not `gated` (its own CLV backtest puts it below the close: mean −0.0563
 * prob-points, 38.0% positive on 305 of 448 matched picks, re-measured live
 * 2026-09-20). So the row shows the PICK and the expected runs, and no
 * probability. `percent` is deliberately left unset rather than computed and
 * hidden — see queue row Q0. Switching it on later is additive.
 */

import type { SlateGame } from '@/lib/odds/matching';
import type { UnifiedGameLine } from '@/lib/odds/types';
import { buildSlateGames, type SlateSpec } from '../../shared/buildSlate';
import type { SlateData, SlateModelRow } from '../../shared/slateShapes';
import { mlbLogo, splitMatchup } from '../../shared/slateLogos';

/** "Jackson Jobe · 3.89 ERA · 34 K" — the line under a team's name. */
function starterNote(game: SlateGame, side: 'home' | 'away'): string | null {
  const name = side === 'home' ? game.homeStarter : game.awayStarter;
  if (!name) return null;
  const stats = side === 'home' ? game.homeStarterStats : game.awayStarterStats;
  // `StarterRankStat` carries its own `decimals`; printing the raw number
  // would put "3.8899999 ERA" on the card.
  const stat = (label: string) => {
    const s = stats?.find((x) => x.label?.toLowerCase() === label);
    return s ? s.value.toFixed(s.decimals) : null;
  };
  const era = stat('era');
  const k = stat('k') ?? stat('so');
  return [name, era ? `${era} ERA` : null, k ? `${k} K` : null].filter(Boolean).join(' · ');
}

/**
 * The weather chip. An AREA FORECAST — a compass direction, never "blowing
 * out", because the park's orientation is not held and the two are different
 * claims (`slate-sheet-cards.md` §1).
 */
function weatherPhrase(game: SlateGame): string | null {
  const w = game.weather;
  if (!w) return null;
  const parts = [
    w.tempF != null ? `${Math.round(w.tempF)}°` : null,
    w.windMph != null ? `wind ${Math.round(w.windMph)} mph${w.windDir ? ` ${w.windDir}` : ''}` : null,
    w.rainPct != null ? `rain ${Math.round(w.rainPct)}%` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function modelRow(game: SlateGame): SlateModelRow | null {
  const m = game.gameModel;
  if (!m) return null;
  const home = m.homeWinProb >= m.awayWinProb;
  const [awayAbbr, homeAbbr] = splitMatchup(game.matchup);
  const pick = home ? homeAbbr || (game.homeTeamName ?? '') : awayAbbr || (game.awayTeamName ?? '');
  if (!pick) return null;
  const runs =
    Number.isFinite(m.homeExpectedRuns) && Number.isFinite(m.awayExpectedRuns)
      ? `${(home ? m.homeExpectedRuns : m.awayExpectedRuns).toFixed(1)}–${(home ? m.awayExpectedRuns : m.homeExpectedRuns).toFixed(1)} runs`
      : null;
  return {
    pick,
    // No probability: the model has not cleared its own gate. Q0.
    detail: runs,
    note: 'Expected runs from season form, the starters and the park. It is not a price and it is not compared to one.',
  };
}

export const MLB_SLATE_SPEC: SlateSpec = {
  noun: 'games',
  logoUrl: (g, side) => mlbLogo(side === 'home' ? g.homeTeamId : g.awayTeamId),
  teamNote: starterNote,
  // The venue is already in the card's header; repeating it as a chip was
  // the same fact twice.
  context: (g) => {
    const w = weatherPhrase(g);
    return w ? [w] : [];
  },
  href: (g) => (g.gamePk != null ? `/mlb/game/${g.gamePk}` : null),
  model: modelRow,
};

export function toSlateData(input: {
  date: string;
  games: SlateGame[];
  lines: UnifiedGameLine[];
  propCounts?: Map<string, number>;
  warnings?: string[];
}): SlateData {
  return {
    sport: 'mlb',
    date: input.date,
    fetchedAt: new Date().toISOString(),
    games: buildSlateGames({ games: input.games, lines: input.lines, date: input.date, propCounts: input.propCounts, spec: MLB_SLATE_SPEC }),
    warnings: input.warnings ?? [],
  };
}
