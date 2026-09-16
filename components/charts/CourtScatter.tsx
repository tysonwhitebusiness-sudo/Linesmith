'use client';

import { MarkTip } from './MarkTip';
import { CATEGORICAL, FONT_STACK, INK1, INK3, SIZE } from './tokens';
import { useChartWidth } from './useChartWidth';

/**
 * Every field-goal attempt on a half court — R6.5 ("Shot chart", G2
 * `nbaShotChart`).
 *
 * THE RIM IS THE ORIGIN, not the baseline. `nba_shot_events` gives `x` 0-50
 * across and `y` in feet OUT FROM THE RIM, proved on real rows: with the rim
 * at (25, 0) the closest three in a full season is exactly 22.0 ft — the corner
 * distance by rule — and none is closer; putting the origin on the baseline
 * instead produced 11,516 impossible threes. `playerShotShapes.ts` carries the
 * measurement.
 *
 * THE LINES ARE REAL GEOMETRY, in feet, for the same reason the pitch map's
 * are: a court drawn on arbitrary thirds puts the corner three and the paint in
 * the wrong relationship to each other, and the picture stops being readable as
 * basketball. Court 50 wide; rim centre 5.25 from the baseline, so the baseline
 * sits at y = -5.25; paint 16 wide running 19 from the baseline (13.75 out);
 * free-throw circle r 6 about (25, 13.75); restricted arc r 4; corner threes on
 * x = 3 and x = 47 out to y = 8.94, where the 23.75 arc meets them.
 *
 * COLOUR IS THE OUTCOME, not the group: a filled dot is a make and an outline
 * is a miss, so a cold night reads as a cold night at a glance. The families
 * still drive which dots the reader can toggle off.
 */

const COURT_W = 50;
const BASELINE = -5.25;
/**
 * Drawn to 32 ft out, not to the half-court line at 41.75. Measured on the real
 * table, a season's attempts past 32 ft are a handful of heaves, and drawing to
 * the line left the bottom quarter of the card empty. Anything beyond is
 * clamped to the edge rather than dropped, so the count still matches the table.
 */
const COURT_OUT = 32;
const ARC_3 = 23.75;
const CORNER_X = 3;
const CORNER_Y = 8.94;

export function CourtScatter({
  points,
  emphasis,
  tips,
  groups,
  visible,
  label,
  className,
}: {
  points: ReadonlyArray<readonly [string | null, number, number]>;
  /** A make. Where given, it colours the dot instead of the group. */
  emphasis?: readonly boolean[];
  tips?: ReadonlyArray<readonly string[]>;
  groups: readonly { key: string; label: string }[];
  visible: ReadonlySet<string>;
  label: string;
  className?: string;
}) {
  const [hostRef, measured] = useChartWidth(320);
  const W = Math.min(measured, 560);
  const H = Math.round((W * (COURT_OUT - BASELINE)) / COURT_W);
  const X = (x: number) => (x / COURT_W) * W;
  const Y = (y: number) => ((y - BASELINE) / (COURT_OUT - BASELINE)) * H;
  const ft = W / COURT_W;
  const colorOf = new Map(groups.map((g, i) => [g.key, CATEGORICAL[i % CATEGORICAL.length]]));
  const line = { fill: 'none', stroke: 'oklch(var(--line))', strokeWidth: 1.5 };

  const order = points.map((_, i) => i).filter((i) => points[i][0] == null || visible.has(points[i][0] as string));

  return (
    <div ref={hostRef} className={`min-w-0 ${className ?? ''}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ display: 'block', margin: '0 auto', maxWidth: '100%', fontFamily: FONT_STACK }}>
        <rect x={0} y={0} width={W} height={H} rx={8} fill="oklch(var(--card-sunk))" />

        {/* Paint, free-throw circle and the restricted arc. */}
        <rect x={X(17)} y={Y(BASELINE)} width={X(33) - X(17)} height={Y(13.75) - Y(BASELINE)} {...line} />
        <circle cx={X(25)} cy={Y(13.75)} r={6 * ft} {...line} />
        <path d={`M${X(21)},${Y(0)} A${4 * ft},${4 * ft} 0 0 0 ${X(29)},${Y(0)}`} {...line} />

        {/* The three-point line: two corner lines and the arc between them. */}
        <line x1={X(CORNER_X)} x2={X(CORNER_X)} y1={Y(BASELINE)} y2={Y(CORNER_Y)} {...line} />
        <line x1={X(COURT_W - CORNER_X)} x2={X(COURT_W - CORNER_X)} y1={Y(BASELINE)} y2={Y(CORNER_Y)} {...line} />
        <path
          d={`M${X(CORNER_X)},${Y(CORNER_Y)} A${ARC_3 * ft},${ARC_3 * ft} 0 0 0 ${X(COURT_W - CORNER_X)},${Y(CORNER_Y)}`}
          {...line}
        />

        {/* Backboard and rim, so the top of the picture reads as the basket. */}
        <line x1={X(22)} x2={X(28)} y1={Y(-1.25)} y2={Y(-1.25)} stroke={INK1} strokeWidth={2} />
        <circle cx={X(25)} cy={Y(0)} r={0.75 * ft} fill="none" stroke={INK1} strokeWidth={1.5} />

        {order.map((i) => {
          const [group, x, y] = points[i];
          const make = emphasis?.[i] === true;
          const colour = emphasis ? (make ? 'rgb(var(--good))' : INK3) : (colorOf.get(group ?? '') ?? INK3);
          const tip = tips?.[i]?.join(' · ') ?? `${y.toFixed(0)} ft`;
          return (
            <MarkTip key={i} tip={tip}>
              <circle
                cx={X(Math.max(0, Math.min(COURT_W, x)))}
                cy={Y(Math.max(BASELINE, Math.min(COURT_OUT, y)))}
                r={3}
                fill={colour}
                fillOpacity={make ? 0.85 : 0.14}
                stroke={colour}
                strokeOpacity={make ? 1 : 0.5}
                strokeWidth={1}
              />
            </MarkTip>
          );
        })}

        <text x={W / 2} y={14} fill={INK3} fontSize={SIZE.label} textAnchor="middle">
          Rim
        </text>
      </svg>
    </div>
  );
}
