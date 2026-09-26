'use client';

import { useEffect, useState } from 'react';
import { Avatar, Card, DataTable, EmptyState, HeatNumber, PercentileCell, ResultMark, Tabs, Tooltip, cx, type Column, SectionBand } from '@/components/ui';
import { PlayerSubject } from './SlateSubject';
import { TeamLogo } from '../SubjectAvatar';
import { headshotFor, teamLogoFor } from '@/lib/sports/shared/identity';
import type { ReceiptRow, ReceiptSlate, SpecialRanking, SpecialRow, SpecialsData } from '@/lib/slate/specials';
import { formatFactor } from '@/lib/slate/specialsFormat';

/**
 * Specials (S4) — odds-free rankings for the books' common promos, with the
 * receipts under each one.
 *
 * `Tabs` across the sport's rankings; every factor a column with `info`
 * naming its source; the score as a bar; the "why" built from each factor's
 * PERCENTILE across the whole pool. The caption says what the number is not —
 * a probability — and that the weights are equal until a backtest sets them.
 *
 * RECEIPTS are the frozen top five of the last graded slate and what happened,
 * plus a running seven-day count. A player who did not play is neither a hit
 * nor a miss, and is shown as such rather than being counted either way.
 */



/** A team mark in the "team vs opponent" line: logo + abbreviation, plain text when a sport has no logo. */
function TeamMark({ sport, teamId, abbr }: { sport: string; teamId: string | null; abbr: string | null }) {
  if (!abbr) return null;
  const url = teamLogoFor(sport, teamId, abbr);
  return url ? <TeamLogo logoUrl={url} abbreviation={abbr} size={14} /> : <span>{abbr}</span>;
}

function columnsFor(ranking: SpecialRanking, sport: string): Column<SpecialRow>[] {
  return [
    {
      // C5: the rank lives INSIDE this cell rather than in a column of its own,
      // because `DataTable` pins the FIRST column and this table is nine
      // columns wide — with a separate "#" column it was the rank that stayed
      // on screen while the player it ranked scrolled away.
      key: 'subject',
      label: 'Player',
      sortable: false,
      wrap: true,
      // v4: the one row anatomy — face, name, team vs opponent with logos, and
      // the sentence (Python's, from this player's two strongest factors) at
      // one width under them.
      render: (r) => (
        <PlayerSubject
          rank={r.rank}
          name={r.subjectName}
          headshot={headshotFor(sport, r.subjectId)}
          team={r.team ? { abbr: r.team, logoUrl: teamLogoFor(sport, r.teamId, r.team) } : null}
          opp={r.opponent ? { abbr: r.opponent, logoUrl: teamLogoFor(sport, r.opponentId, r.opponent) } : null}
          read={r.read}
        />
      ),
    },
    ...ranking.def.factors.map<Column<SpecialRow>>((f) => ({
      key: f.key,
      label: f.label,
      info: f.info,
      numeric: true,
      sortable: false,
      // C5: the value AND its percentile across today's pool. The percentile
      // is the whole reason a row is where it is, and it was previously only
      // readable by opening the row.
      render: (r) => <PercentileCell value={formatFactor(f.key, r.values[f.key])} percentile={r.values[f.key] == null ? null : r.percentiles[f.key]} />,
    })),
    {
      key: 'score',
      label: 'Score',
      numeric: true,
      sortable: false,
      info: "The mean of each factor's percentile across today's pool. Equal weights until a pre-registered backtest sets them. A ranking of the factors, not a probability.",
      // v4: a bold number in the heat ramp, not a grey bar that said "bigger".
      render: (r) => <HeatNumber value={r.score} />,
    },
  ];
}

/**
 * C5 — the receipts, as a graded breakdown rather than a row of chips.
 *
 * WHAT IT HAS TO SAY, in the order a reader asks it: how many of the frozen
 * top five actually did it, which ones, what each of them actually did, and
 * whether that day was typical. A chip row answered the first two and nothing
 * else.
 *
 * A DID-NOT-PLAY IS NOT A MISS and never counts as one. It is hatched in the
 * bar, muted in the table, and excluded from both the day's count and the
 * seven-day one — every denominator here says "who played" for that reason.
 *
 * NOTHING IS A PARLAY. Five separate calls graded separately; the footer says
 * so, because a row of five green marks otherwise reads as one winning ticket.
 */
