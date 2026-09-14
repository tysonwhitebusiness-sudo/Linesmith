'use client';

import { useId, type ReactNode } from 'react';
import { heatFill, heatInk, rankToHeat } from '@/lib/ui/heat';
import type { SpatialGridRole } from '@/lib/sports/shared/playerRoles';
import { HeatGrid } from './HeatGrid';
import { MarkTip } from './MarkTip';
import { FONT_STACK, INK1, INK3, MIDDOT, SIZE, SURFACE_TINT, volumeFill, volumeInk } from './tokens';
import { useChartWidth } from './useChartWidth';

/**
 * A "where" grid drawn on its sport's own surface — R3 3c, design finding D4.
 *
 * Before R3 every sport's spatial grid went through `HeatGrid` with
 * `aspect="zone"` hardcoded, so an NFL target map, an NBA shot profile, an NHL
 * shot map and a soccer shot map all rendered as a baseball strike zone. The
 * role data was sound; only the drawing was wrong.
 *
 * THE SURFACE IS DATA. The adapter sets `role.surface`; this component switches
 * on that field and never on a sport (CLAUDE.md §4). Each surface draws the
 * role's own rows and columns as regions whose geometry matches how the data
 * was BANDED — not a prettier approximation of it:
 *
 *  - `zone`       MLB, 3×3 strike zone, catcher's view.
 *  - `field`      NFL, rows deep/short × left/middle/right from the line of scrimmage.
 *  - `halfCourt`  NBA, rows rim (≤4 ft) / paint (≤15 ft) / mid-range / three (the arc).
 *  - `rink`       NHL, rows slot (≤25 ft of the goal line) / high slot (≤45) / point × |y| 12.
 *  - `pitch`      soccer, rows in the box / box edge / long range × thirds of the box.
 *  - `matrix`     a plain grid for data that is not a place (golf proximity by lie).
 *
 * COLOR FOLLOWS `role.measure` (D4's second fault): `share` data — how many of
 * a player's attempts came from where — is VOLUME and uses one hue, darker =
 * more. Only `judged` data (xwOBA allowed) uses the good/bad ramp, in its
 * declared direction.
 *
 * Coordinate-level shot and target layers join these surfaces when the pages
 * are rebuilt (R6); they draw into the same backgrounds.
 */
export function SpatialSurface({ role, className }: { role: SpatialGridRole; className?: string }) {
  if (role.surface === 'matrix') {
    return (
      <HeatGrid
        rows={role.cells}
        rowLabels={role.rowLabels}
        columnLabels={role.columnLabels}
        domain={role.domain}
        format={role.format}
        unit={role.unit}
        caption={role.caption}
        measure={role.measure}
        lowerIsBetter={role.lowerIsBetter}
        label={role.title}
        className={className}
      />
    );
  }
  return <SurfaceBody role={role} className={className} />;
}

interface Region {
  row: number;
  col: number;
  /** An SVG path in surface pixels. */
  d: string;
  /** Where the value prints. */
  cx: number;
  cy: number;
  /** Where this band's ROW label prints (the first column of each row only). */
  label?: { x: number; y: number; anchor: 'start' | 'middle' };
}

