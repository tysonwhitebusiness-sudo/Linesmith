'use client';

import { useEffect, useState } from 'react';

export interface SubjectAvatarProps {
  name: string;
  /** Primary image — a player headshot. */
  headshotUrl?: string;
  /**
   * Sport-specific second choice, used when the headshot fails. Golf passes the
   * country flag here; team sports can pass a team logo.
   */
  fallbackUrl?: string;
  size?: number;
  className?: string;
  /** 'rounded' is a rounded-rect crop for a larger hero-style photo; default is the usual circle. */
  shape?: 'circle' | 'rounded';
}

function initials(name: string): string {
  const parts = name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Subject image with an honest degradation chain:
 * headshot → sport fallback (flag / logo) → initials.
 *
 * Deliberately does NOT fall back to ESPN's `nophoto.png`. Out of its own
 * context that asset reads as a broken or generic ESPN image; initials look
 * intentional and stay inside the app's own visual language.
 *
 * A missing headshot is normal, not an error — plenty of athletes have no photo
 * on file — so a failed load advances the chain silently rather than logging.
 */
export function SubjectAvatar({
  name,
  headshotUrl,
  fallbackUrl,
  size = 36,
  className = '',
  shape = 'circle',
}: SubjectAvatarProps) {
  const sources = [headshotUrl, fallbackUrl].filter((s): s is string => Boolean(s));
  const [index, setIndex] = useState(0);
  const roundedClass = shape === 'rounded' ? 'rounded-xl' : 'rounded-full';

  // A recycled card (virtualised list, filter change) must restart the chain,
  // otherwise one subject's failure would hide the next subject's photo.
  useEffect(() => {
    setIndex(0);
  }, [headshotUrl, fallbackUrl]);

  const src = sources[index];
  const dimension = { width: size, height: size };

  if (!src) {
    return (
      <span
        aria-hidden
        style={dimension}
        className={`flex shrink-0 items-center justify-center ${roundedClass} bg-avatar text-[11px] font-semibold text-masters ${className}`}
      >
        {initials(name)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      style={dimension}
      onError={() => setIndex((i) => i + 1)}
      className={`shrink-0 ${roundedClass} bg-ink/5 object-cover ${className}`}
    />
  );
}

export function mlbHeadshotUrl(personId: number | undefined): string | undefined {
  return personId
    ? 'https://img.mlbstatic.com/mlb-photos/image/upload/' +
        'w_213,d_people:generic:headshot:67:current.png,q_auto:best,f_auto/' +
        `v1/people/${personId}/headshot/67/current`
    : undefined;
}

export interface TeamLogoProps {
  logoUrl?: string;
  abbreviation?: string;
  size?: number;
}

/** Small team mark. Written generically so any future team sport can reuse it. */
export function TeamLogo({ logoUrl, abbreviation, size = 16 }: TeamLogoProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [logoUrl]);

  if (!logoUrl || failed) {
    return abbreviation ? <span className="lb-chip bg-ink/5 text-ink-muted">{abbreviation}</span> : null;
  }

  return (
    <span className="inline-flex items-center gap-1">
      <img
        src={logoUrl}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
        className="shrink-0 object-contain"
      />
      {abbreviation ? <span className="text-xs text-ink-muted">{abbreviation}</span> : null}
    </span>
  );
}

export function mlbTeamLogoUrl(teamId: number | undefined): string | undefined {
  return teamId ? `https://www.mlbstatic.com/team-logos/${teamId}.svg` : undefined;
}

/** ESPN's own CDN, keyed by team abbreviation (lowercase) rather than a numeric id — matches what teamSportEspn.ts already carries on every game/roster entry. */
export function nflTeamLogoUrl(abbreviation: string | undefined): string | undefined {
  return abbreviation ? `https://a.espncdn.com/i/teamlogos/nfl/500/${abbreviation.toLowerCase()}.png` : undefined;
}

/**
 * A "CLE @ DET" matchup label with each team's own logo beside its own
 * abbreviation, not both logos clustered ahead of the whole string — reuses
 * TeamLogo (which already pairs a logo with its abbreviation, falling back to
 * a text chip when a team has no logo yet) for each side of the "@".
 */
export function GameMatchupLabel({
  label,
  awayTeamId,
  homeTeamId,
  size = 16,
}: {
  label: string;
  awayTeamId?: number;
  homeTeamId?: number;
  size?: number;
}) {
  const parts = label.split(' @ ');
  if (parts.length !== 2) return <>{label}</>;
  const [away, home] = parts;
  return (
    <span className="inline-flex items-center gap-1.5">
      <TeamLogo logoUrl={mlbTeamLogoUrl(awayTeamId)} abbreviation={away} size={size} />
      <span className="text-ink-faint">@</span>
      <TeamLogo logoUrl={mlbTeamLogoUrl(homeTeamId)} abbreviation={home} size={size} />
    </span>
  );
}

export default SubjectAvatar;
