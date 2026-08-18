'use client';

import { SubjectAvatar } from './SubjectAvatar';

/**
 * Shared percentile-comparison primitives — originally built inside
 * `PitchingMatchupCard.tsx` for its two-pitcher comparison, extracted here so
 * `BatterPitcherMatchupCard.tsx` can render the same visual grammar (ring,
 * value+percentile pill, rail marker) for a batter-vs-pitcher comparison
 * without duplicating the SVG/markup.
 */

/** 1 (best) -> 100th percentile, poolSize (worst) -> 0th. Takes any {rank, poolSize} pair, not just a full OpposingStarterStat, so the same helper covers a stat rank and an overall composite rank alike. */
export function percentileOf(stat: { rank: number; poolSize: number } | null | undefined): number | null {
  if (!stat || stat.poolSize <= 1) return null;
  return Math.round(100 * (1 - (stat.rank - 1) / (stat.poolSize - 1)));
}

// ---------------------------------------------------------------------------
// Percentile ring — the headshot doubles as the "who's who" avatar; the ring
// around it reads the player's overall composite percentile at a glance.
// ---------------------------------------------------------------------------

export function PercentileRing({
  percentile,
  color,
  headshotUrl,
  teamLogoUrl,
  name,
  size = 56,
}: {
  percentile: number | null;
  color: string;
  headshotUrl?: string;
  teamLogoUrl?: string;
  name: string;
  size?: number;
}) {
  const strokeWidth = 3.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = ((percentile ?? 0) / 100) * circumference;

  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" className="text-line" strokeWidth={strokeWidth} />
        {percentile != null ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${dash} ${circumference}`}
            strokeLinecap="round"
          />
        ) : null}
      </svg>
      <SubjectAvatar name={name} headshotUrl={headshotUrl} size={size - strokeWidth * 2 - 6} />
      {teamLogoUrl ? (
        <span className="absolute -top-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full border border-card bg-card shadow-sm">
          <img src={teamLogoUrl} alt="" className="h-3.5 w-3.5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
        </span>
      ) : null}
      {percentile != null ? (
        <span
          className="absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card px-1 text-micro font-bold text-white"
          style={{ backgroundColor: color }}
          title={`${percentile}th percentile overall`}
        >
          {percentile}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Value + percentile pill — a plain adjacent numeral reads as one messy
// number, the pill's colour break makes clear which digit is which. The
// winning side's pill gets a glow so the eye lands on whoever actually leads
// the stat, not just on whichever column it happens to scan first.
// ---------------------------------------------------------------------------

export function ValuePercentile({
  value,
  percentile,
  color,
  reverse,
  winning,
}: {
  value: string;
  percentile: number | null;
  color: string;
  reverse?: boolean;
  winning?: boolean;
}) {
  return (
    <span className={`flex items-center gap-1.5 tabular-nums ${reverse ? 'flex-row-reverse' : ''}`}>
      <span className="text-dense font-semibold">{value}</span>
      {percentile != null ? (
        <span
          className="rounded px-1 py-[1px] text-micro font-semibold transition-shadow"
          style={{
            color,
            backgroundColor: `${color}1A`,
            boxShadow: winning ? `0 0 0 1px ${color}66, 0 0 6px 1px ${color}80` : undefined,
          }}
        >
          {percentile}
        </span>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Rail marker — a small team-logo circle plotted at a percentile position on
// a 0-100 rail.
// ---------------------------------------------------------------------------

export function RailMarker({ pct, color, logoUrl, title }: { pct: number; color: string; logoUrl?: string; title: string }) {
  return (
    <span
      className="absolute top-1/2 flex h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border-2 bg-card"
      style={{ left: `${pct}%`, borderColor: color }}
      title={title}
    >
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-full w-full object-contain p-0.5" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
      ) : (
        <span className="h-full w-full rounded-full" style={{ backgroundColor: color }} />
      )}
    </span>
  );
}
