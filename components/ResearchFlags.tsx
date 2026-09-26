'use client';

import { useEffect, useState } from 'react';
import { Card, Chip, DataTable, PercentileCell, Tooltip, cx } from './ui';
import { GameSubject, PlayerSubject } from './slate/SlateSubject';
import { headshotFor, teamLogoFor } from '@/lib/sports/shared/identity';
import { groupFlags, type FlagsData, type ResearchFlag } from '@/lib/slate/flags';
import { formatFactor, SOURCE_CREDIT } from '@/lib/slate/specialsFormat';

/**
 * Research flags (F0) — the shared card and chip row.
 *
 * ONE COMPONENT, EVERY SPORT AND EVERY PAGE. A flag is a `ResearchFlag`: a
 * rank within today's pool, the factors behind it with their sources, and the
 * one-line why the Python job wrote. The player, team and game pages differ
 * only in which id they ask for, so nothing here asks which sport it is.
 *
 * STAT CONTEXT, NOT BETTING FRAMING. These pages are research pages: a flag
 * says "third-best platoon spot on today's slate" or "12 yards from 1,000",
 * never what to do about it. No price, no edge, no probability.
 *
 * TODAY'S SLATE ONLY (D-F1). The chips answer "is anything unusual about this
 * player today", so they render for today's rankings and disappear with them.
 * A page whose subject is not on today's slate shows nothing at all, which is
 * the honest answer rather than an empty card.
 */

export interface FlagsQuery {
  subject?: string | null;
  team?: string | null;
  game?: string | null;
}

export function useResearchFlags(sport: string | null | undefined, who: FlagsQuery, league?: string | null) {
  const { subject, team, game } = who;
  const [data, setData] = useState<FlagsData | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const id = subject ?? team ?? game ?? null;
    if (!sport || !id) {
      setData(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ sport });
        if (league) params.set('league', league);
        if (subject) params.set('subject', subject);
        else if (team) params.set('team', team);
        else if (game) params.set('game', game);
        const res = await fetch(`/api/slate/flags?${params}`, { cache: 'no-store' });
        if (!cancelled) setData(res.ok ? ((await res.json()) as FlagsData) : null);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sport, league, subject, team, game]);
  return { flags: data?.flags ?? [], loading };
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** "3rd of 10 today" — a rank is only a fact with its pool beside it. */
function rankText(flag: ResearchFlag): string {
  return flag.of > 1 ? `${ordinal(flag.rank)} of ${flag.of} today` : 'On today’s slate';
}

/**
 * The chip row — the hero's version of a flag. The chip says the ranking's own
 * title, and the tooltip says the rank and the why, because a chip that only
 * says "Revenge games" without saying against whom is a tease.
 */
export function ResearchFlagChips({ flags, subjectName, label = 'Flags today' }: { flags: ResearchFlag[]; subjectName?: string | null; label?: string }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label={subjectName ? `Flags for ${subjectName}` : 'Research flags'}>
      {/* The same lead-in the game page's state row uses: a bare chip under a
          hero reads as a stray control rather than as a label. */}
      <span className="text-overline uppercase text-ink-muted">{label}</span>
      {flags.map((f) => (
        <Tooltip key={`${f.rankingId}:${f.subjectId}`} content={`${rankText(f)}. ${f.read ?? f.promo}${SOURCE_CREDIT[f.rankingId] ? ` ${SOURCE_CREDIT[f.rankingId]}` : ''}`}>
          <Chip size="sm">{f.title}</Chip>
        </Tooltip>
      ))}
    </div>
  );
}

/** The flag's place, big, over its title (slate-polish v4). */
function Place({ flag }: { flag: ResearchFlag }) {
  return (
    <span className="flex flex-col">
      <span className="whitespace-nowrap">
        <b className={cx('text-title font-bold tabular-nums', flag.rank <= 3 ? 'text-good-ink' : 'text-ink')}>{ordinal(flag.rank)}</b>
        {flag.of > 1 ? <span className="text-label text-ink-muted"> of {flag.of}</span> : null}
      </span>
      <span className="text-label text-ink-secondary">{flag.title}</span>
    </span>
  );
}

/** Each measured factor as its label beside the number, with the bar and percentile under it. */
function Factors({ flag }: { flag: ResearchFlag }) {
  const measured = flag.factors.filter((f) => f.value != null);
  if (measured.length === 0) return <span className="text-ink-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-x-5 gap-y-2">
      {measured.map((f) => (
        <Tooltip key={f.key} content={f.info}>
          <span className="w-[128px]">
            <PercentileCell value={formatFactor(f.key, f.value)} percentile={f.percentile ?? null} label={f.label} align="left" />
          </span>
        </Tooltip>
      ))}
    </span>
  );
}

