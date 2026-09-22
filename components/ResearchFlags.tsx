'use client';

import { useEffect, useState } from 'react';
import { Card, Chip, Tooltip } from './ui';
import { groupFlags, type FlagsData, type ResearchFlag } from '@/lib/slate/flags';
import { formatFactor } from '@/lib/slate/specialsFormat';

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
        <Tooltip key={`${f.rankingId}:${f.subjectId}`} content={`${rankText(f)}. ${f.read ?? f.promo}`}>
          <Chip size="sm">{f.title}</Chip>
        </Tooltip>
      ))}
    </div>
  );
}

function FlagLine({ flag, showSubject }: { flag: ResearchFlag; showSubject: boolean }) {
  const measured = flag.factors.filter((f) => f.value != null);
  return (
    <li className="border-t border-line-soft py-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold text-ink text-body-sm">{showSubject ? flag.subjectName : flag.title}</span>
        <span className="text-label text-ink-muted">{showSubject ? `${flag.title} · ${rankText(flag)}` : rankText(flag)}</span>
      </div>
      {flag.read ? <p className="mt-0.5 text-body-sm text-ink-secondary">{flag.read}</p> : null}
      {measured.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {measured.map((f) => (
            <Tooltip key={f.key} content={f.info}>
              <span className="text-label text-ink-muted">
                {f.label} <span className="font-semibold tabular-nums text-ink-secondary">{formatFactor(f.key, f.value)}</span>
              </span>
            </Tooltip>
          ))}
        </div>
      ) : null}
    </li>
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
}: {
  flags: ResearchFlag[];
  loading: boolean;
  title?: string;
  showSubject?: boolean;
  id?: string;
}) {
  if (flags.length === 0) return null;
  const groups = groupFlags(flags);
  return (
    <Card
      id={id}
      title={title}
      count={flags.length}
      scope={groups.some((g) => g.frozen) ? 'Frozen at the first game' : 'Updates until the first game'}
      caption="Where each one stands among today's slate on the factors named. A ranking of those factors, not a probability, and not compared to a price."
    >
      <ul>
        {flags.map((f) => (
          <FlagLine key={`${f.rankingId}:${f.subjectId}`} flag={f} showSubject={showSubject} />
        ))}
      </ul>
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
  return <ResearchFlagsCard flags={flags} loading={loading} title={title} showSubject={showSubject} id={id} />;
}
