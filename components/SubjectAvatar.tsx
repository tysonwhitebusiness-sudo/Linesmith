'use client';

import { useEffect, useState } from 'react';
import { Chip } from './ui';
import { Avatar } from './ui/Avatar';

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

/**
 * Subject image: headshot → sport fallback (flag / logo) → a silhouette.
 *
 * R3: renders through the design-system `Avatar`, so the last step is the
 * silhouette, NEVER initials (F2 found initials standing in for photos on 16
 * captured cards). Still does not fall back to ESPN's `nophoto.png`, which out
 * of context reads as a broken image.
 *
 * Decorative by default, as before: every caller shows the name beside it.
 */
export function SubjectAvatar({ name, headshotUrl, fallbackUrl, size = 36, className = '', shape = 'circle' }: SubjectAvatarProps) {
  return <Avatar label={name} src={headshotUrl} fallbackSrc={fallbackUrl} size={size} rounded={shape === 'rounded'} decorative className={className} />;
}

export function mlbHeadshotUrl(personId: number | undefined): string | undefined {
  return personId
    ? 'https://img.mlbstatic.com/mlb-photos/image/upload/' +
        'c_thumb,g_face,w_213,h_213,d_people:generic:headshot:67:current.png,q_auto:best,f_auto/' +
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
    return abbreviation ? <Chip tone="neutral" size="sm">{abbreviation}</Chip> : null;
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
      <span className="text-ink-muted">@</span>
      <TeamLogo logoUrl={mlbTeamLogoUrl(homeTeamId)} abbreviation={home} size={size} />
    </span>
  );
}

export default SubjectAvatar;
