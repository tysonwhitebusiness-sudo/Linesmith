'use client';

import { MarkTip } from './MarkTip';
import { SIDE_COLOR } from './FieldLanes';
import { FONT_STACK, GRID, INK3, SIZE, CARD_RED, CARD_YELLOW } from './tokens';
import { useChartWidth } from './useChartWidth';

export interface TimelineEvent {
  key: string;
  side: 'away' | 'home';
  minute: number;
  kind: 'goal' | 'red' | 'yellow' | 'sub' | 'shot' | 'shot-on';
  tip: string[];
}

/**
 * A match on one axis of minutes, one lane per team — R8.3's soccer timeline
 * (G2 `game-soccer-tennis.js`). Goals are team-coloured discs, cards the card's
 * colour, substitutions a swap mark, shots small dots beside the lane (filled
 * when on target). The first half is shaded apart from the second.
 */
export function MatchTimeline({ events, teams, label, className }: { events: readonly TimelineEvent[]; teams: { away: string; home: string }; label: string; className?: string }) {
  const [hostRef, W] = useChartWidth(320);
  const H = 150;
  const left = 44;
  const right = 12;
  const maxMinute = Math.max(95, ...events.map((e) => e.minute)) + 1;
  const X = (m: number) => left + (m / maxMinute) * (W - left - right);
  const lane = { away: 48, home: 108 } as const;

  return (
    <div ref={hostRef} className={`min-w-0 ${className ?? ''}`}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} style={{ display: 'block', fontFamily: FONT_STACK }}>
        <rect x={left} y={20} width={X(45) - left} height={H - 40} rx={6} fill="oklch(96% 0.004 260)" />
        <rect x={X(45)} y={20} width={X(maxMinute) - X(45)} height={H - 40} rx={6} fill="oklch(97.5% 0.003 260)" />
        {[0, 15, 30, 45, 60, 75, 90].map((m) => (
          <g key={m}>
            <line x1={X(m)} x2={X(m)} y1={20} y2={H - 20} stroke={GRID} />
            <text x={X(m)} y={H - 5} fill={INK3} fontSize={SIZE.tick} textAnchor="middle">
              {m}&apos;
            </text>
          </g>
        ))}
        {(['away', 'home'] as const).map((side) => (
          <g key={side}>
            <line x1={left} x2={W - right} y1={lane[side]} y2={lane[side]} stroke={SIDE_COLOR[side]} strokeOpacity={0.35} />
            <text x={4} y={lane[side] + 4} fill={INK3} fontSize={SIZE.label} fontWeight={600}>
              {teams[side]}
            </text>
          </g>
        ))}
        {events.map((e) => {
          const x = X(e.minute);
          const y = lane[e.side];
          const colour = SIDE_COLOR[e.side];
          let mark;
          if (e.kind === 'goal') {
            mark = (
              <g>
                <circle cx={x} cy={y} r={10} fill={colour} stroke="oklch(var(--card))" strokeWidth={2} />
                <text x={x} y={y + 4} fill="white" fontSize={11} fontWeight={700} textAnchor="middle">
                  G
                </text>
              </g>
            );
          } else if (e.kind === 'red' || e.kind === 'yellow') {
            mark = <rect x={x - 4} y={y - 8} width={8} height={12} rx={1.5} fill={e.kind === 'red' ? CARD_RED : CARD_YELLOW} stroke="oklch(var(--card))" />;
          } else if (e.kind === 'sub') {
            mark = <path d={`M${x - 6},${y - 4} h12 m-3,-3 l3,3 l-3,3 M${x + 6},${y + 5} h-12 m3,-3 l-3,3 l3,3`} stroke={INK3} strokeWidth={1.5} fill="none" />;
          } else {
            const dy = e.side === 'home' ? 14 : -14;
            mark = <circle cx={x} cy={y + dy} r={3.5} fill={e.kind === 'shot-on' ? colour : 'oklch(var(--card))'} stroke={colour} strokeWidth={1.5} />;
          }
          return (
            <MarkTip key={e.key} tip={e.tip.join(' · ')}>
              {mark}
            </MarkTip>
          );
        })}
      </svg>
    </div>
  );
}
