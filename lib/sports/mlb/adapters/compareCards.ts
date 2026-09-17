/**
 * MLB's own compare card — R10.4: how the chosen opponent has fared against
 * players who bat or throw the way this one does.
 *
 * WHICH SIDE ANSWERS THE QUESTION depends on what the subject is, and getting
 * this backwards would be the card's one real error:
 *
 *   a HITTER faces the opponent's STAFF, so the card reads `pit.vsHand[his bat
 *   hand]` — what those pitchers allow to hitters of his handedness;
 *   a PITCHER faces the opponent's LINEUP, so it reads `bat.vsHand[his throwing
 *   hand]` — how those hitters have done against pitchers of his.
 *
 * A SWITCH HITTER HAS NO ONE SPLIT. MLB reports him as "S", which is neither
 * side's column, so the card is left out rather than picking one at random.
 *
 * Pure: no fetching, no database.
 */

import { formatResearchValue, type ResearchCard } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamStatcastSeason } from '@/lib/sports/mlb/statcastRollupShapes';

export interface MlbCompareInput {
  /** The opponent's stored rollup, both sides. */
  bat: TeamStatcastSeason | null;
  pit: TeamStatcastSeason | null;
  /** "hitter" or "pitcher", as `playerGroup` decides it. */
  role: string | null;
  /** The bio's "Bats / throws", e.g. "L / R". */
  batsThrows: string | null;
  teamAbbr: string;
  season: number;
}

const HAND_WORD: Record<string, string> = { L: 'left-handed', R: 'right-handed' };

/** His bat hand when he hits, his throwing hand when he pitches. */
function handOf(batsThrows: string | null, role: string | null): 'L' | 'R' | null {
  const parts = (batsThrows ?? '').split('/').map((p) => p.trim().toUpperCase());
  const hand = role === 'pitcher' ? parts[1] : parts[0];
  return hand === 'L' || hand === 'R' ? hand : null;
}

export function mlbHandCompareCard(input: MlbCompareInput): ResearchCard | null {
  const hand = handOf(input.batsThrows, input.role);
  if (!hand) return null;
  const facing = input.role === 'pitcher' ? input.bat : input.pit;
  const split = facing?.vsHand?.[hand];
  if (!split || !split.pa) return null;

  const rows = [
    { key: 'pa', label: 'Plate appearances', value: split.pa, decimals: 0 },
    { key: 'avg', label: 'Batting average', value: split.avg, decimals: 3, format: 'rate3' as const },
    { key: 'kPct', label: 'Strikeout %', value: split.kPct, decimals: 1, format: 'percent' as const },
    { key: 'bbPct', label: 'Walk %', value: split.bbPct, decimals: 1, format: 'percent' as const },
    { key: 'hrPct', label: 'Home run %', value: split.hrPct, decimals: 1, format: 'percent' as const },
    { key: 'xwobacon', label: 'xwOBA on contact', value: split.xwobacon, decimals: 3, format: 'rate3' as const },
    { key: 'avgEV', label: 'Average exit velocity', value: split.avgEV, decimals: 1 },
    { key: 'hardHit', label: 'Hard-hit %', value: split.hardHit, decimals: 1, format: 'percent' as const },
  ].filter((r) => r.value != null);
  if (!rows.length) return null;

  const word = HAND_WORD[hand];
  return {
    kind: 'table',
    key: 'mlb-hand-vs',
    title:
      input.role === 'pitcher'
        ? `How ${input.teamAbbr}'s lineup hits ${word} pitching`
        : `What ${input.teamAbbr}'s staff allows to ${word} hitters`,
    scope: `${input.season} · ${split.pa} plate appearances`,
    info: 'From the Statcast rollup this app stores for every team, split by the handedness of the player on the other side.',
    labelHeader: 'Stat',
    fixedOrder: true,
    // A column formats every cell the same way, and these rows do not share a
    // unit (.267, 22.4%, 88.1 mph), so each row prints its own number and the
    // column is left as text.
    columns: [{ key: 'value', label: 'Value', decimals: 0 }],
    rows: rows.map((r) => ({
      key: r.key,
      label: r.label,
      values: { value: formatResearchValue(r.value as number, { decimals: r.decimals, format: r.format }) },
    })),
    caption: 'One season, one handedness: a small plate-appearance count is a small sample, and it is printed above.',
  };
}
