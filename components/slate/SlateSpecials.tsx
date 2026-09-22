'use client';

import { useEffect, useState } from 'react';
import { Card, Chip, DataTable, EmptyState, Tabs, type Column, SectionBand } from '@/components/ui';
import { TeamLogo } from '../SubjectAvatar';
import { athleteIdOf } from '@/lib/sports/shared/playerResearchShapes';
import type { SpecialRanking, SpecialRow, SpecialsData } from '@/lib/slate/specials';
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


function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * The "why", from the percentiles: the two factors this player ranks highest
 * on across today's pool, in plain words. It never invents a factor the row
 * does not carry, because the job skips a factor it could not measure.
 */
function whyOf(row: SpecialRow, ranking: SpecialRanking): string {
  const top = ranking.def.factors
    .filter((f) => row.percentiles[f.key] != null)
    .sort((a, b) => row.percentiles[b.key] - row.percentiles[a.key])
    .slice(0, 2);
  if (top.length === 0) return 'No factor could be measured for this player today.';
  const parts = top.map((f) => `${ordinal(row.percentiles[f.key])} percentile on ${f.label}`);
  return `Ranks here mostly on ${parts.join(' and ')} across today's pool.`;
}

function columnsFor(ranking: SpecialRanking, logoOf: (id: string) => string | undefined): Column<SpecialRow>[] {
  return [
    { key: 'rank', label: '#', numeric: true, sortable: false, render: (r) => r.rank },
    {
      key: 'subject',
      label: 'Player',
      sortable: false,
      render: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5">
            {logoOf(r.subjectId) ? <TeamLogo logoUrl={logoOf(r.subjectId)} size={16} /> : null}
            <span className="truncate font-semibold text-ink text-body-sm">{r.subjectName}</span>
          </span>
          <span className="truncate text-label text-ink-muted">{[r.team, r.opponent ? `vs ${r.opponent}` : null].filter(Boolean).join(' ')}</span>
        </span>
      ),
    },
    ...ranking.def.factors.map<Column<SpecialRow>>((f) => ({
      key: f.key,
      label: f.label,
      info: f.info,
      numeric: true,
      sortable: false,
      render: (r) => formatFactor(f.key, r.values[f.key]),
    })),
    {
      key: 'score',
      label: 'Score',
      numeric: true,
      sortable: false,
      info: "The mean of each factor's percentile across today's pool. Equal weights until a pre-registered backtest sets them. A ranking of the factors, not a probability.",
      render: (r) => r.score.toFixed(1),
      bar: (r) => Math.max(0, Math.min(1, r.score / 100)),
    },
  ];
}

function Receipts({ ranking }: { ranking: SpecialRanking }) {
  const { receipts } = ranking;
  if (!receipts.date) {
    return (
      <p className="border-t border-line-soft px-4 py-3 text-label text-ink-muted">
        <span className="font-semibold text-ink-secondary">Receipts:</span> none yet. The job grades the frozen top five the morning after each slate, so
        the first ones appear once a day has been played and graded.
      </p>
    );
  }
  return (
    <div className="border-t border-line-soft px-4 py-3">
      <p className="mb-2 text-label text-ink-muted">
        <span className="font-semibold text-ink-secondary">Receipts, {receipts.date}:</span> the frozen top five and what happened.
        {receipts.week.played > 0 ? ` Last ${receipts.week.slates} graded slate${receipts.week.slates === 1 ? '' : 's'}: ${receipts.week.hits} of ${receipts.week.played} who played.` : ''}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {receipts.top5.map((r) => (
          <Chip key={r.rank} tone={r.hit == null ? 'neutral' : r.hit ? 'good' : 'bad'} shape="box" size="md">
            {r.rank}. {r.subjectName} {r.hit == null ? '· did not play' : r.hit ? '· yes' : '· no'}
          </Chip>
        ))}
      </div>
    </div>
  );
}

export function SlateSpecials({ data, loading, teamLogoBySubject }: { data: SpecialsData | null; loading: boolean; teamLogoBySubject?: Map<string, string> }) {
  const rankings = data?.rankings ?? [];
  const [tab, setTab] = useState<string | null>(null);
  const active = rankings.find((r) => r.def.id === tab) ?? rankings[0];
  const logoOf = (id: string): string | undefined => teamLogoBySubject?.get(athleteIdOf(id));

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
              columns={columnsFor(active, logoOf)}
              rows={active.rows}
              rowKey={(r) => `${r.rank}-${r.subjectId}`}
              expand={(r) => <p className="text-body-sm text-ink-secondary">{whyOf(r, active)}</p>}
            />
          ) : (
            <EmptyState title="Nothing ranked" reason="The job found no candidates for this ranking today." />
          )}
          <Receipts ranking={active} />
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
