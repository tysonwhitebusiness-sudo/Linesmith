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
import { buildSlateGames, type EloPick, type SlateSpec } from '../../shared/buildSlate';
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

/**
 * The card's model row names the LOCKED pick from `game_picks` — the same pick
 * the Slate's Model section lists — and only falls back to the snapshot's
 * win probability when the pick job has not written one yet. Deriving it
 * from the snapshot alone put TOR/SF on the cards while the Model section
 * said BAL/MIN (S5, SL-27): two near-coin-flip games, two sources, one page.
 * Expected runs are printed away–home, which is a forecast rather than a
 * second pick.
 */
function modelRow(game: SlateGame, locked: EloPick | undefined): SlateModelRow | null {
  const m = game.gameModel;
  const [awayAbbr, homeAbbr] = splitMatchup(game.matchup);
  const side = locked?.side ?? (m ? (m.homeWinProb >= m.awayWinProb ? 'home' : 'away') : null);
  if (!side) return null;
  const pick = side === 'home' ? homeAbbr || (game.homeTeamName ?? '') : awayAbbr || (game.awayTeamName ?? '');
  if (!pick) return null;
  const runs =
    m && Number.isFinite(m.homeExpectedRuns) && Number.isFinite(m.awayExpectedRuns)
      ? `${awayAbbr || 'Away'} ${m.awayExpectedRuns.toFixed(1)} · ${homeAbbr || 'Home'} ${m.homeExpectedRuns.toFixed(1)} runs`
      : null;
  return {
    pick,
    // No probability: the model has not cleared its own gate. Q0.
    detail: runs,
    note: 'Expected runs from season form, the starters and the park. It is not a price and it is not compared to one.',
  };
}

/**
 * What the Model section says about itself. No record and no probability:
 * against the closing price the picks have not yet shown an advantage (Q0).
 * Plain words — the model's tier names are internal.
 */
export const MODEL_NOTE =
  'The picks lock before first pitch. They are shown without a probability or a record until they beat the closing price over a measured sample.';

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
  model: (g) => modelRow(g, undefined),
};

export function toSlateData(input: {
  date: string;
  games: SlateGame[];
  lines: UnifiedGameLine[];
  propCounts?: Map<string, number>;
  /** Locked picks from `game_picks`, by game id. */
  picks?: Map<string, EloPick>;
  warnings?: string[];
}): SlateData {
  const spec: SlateSpec = { ...MLB_SLATE_SPEC, model: (g) => modelRow(g, g.gamePk != null ? input.picks?.get(String(g.gamePk)) : undefined) };
  return {
    sport: 'mlb',
    date: input.date,
    fetchedAt: new Date().toISOString(),
    games: buildSlateGames({ games: input.games, lines: input.lines, date: input.date, propCounts: input.propCounts, spec }),
    // The Model section (S5) lists these picks; declared here so the shell
    // asks for it by data, not by sport.
    modelPicks: { note: MODEL_NOTE },
    warnings: input.warnings ?? [],
  };
}