function ResultBar({ rows }: { rows: ReceiptRow[] }) {
  if (rows.length === 0) return null;
  return (
    <span className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
      {rows.map((r) => (
        <span
          key={`${r.rank}-${r.subjectId}`}
          className={cx(
            'block flex-1 rounded-full',
            r.hit == null ? 'bg-card-sunk opacity-60' : r.hit ? 'bg-good' : 'bg-bad',
          )}
          style={r.hit == null ? { backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 3px, rgba(0,0,0,0.18) 3px 6px)' } : undefined}
        />
      ))}
    </span>
  );
}

/** The last seven graded slates, one bar each — newest on the right. */
function SlateBars({ slates }: { slates: ReceiptSlate[] }) {
  if (slates.length === 0) return null;
  const ordered = [...slates].reverse();
  return (
    <div className="flex items-end gap-1" aria-hidden>
      {ordered.map((s) => {
        const share = s.played > 0 ? s.hits / s.played : 0;
        return (
          <Tooltip key={s.date} content={`${s.date}: ${s.hits} of ${s.played} who played`}>
            <span className="flex h-8 w-3 items-end rounded-xs bg-card-sunk">
              <span className="block w-full rounded-xs bg-good" style={{ height: `${Math.max(share * 100, s.hits > 0 ? 12 : 0)}%` }} />
            </span>
          </Tooltip>
        );
      })}
    </div>
  );
}

function receiptColumns(sport: string): Column<ReceiptRow>[] {
  return [
    {
      // The rank sits in this cell for the same reason it does above: on a
      // phone the table scrolls sideways, and the pinned column has to be the
      // player rather than the number beside them. Ties share a rank.
      key: 'player',
      label: 'Player',
      sortable: false,
      render: (r) => (
        <span className={cx('flex min-w-0 flex-col', r.hit == null && 'opacity-60')}>
          <span className="flex items-center gap-1.5">
            <span className="w-4 shrink-0 text-right text-label tabular-nums text-ink-muted">{r.rank}</span>
            <Avatar label={r.subjectName} src={headshotFor(sport, r.subjectId) ?? undefined} size={24} decorative />
            <span className="truncate font-semibold text-ink text-body-sm">{r.subjectName}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1.5 text-label text-ink-muted">
            <TeamMark sport={sport} teamId={r.teamId} abbr={r.team} />
            {r.opponent ? (
              <>
                <span>vs</span>
                <TeamMark sport={sport} teamId={r.opponentId} abbr={r.opponent} />
              </>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      key: 'detail',
      label: 'What happened',
      sortable: false,
      // A row graded before PY-A has no stat line. An em dash is the honest
      // answer; inventing one from `value` would be a different number.
      render: (r) => <span className={cx('text-body-sm', r.hit == null ? 'text-ink-muted' : 'text-ink-secondary')}>{r.detail ?? '—'}</span>,
    },
    {
      key: 'result',
      label: 'Result',
      sortable: false,
      align: 'right',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <ResultMark result={r.hit == null ? 'dnp' : r.hit ? 'hit' : 'miss'} kind="dot" />
          <span className={cx('text-label', r.hit == null ? 'text-ink-muted' : 'text-ink-secondary')}>
            {r.hit == null ? 'Did not play' : r.hit ? 'Yes' : 'No'}
          </span>
        </span>
      ),
    },
  ];
}

function Receipts({ ranking, sport }: { ranking: SpecialRanking; sport: string }) {
  const { receipts, def } = ranking;
  if (!receipts.date) {
    return (
      <p className="border-t border-line-soft px-4 py-3 text-label text-ink-muted">
        <span className="font-semibold text-ink-secondary">Receipts:</span> none yet. The job grades the frozen top five the morning after each slate, so
        the first ones appear once a day has been played and graded.
      </p>
    );
  }
  /**
   * READ THE PAYLOAD DEFENSIVELY, because a `cachedRoute` serves the SHAPE it
   * cached. `snapshot_cache` survives deploys, so for one TTL after any change
   * to this payload the page is handed the old shape — `receipts.slates` was
   * undefined here and `.length` on it took the whole Slate down with a
   * hydration error. Found by rendering, not by tsc: the type says the field
   * is there, and for the cached bytes it was not.
   */
  const top5 = receipts.top5 ?? [];
  const slates = receipts.slates ?? [];
  const played = top5.filter((r) => r.hit != null);
  const hits = played.filter((r) => r.hit).length;
  const leader = receipts.leader;
  return (
    <div className="border-t border-line-soft px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="text-overline uppercase text-ink-muted">
            {def.title} · {receipts.date}
          </p>
          {played.length > 0 ? (
            <>
              <p className="mt-0.5 text-heading text-ink">
                {hits} of {played.length} who played
              </p>
              <div className="mt-2 max-w-[260px]">
                <ResultBar rows={top5} />
              </div>
            </>
          ) : (
            // The NFL case, measured: a leader was found but no ranked player's
            // game had landed when the job graded. Saying so beats "0 of 0".
            <p className="mt-0.5 text-body-sm text-ink-secondary">No ranked player has been graded for that slate yet.</p>
          )}
        </div>
        {slates.length > 0 ? (
          <div className="shrink-0">
            <p className="text-overline uppercase text-ink-muted">Last {receipts.week.slates} slates</p>
            <div className="mt-1 flex items-end gap-2">
              <SlateBars slates={slates} />
              <span className="text-label text-ink-secondary">
                {receipts.week.hits} of {receipts.week.played} who played
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {leader ? (
        <p className="mt-2 text-label text-ink-secondary">
          The day’s best was <span className="font-semibold text-ink">{formatFactor(def.factors[0]?.key ?? '', leader.value)}</span> · {leader.name} —{' '}
          {leader.ourRank == null ? 'not ranked by us' : `our #${leader.ourRank}`}.
        </p>
      ) : null}

      {top5.length > 0 ? (
        <div className="mt-3">
          <DataTable
            caption={`${def.title} receipts, ${receipts.date}`}
            columns={receiptColumns(sport)}
            rows={top5}
            rowKey={(r) => `${r.rank}-${r.subjectId}`}
            density="compact"
          />
        </div>
      ) : null}

      <p className="mt-2 text-label text-ink-muted">
        Each player is graded on their own — a ranking of separate calls, not a parlay. A player who did not play is neither a hit nor a miss.
      </p>
    </div>
  );
}

export function SlateSpecials({ data, loading, sport }: { data: SpecialsData | null; loading: boolean; sport: string }) {
  const rankings = data?.rankings ?? [];
  const [tab, setTab] = useState<string | null>(null);
  const active = rankings.find((r) => r.def.id === tab) ?? rankings[0];

  if (!loading && rankings.length === 0) return null;

  return (
    <section id="slate-specials" className="mb-6 scroll-mt-[150px]">
      <SectionBand title="Specials" />
      {loading && !active ? (
        <Card title="Specials" state={{ kind: 'loading', lines: 6 }} />
      ) : active ? (
        <Card
          // With more than one ranking the tabs name them; the title then says
          // which promo the open one answers rather than repeating its tab.
          title={rankings.length > 1 ? active.def.promo : active.def.title}
          count={rankings.length > 1 ? undefined : active.rows.length}
          scope={active.frozen ? 'Frozen at the first game' : 'Updates until the first game'}
          flush
          caption={`A ranking of the factors, not a probability. Weights are equal until a pre-registered backtest sets them.${active.def.notHeld ? ` ${active.def.notHeld}` : ''}`}
        >
          {rankings.length > 1 ? (
            <div className="px-4 pt-1">
              <Tabs
                label="Specials rankings"
                value={active.def.id}
                onChange={setTab}
                items={rankings.map((r) => ({ value: r.def.id, label: r.def.title, count: r.rows.length }))}
              />
            </div>
          ) : null}
          {active.rows.length > 0 ? (
            <DataTable
              caption={active.def.title}
              columns={columnsFor(active, sport)}
              rows={active.rows}
              rowKey={(r) => `${r.rank}-${r.subjectId}`}
            />
          ) : (
            <EmptyState title="Nothing ranked" reason="The job found no candidates for this ranking today." />
          )}
          <Receipts ranking={active} sport={sport} />
        </Card>
      ) : null}
    </section>
  );
}

export function useSlateSpecials(sport: string, league: string | null, date: string | null, refreshKey?: string | null) {
  const [data, setData] = useState<SpecialsData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ sport });
        if (sport === 'soccer' && league) params.set('league', league);
        if (date) params.set('date', date);
        const res = await fetch(`/api/slate/specials?${params}`, { cache: 'no-store' });
        if (!cancelled) setData(res.ok ? ((await res.json()) as SpecialsData) : null);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sport, league, date, refreshKey]);
  return { data, loading };
}