function SurfaceBody({ role, className }: { role: SpatialGridRole; className?: string }) {
  const [hostRef, measured] = useChartWidth(320);
  // Regions are clipped to the surface: the NBA 15 ft paint ring reaches past the baseline.
  const clipId = `surface-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const values = role.cells.flat().map((c) => c.value).filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) {
    return (
      <div className={`flex items-center justify-center rounded-ctl border border-dashed border-line-soft px-4 py-6 ${className ?? ''}`} role="img" aria-label={`${role.title}: no data`}>
        <p className="text-label text-ink-muted">{role.emptyMessage ?? 'Nothing located yet.'}</p>
      </div>
    );
  }
  const lo = role.domain?.lo ?? (role.measure === 'share' ? 0 : Math.min(...values));
  const hi = role.domain?.hi ?? Math.max(...values);
  const W = Math.min(measured, 420);
  const geo = GEOMETRY[role.surface as Exclude<SpatialGridRole['surface'], 'matrix'>](W);

  const fillFor = (v: number | null): { fill: string; ink: string } => {
    if (v == null || !Number.isFinite(v)) return { fill: 'transparent', ink: INK3 };
    const raw = rankToHeat(v, lo, hi);
    if (role.measure === 'share') return { fill: volumeFill(raw), ink: volumeInk(raw) };
    const t = role.lowerIsBetter ? 1 - raw : raw;
    return { fill: heatFill(t, 0.55), ink: heatInk(t) };
  };

  return (
    <div ref={hostRef} className={`min-w-0 ${className ?? ''}`}>
      <svg
        width={W}
        height={geo.height}
        viewBox={`0 0 ${W} ${geo.height}`}
        role="img"
        aria-label={`${role.title}${role.caption ? `: ${role.caption}` : ''}`}
        style={{ display: 'block', margin: '0 auto', maxWidth: '100%', overflow: 'visible', fontFamily: FONT_STACK }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={W} height={geo.height} />
          </clipPath>
        </defs>
        {geo.background}
        <g clipPath={`url(#${clipId})`}>
        {geo.regions.map((r) => {
          const cell = role.cells[r.row]?.[r.col];
          if (!cell) return null;
          const { fill, ink } = fillFor(cell.value);
          const where = [role.rowLabels?.[r.row], role.columnLabels?.[r.col]].filter(Boolean).join(' ');
          const valueText = cell.value == null ? 'no data' : `${role.format(cell.value)}${role.unit ? ` ${role.unit}` : ''}`;
          return (
            <MarkTip key={cell.key} tip={`${where || cell.key} ${MIDDOT} ${valueText}${cell.sampleSize != null ? ` ${MIDDOT} n=${cell.sampleSize}` : ''}`}>
              <path d={r.d} fill={cell.value == null ? 'transparent' : fill} fillRule="evenodd" stroke="oklch(var(--card))" strokeWidth={1.5} />
            </MarkTip>
          );
        })}
        </g>
        {geo.foreground}
        {/* Labels and values LAST, so a court or box line never crosses a number. */}
        <g style={{ pointerEvents: 'none' }}>
          {geo.regions.map((r) => {
            const cell = role.cells[r.row]?.[r.col];
            if (!cell) return null;
            const { ink } = fillFor(cell.value);
            const rowLabel = role.rowLabels?.[r.row];
            return (
              <g key={cell.key}>
                {r.label && rowLabel ? (
                  <text x={r.label.x} y={r.label.y} fill={ink} fontSize={SIZE.label} fontWeight={600} textAnchor={r.label.anchor} opacity={0.85}>
                    {rowLabel}
                  </text>
                ) : null}
                {cell.value != null ? (
                  <text x={r.cx} y={r.cy + 4} fill={ink} fontSize={SIZE.value + 1} fontWeight={700} textAnchor="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {role.format(cell.value)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>
      {role.caption ? <p className="mt-2 text-center text-label text-ink-muted">{role.caption}</p> : null}
    </div>
  );
}

type Geometry = { height: number; regions: Region[]; background: ReactNode; foreground?: ReactNode };

const rect = (x: number, y: number, w: number, h: number) => `M${x},${y}h${w}v${h}h${-w}Z`;
const circle = (cx: number, cy: number, r: number) => `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;

const GEOMETRY: Record<Exclude<SpatialGridRole['surface'], 'matrix'>, (W: number) => Geometry> = {
  /** MLB: the 3×3 strike zone, catcher's view, with the plate below. */
  zone: (W) => {
    const S = Math.min(W, 300);
    const inner = S * 0.62;
    const x0 = (W - inner) / 2;
    const y0 = 8;
    const cell = inner / 3;
    const regions: Region[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) regions.push({ row: r, col: c, d: rect(x0 + c * cell, y0 + r * cell, cell, cell), cx: x0 + c * cell + cell / 2, cy: y0 + r * cell + cell / 2 });
    const plateY = y0 + inner + 16;
    const pw = inner * 0.62;
    const px = (W - pw) / 2;
    return {
      height: plateY + 34,
      regions,
      background: <rect x={x0 - 3} y={y0 - 3} width={inner + 6} height={inner + 6} rx={6} fill="oklch(var(--card-sunk))" />,
      foreground: (
        <>
          <rect x={x0} y={y0} width={inner} height={inner} fill="none" stroke={INK1} strokeWidth={1.5} />
          <path d={`M${px},${plateY}h${pw}l-8,9l${-(pw - 16) / 2},7l${-(pw - 16) / 2},-7Z`} fill="oklch(var(--card-sunk))" stroke="oklch(var(--line))" />
          <text x={W / 2} y={plateY + 30} fill={INK3} fontSize={SIZE.label} textAnchor="middle">
            Catcher&apos;s view
          </text>
        </>
      ),
    };
  },

  /** NFL: line of scrimmage near the bottom; short above it, deep beyond; left/middle/right thirds. */
  field: (W) => {
    const H = Math.round(Math.min(340, W * 0.8));
    const top = 6;
    const los = H - 44;
    const shortTop = top + (los - top) * 0.55;
    const third = W / 3;
    const regions: Region[] = [];
    const bands = [
      { row: 0, y1: top, y2: shortTop },
      { row: 1, y1: shortTop, y2: los },
    ];
    for (const b of bands) for (let c = 0; c < 3; c++) regions.push({ row: b.row, col: c, d: rect(c * third + 2, b.y1 + 2, third - 4, b.y2 - b.y1 - 4), cx: c * third + third / 2, cy: (b.y1 + b.y2) / 2, label: c === 0 ? { x: 10, y: b.y1 + 18, anchor: 'start' } : undefined });
    return {
      height: H,
      regions,
      background: <rect x={0} y={top} width={W} height={H - top - 4} rx={10} fill={SURFACE_TINT.field} />,
      foreground: (
        <>
          <line x1={0} x2={W} y1={los} y2={los} stroke={INK1} strokeWidth={2} />
          <text x={8} y={los + 16} fill={INK3} fontSize={SIZE.label}>
            Line of scrimmage
          </text>
          {['Left', 'Middle', 'Right'].map((t, i) => (
            <text key={t} x={i * third + third / 2} y={H - 10} fill={INK3} fontSize={SIZE.label} fontWeight={600} textAnchor="middle">
              {t}
            </text>
          ))}
        </>
      ),
    };
  },

  /** NBA: a half court, baseline at the top, rim at (25, 5.25) ft. Bands match the shot profile's own definitions. */
  halfCourt: (W) => {
    const k = W / 50;
    const H = Math.round(47 * k);
    const X = (ft: number) => ft * k;
    const rimX = 25;
    const rimY = 5.25;
    const cornerY = rimY + Math.sqrt(23.25 ** 2 - 22 ** 2);
    const arc = `M${X(3)},0L${X(3)},${X(cornerY)}A${X(23.25)},${X(23.25)} 0 0,0 ${X(47)},${X(cornerY)}L${X(47)},0Z`;
    const court = rect(0, 0, W, H);
    const rim = circle(X(rimX), X(rimY), X(4));
    const paint = circle(X(rimX), X(rimY), X(15));
    return {
      height: H,
      regions: [
        { row: 0, col: 0, d: rim, cx: X(rimX), cy: X(rimY + 1.2) },
        { row: 1, col: 0, d: `${paint}${rim}`, cx: X(rimX), cy: X(rimY + 10), label: { x: X(rimX), y: X(rimY + 10) + 18, anchor: 'middle' } },
        { row: 2, col: 0, d: `${arc}${paint}`, cx: X(rimX), cy: X(rimY + 19.5), label: { x: X(rimX), y: X(rimY + 19.5) + 18, anchor: 'middle' } },
        { row: 3, col: 0, d: `${court}${arc}`, cx: X(rimX), cy: X(40), label: { x: X(rimX), y: X(40) + 18, anchor: 'middle' } },
      ],
      background: <rect x={0} y={0} width={W} height={H} rx={8} fill={SURFACE_TINT.court} />,
      foreground: (
        <>
          <rect x={X(17)} y={0} width={X(16)} height={X(19)} fill="none" stroke="oklch(var(--line))" strokeWidth={1.25} />
          <line x1={X(22)} x2={X(28)} y1={X(4)} y2={X(4)} stroke={INK1} strokeWidth={2} />
          <circle cx={X(rimX)} cy={X(rimY)} r={X(0.75)} fill="none" stroke="rgb(var(--bad))" strokeWidth={2} />
        </>
      ),
    };
  },

  /** NHL: one attacking end, goal line near the top, blue line at the bottom (64 ft out). */
  rink: (W) => {
    const k = W / 85;
    const behind = 11;
    const H = Math.round((behind + 64) * k);
    const Y = (distFromGoalLine: number) => (behind + distFromGoalLine) * k;
    const Xc = (y: number) => (y + 42.5) * k;
    const rows = [
      [0, 25],
      [25, 45],
      [45, 64],
    ];
    const cols = [
      [-42.5, -12],
      [-12, 12],
      [12, 42.5],
    ];
    const regions: Region[] = [];
    rows.forEach(([a, b], r) => cols.forEach(([c1, c2], c) => regions.push({ row: r, col: c, d: rect(Xc(c1) + 2, Y(a) + 2, Xc(c2) - Xc(c1) - 4, Y(b) - Y(a) - 4), cx: (Xc(c1) + Xc(c2)) / 2, cy: (Y(a) + Y(b)) / 2, label: c === 0 ? { x: Xc(c1) + 8, y: Y(a) + 16, anchor: 'start' } : undefined })));
    return {
      height: H,
      regions,
      background: <rect x={0} y={0} width={W} height={H} rx={Math.min(28, W * 0.08)} fill={SURFACE_TINT.rink} stroke="oklch(var(--line))" />,
      foreground: (
        <>
          <line x1={0} x2={W} y1={Y(0)} y2={Y(0)} stroke={SURFACE_TINT.rinkRed} strokeWidth={1.5} />
          <rect x={Xc(-3)} y={Y(0) - 3 * k} width={6 * k} height={3 * k} fill="none" stroke={INK1} strokeWidth={2} />
          <line x1={0} x2={W} y1={H - 2} y2={H - 2} stroke={SURFACE_TINT.rinkBlue} strokeWidth={4} />
        </>
      ),
    };
  },

  /** Soccer: the attacking half, goal at the top; the box's own thirds across. */
  pitch: (W) => {
    const H = Math.round(W * 0.78);
    const Y = (xTowardGoal: number) => ((1 - xTowardGoal) / 0.5) * H;
    const X = (yAcross: number) => yAcross * W;
    const boxX = (105 - 16.5) / 105;
    const rows = [
      [1, boxX],
      [boxX, 0.75],
      [0.75, 0.5],
    ];
    const cols = [
      [0, 0.401],
      [0.401, 0.599],
      [0.599, 1],
    ];
    const regions: Region[] = [];
    rows.forEach(([a, b], r) => cols.forEach(([c1, c2], c) => {
      const top = Y(a);
      const bottom = Y(b);
      // A thin band (box edge) puts its label beside the value rather than above it.
      const thin = bottom - top < 44;
      regions.push({ row: r, col: c, d: rect(X(c1) + 2, top + 2, X(c2) - X(c1) - 4, bottom - top - 4), cx: (X(c1) + X(c2)) / 2, cy: thin ? (top + bottom) / 2 : (top + bottom) / 2 + 6, label: c === 0 ? { x: X(c1) + 8, y: thin ? (top + bottom) / 2 + 4 : top + 16, anchor: 'start' } : undefined });
    }));
    return {
      height: H,
      regions,
      background: <rect x={0} y={0} width={W} height={H} rx={8} fill={SURFACE_TINT.pitch} />,
      foreground: (
        <>
          <rect x={X(0.21)} y={Y(1)} width={X(0.79) - X(0.21)} height={Y(boxX) - Y(1)} fill="none" stroke={SURFACE_TINT.pitchLine} strokeWidth={1.5} />
          <rect x={X(0.37)} y={Y(1)} width={X(0.63) - X(0.37)} height={Y(0.948) - Y(1)} fill="none" stroke={SURFACE_TINT.pitchLine} strokeWidth={1.5} />
          <rect x={X(0.45)} y={0} width={X(0.55) - X(0.45)} height={4} fill={INK1} />
        </>
      ),
    };
  },
};
