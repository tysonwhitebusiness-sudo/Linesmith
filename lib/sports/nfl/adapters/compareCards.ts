/**
 * Football's own compare card — R10.4: where this receiver is thrown to,
 * against where the chosen defence is thrown at.
 *
 * BOTH SIDES ALREADY EXIST. His targets come from `/api/nfl/targets`, which the
 * page fetches for its own target map (R6.2); the defence's comes from
 * `team_target_profile`, whose route header has named this card since R5d. The
 * defence is taken BY POSITION where the rollup has it (a corner's map is not a
 * linebacker's), and falls back to the whole defence otherwise, which is what
 * `defenseByPosition` being sparse actually means.
 *
 * SHARE, NOT VOLUME, IS THE COMPARABLE THING: he has a season of targets and a
 * defence has a season of being thrown at, so the two only line up as
 * percentages of their own totals. The card says so in its caption.
 *
 * Pure: no fetching, no database.
 */

import type { ResearchCard } from '@/lib/sports/shared/playerResearchShapes';
import type { NflTarget } from '@/lib/sports/nfl/targetShapes';
import type { TeamTargetSide } from '@/lib/sports/nfl/teamTargetShapes';

const SIDES = ['left', 'middle', 'right'] as const;
const BANDS = ['deep', 'short'] as const;

const pct = (n: number, of: number) => (of ? (100 * n) / of : null);

export function nflTargetCompareCard(input: {
  targets: NflTarget[];
  defense: TeamTargetSide | null;
  teamAbbr: string;
  positionLabel: string | null;
}): ResearchCard | null {
  // A target with no band or side cannot be placed on either map.
  const located = input.targets.filter((t) => t[3] && t[4]);
  const cells = input.defense?.cells;
  if (!located.length || !cells) return null;
  const theirTotal = Object.values(cells).reduce((a, c) => a + (c[0] ?? 0), 0);
  if (!theirTotal) return null;

  const rows = BANDS.flatMap((band) =>
    SIDES.map((side) => {
      const mine = located.filter((t) => (t[4] ?? '').toLowerCase() === band && (t[3] ?? '').toLowerCase() === side);
      const cell = cells[`${band}|${side}`];
      const caught = mine.filter((t) => t[6]).length;
      return {
        key: `${band}-${side}`,
        label: `${band[0].toUpperCase()}${band.slice(1)} ${side}`,
        values: {
          mineShare: pct(mine.length, located.length),
          mineCaught: pct(caught, mine.length),
          theirShare: cell ? pct(cell[0] ?? 0, theirTotal) : null,
          theirCaught: cell ? pct(cell[1] ?? 0, cell[0] ?? 0) : null,
        },
      };
    }),
  );

  return {
    kind: 'table',
    key: 'nfl-targets-vs',
    title: `Where he is thrown to, against where ${input.teamAbbr} are thrown at`,
    scope: `${located.length} located targets · ${input.teamAbbr}${input.positionLabel ? ` to ${input.positionLabel}` : ''}`,
    info: 'Each side as a share of its own targets: his of the passes thrown his way, the defence’s of the passes thrown at it.',
    labelHeader: 'Depth and side',
    fixedOrder: true,
    columns: [
      { key: 'mineShare', label: 'His share', decimals: 0, format: 'percent', bar: true },
      { key: 'mineCaught', label: 'Caught', decimals: 0, format: 'percent' },
      { key: 'theirShare', label: `${input.teamAbbr} faced`, decimals: 0, format: 'percent', bar: true },
      { key: 'theirCaught', label: 'They allow', decimals: 0, format: 'percent' },
    ],
    rows,
    caption: 'Both share columns add to 100% of their own side’s targets; a volume comparison between a player and a defence would say nothing.',
  };
}
