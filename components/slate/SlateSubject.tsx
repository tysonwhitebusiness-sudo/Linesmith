'use client';

import type { ReactNode } from 'react';
import { Avatar, ClampText, cx } from '@/components/ui';
import { TeamLogo } from '../SubjectAvatar';

/**
 * The Slate's ONE row anatomy (slate-polish v4, operator-approved 2026-09-26):
 * a face (or the two logos for a game), the name in bold, team vs opponent
 * with their logos directly UNDER the name, and the row's sentence under that
 * at one fixed width. Every Slate table draws its subject with these, so a
 * player reads the same in Specials, Spotlights, Movers and Market.
 *
 * The four rejected rounds that produced it are the reasons for each rule:
 * the market sat under the name as a pill (it is a column now), the teams sat
 * to the right (they belong under the name), and the sentence ran the full
 * width of the row, ragged (it is a fixed-width block of two lines now).
 */

export interface TeamRef {
  abbr: string;
  logoUrl?: string | null;
}

/** A number in a read line — a sentence cites only the factors a subject ranks well on, so its numbers are bold green. */
const NUMBER = /([+−-]?\d[\d.,]*(?:\s?(?:mph|ft|pts)\b|%|°)?)/g;

export function ReadLine({ text }: { text: string }) {
  const parts = text.split(NUMBER);
  return (
    <ClampText>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-semibold text-good-ink">
            {p}
          </b>
        ) : (
          p
        ),
      )}
    </ClampText>
  );
}

function Mark({ t }: { t: TeamRef }) {
  return (
    <span className="inline-flex items-center gap-1">
      {t.logoUrl ? <TeamLogo logoUrl={t.logoUrl} size={14} /> : null}
      <span>{t.abbr}</span>
    </span>
  );
}

/** "HOU vs ATH" with both logos — the line under a player's name. */
export function TeamVs({ team, opp }: { team?: TeamRef | null; opp?: TeamRef | null }) {
  if (!team && !opp) return null;
  return (
    <span className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-label text-ink-muted">
      {team ? <Mark t={team} /> : null}
      {team && opp ? <span>vs</span> : null}
      {opp ? <Mark t={opp} /> : null}
    </span>
  );
}

function NameLink({ name, href }: { name: string; href?: string | null }) {
  return href ? (
    <a href={href} className="truncate text-body-sm font-semibold text-ink underline-offset-2 hover:underline">
      {name}
    </a>
  ) : (
    <span className="truncate text-body-sm font-semibold text-ink">{name}</span>
  );
}

/** A player row's subject: face, name, team vs opponent, and the sentence. */
export function PlayerSubject({
  name,
  headshot,
  fallback,
  href,
  team,
  opp,
  read,
  rank,
}: {
  name: string;
  headshot?: string | null;
  fallback?: string | null;
  href?: string | null;
  team?: TeamRef | null;
  opp?: TeamRef | null;
  read?: string | null;
  /** Inside the cell, not a column: `DataTable` pins the first column, and it must be the player that stays on screen. */
  rank?: number | null;
}) {
  return (
    <span className="flex min-w-0 items-start gap-2.5">
      {rank != null ? <span className="w-5 shrink-0 pt-2 text-right text-label font-bold tabular-nums text-ink-muted">{rank}</span> : null}
      <Avatar label={name} src={headshot ?? undefined} fallbackSrc={fallback ?? undefined} size={36} decorative />
      <span className="flex min-w-0 flex-col">
        <NameLink name={name} href={href} />
        <TeamVs team={team} opp={opp} />
        {read ? <ReadLine text={read} /> : null}
      </span>
    </span>
  );
}

/** The two logos, overlapped — a game's face. */
function LogoPair({ away, home }: { away: TeamRef; home: TeamRef }) {
  return (
    <span className="flex w-9 shrink-0 items-center justify-center">
      {away.logoUrl ? <TeamLogo logoUrl={away.logoUrl} size={22} /> : null}
      {home.logoUrl ? (
        <span className="-ml-1.5">
          <TeamLogo logoUrl={home.logoUrl} size={22} />
        </span>
      ) : null}
    </span>
  );
}

/** A game row's subject: both logos, "AWAY @ HOME", a detail line (time · venue), and the sentence. */
export function GameSubject({ away, home, sub, href, read }: { away: TeamRef; home: TeamRef; sub?: ReactNode; href?: string | null; read?: string | null }) {
  return (
    <span className="flex min-w-0 items-start gap-2.5">
      <span className="pt-1.5">
        <LogoPair away={away} home={home} />
      </span>
      <span className="flex min-w-0 flex-col">
        <NameLink name={`${away.abbr} @ ${home.abbr}`} href={href} />
        {sub ? <span className="mt-0.5 truncate text-label text-ink-muted">{sub}</span> : null}
        {read ? <ReadLine text={read} /> : null}
      </span>
    </span>
  );
}

/** "LAA @ SEA" inline with both logos — a game in a table cell or a list line. */
export function GameMark({ away, home, href, className }: { away: TeamRef; home: TeamRef; href?: string | null; className?: string }) {
  const body = (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap font-semibold text-ink', className)}>
      {away.logoUrl ? <TeamLogo logoUrl={away.logoUrl} size={15} /> : null}
      {away.abbr}
      <span className="font-normal text-ink-muted">@</span>
      {home.logoUrl ? <TeamLogo logoUrl={home.logoUrl} size={15} /> : null}
      {home.abbr}
    </span>
  );
  return href ? (
    <a href={href} className="underline-offset-2 hover:underline">
      {body}
    </a>
  ) : (
    body
  );
}