function flagSubject(flag: ResearchFlag, sport: string | null | undefined) {
  const s = sport ?? '';
  if (flag.subjectKind === 'game' && flag.team && flag.opponent) {
    return (
      <GameSubject
        away={{ abbr: flag.team, logoUrl: teamLogoFor(s, flag.teamId, flag.team) }}
        home={{ abbr: flag.opponent, logoUrl: teamLogoFor(s, flag.opponentId, flag.opponent) }}
        read={flag.read}
      />
    );
  }
  return (
    <PlayerSubject
      name={flag.subjectName}
      headshot={flag.subjectKind === 'player' ? headshotFor(s, flag.subjectId) : null}
      team={flag.team ? { abbr: flag.team, logoUrl: teamLogoFor(s, flag.teamId, flag.team) } : null}
      opp={flag.opponent ? { abbr: flag.opponent, logoUrl: teamLogoFor(s, flag.opponentId, flag.opponent) } : null}
      read={flag.read}
    />
  );
}

/**
 * The card — every flag this subject has today, grouped by ranking.
 *
 * It renders NOTHING when there are no flags. A research page is not improved
 * by a card that says a player is unremarkable today, and most players on most
 * days are.
 */
export function ResearchFlagsCard({
  flags,
  loading,
  title = 'Flags today',
  /** A team or game page lists several subjects, so each line leads with a name. */
  showSubject = false,
  id,
  sport,
}: {
  flags: ResearchFlag[];
  loading: boolean;
  title?: string;
  showSubject?: boolean;
  id?: string;
  /** For the faces and team logos (the flag carries ids, not image URLs). */
  sport?: string | null;
}) {
  if (flags.length === 0) return null;
  const groups = groupFlags(flags);
  return (
    <Card
      id={id}
      title={title}
      count={flags.length}
      scope={groups.some((g) => g.frozen) ? 'Frozen at the first game' : 'Updates until the first game'}
      caption={[
        "Where each one stands among today's slate on the factors named. A ranking of those factors, not a probability, and not compared to a price.",
        ...[...new Set(groups.map((g) => SOURCE_CREDIT[g.rankingId]).filter(Boolean))],
      ].join(' ')}
    >
      {/* slate-polish v4: the Slate's row anatomy — the subject with its
          sentence under the name, the flag's place, then each factor as its
          label and number with the percentile. The factors differ by flag, so
          the label rides beside the number rather than in a header. */}
      <DataTable<ResearchFlag>
        caption={title}
        density="compact"
        rows={flags}
        rowKey={(f) => `${f.rankingId}:${f.subjectId}`}
        columns={[
          ...(showSubject
            ? [{ key: 'subject', label: 'Subject', sortable: false, wrap: true, render: (f: ResearchFlag) => flagSubject(f, sport) }]
            : []),
          { key: 'flag', label: 'Flag', sortable: false, render: (f) => <Place flag={f} /> },
          { key: 'factors', label: 'Factors', sortable: false, wrap: true, render: (f) => (
            <span className="flex flex-col gap-1">
              {showSubject ? null : f.read ? <span className="text-label text-ink-secondary">{f.read}</span> : null}
              <Factors flag={f} />
            </span>
          ) },
        ]}
      />
    </Card>
  );
}

/**
 * The whole thing for a page that holds one id: fetch, then draw.
 *
 * `variant` is the only difference between the three pages. A player has at
 * most a handful of flags and a box around one line is a box around one line,
 * so the player page takes `chips`; a team or a game page is listing OTHER
 * subjects (its players, both lineups) and needs the names, the ranks and the
 * factors, so those take the card.
 */
export function ResearchFlags({
  sport,
  league,
  who,
  title,
  showSubject,
  id,
  variant = 'card',
}: {
  sport: string | null | undefined;
  league?: string | null;
  who: FlagsQuery;
  title?: string;
  showSubject?: boolean;
  id?: string;
  variant?: 'card' | 'chips';
}) {
  const { flags, loading } = useResearchFlags(sport, who, league);
  if (variant === 'chips') return <ResearchFlagChips flags={flags} />;
  return <ResearchFlagsCard flags={flags} loading={loading} title={title} showSubject={showSubject} id={id} sport={sport} />;
}
