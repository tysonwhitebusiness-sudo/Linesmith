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
        <span className="absolute -top-1 -left-1 flex h-5 w-5 items-center justify-center rounded-full border border-card bg-card shadow-xs">
          <img src={teamLogoUrl} alt="" className="h-3.5 w-3.5 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
        </span>
      ) : null}
      {percentile != null ? (
        <span
          className="absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card px-1 text-label font-bold text-white"
          style={{ backgroundColor: color }}
          title={`${percentile}th percentile overall`}
        >
          {percentile}
        </span>
      ) : null}
    </span>
  );
}
