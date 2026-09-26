'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Card, DataTable, EmptyState, FormBars, PercentileCell, cx, type Column, SectionBand } from '@/components/ui';
import { GameSubject, PlayerSubject } from './SlateSubject';
import { WeatherIcons } from './WeatherIcons';
import type { SpotlightCard, SpotlightColumn, SpotlightRow } from '@/lib/slate/spotlights';
import type { FlagsData, ResearchFlag } from '@/lib/slate/flags';

/**
 * Spotlights (S3) — one `Card` per spotlight in a 2-up grid.
 *
 * Every factor is a column with an `info` tooltip naming its SOURCE, and every
 * row carries a "why" in plain words. That is the spec's requirement and it is
 * also the honest one: a ranked table without its factors is an assertion, and
 * a factor without its source is an assertion about an assertion.
 *
 * The component never asks which sport it is. A spotlight is a
 * `SpotlightCard` — columns, rows, caption, and an empty state that says why —
 * and every sport's cards are built by the same two functions over the same
 * candidate history.
 *
 * F0 added a third source of the same card: the PYTHON spotlights
 * (`slate_rankings`, `kind='spotlight'`), converted by `flagSpotlightCards`,
 * plus N5's weather list. They arrive here as `SpotlightCard`s like the rest,
 * so this file did not have to learn what a ranking is.
 */

/** A row's subject, by what the row IS: a game (its two logos) or a player (face, teams, sentence). */
function Subject({ r }: { r: SpotlightRow }) {
  if (r.game) return <GameSubject away={r.game.away} home={r.game.home} sub={r.game.sub ?? r.context ?? undefined} href={r.href} read={r.read} />;
  return <PlayerSubject name={r.subjectName} headshot={r.headshotUrl} fallback={r.logoUrl} href={r.href} team={r.team} opp={r.opp} read={r.read} />;
}

/**
 * One cell, drawn by the column's declared `kind` (slate-polish v4) — the data
 * says how it reads, never the sport. A value that is a verdict on its own
 * (a 90% hit rate, a run of misses) is bold in its colour; everything else is
 * plain ink, so colour only appears where it means something.
 */
function Cell({ r, c }: { r: SpotlightRow; c: SpotlightColumn }) {
  const v = r.values[c.key];
  switch (c.kind) {
    case 'market':
      return v ? (
        <span className="flex flex-col whitespace-nowrap">
          <span className="text-body-sm text-ink">{v.text}</span>
          {v.sub ? <span className="text-label text-ink-muted">{v.sub}</span> : null}
        </span>
      ) : (
        <span className="text-ink-muted">—</span>
      );
    case 'form':
      return <FormBars games={r.games ?? []} line={r.line ?? null} label={`${r.subjectName}, ${c.label.toLowerCase()}`} />;
    case 'rate':
      return v ? (
        <span className="flex flex-col items-end whitespace-nowrap">
          <b className={cx('text-body font-bold tabular-nums', v.tone === 'good' ? 'text-good-ink' : v.tone === 'bad' ? 'text-bad-ink' : 'text-ink')}>{v.text}</b>
          {v.sub ? <span className="text-label text-ink-muted">{v.sub}</span> : null}
          {v.delta ? (
            <span className={cx('text-label font-semibold tabular-nums', v.delta.up ? 'text-good-ink' : 'text-bad-ink')}>
              {v.delta.up ? '▲' : '▼'} {v.delta.text}
            </span>
          ) : null}
        </span>
      ) : (
        <span className="text-ink-muted">—</span>
      );
    case 'factor':
      return <PercentileCell value={v?.text ?? '—'} percentile={v?.percentile ?? null} />;
    case 'weather':
      return <WeatherIcons w={r.weather} fallback={v?.text} />;
    default:
      return <>{v?.text ?? '—'}</>;
  }
}

function toColumns(card: SpotlightCard): Column<SpotlightRow>[] {
  return [
    {
      key: 'subject',
      label: card.subjectLabel ?? 'Player',
      sortable: false,
      // The sentence under the name must be able to break onto its second line.
      wrap: true,
      render: (r) => <Subject r={r} />,
    },
    ...card.columns.map<Column<SpotlightRow>>((c) => ({
      key: c.key,
      label: c.label,
      info: c.info,
      numeric: c.numeric,
      sortable: false,
      render: (r) => <Cell r={r} c={c} />,
      // The grey magnitude bar is gone wherever the cell draws its own
      // encoding (v4: "the same greyish bar that doesn't represent anything").
      bar: c.kind ? undefined : (r) => r.values[c.key]?.bar ?? null,
    })),
  ];
}

/**
 * The whole slate's Python spotlights (F0). The research pages ask the same
 * route for one subject's; this asks for all of them, which is one cache entry
 * shared with every page on the site.
 */
export function useSlateFlags(sport: string, league: string | null, date: string | null, refreshKey?: string | null) {
  const [flags, setFlags] = useState<ResearchFlag[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ sport });
        if (sport === 'soccer' && league) params.set('league', league);
        if (date) params.set('date', date);
        const res = await fetch(`/api/slate/flags?${params}`, { cache: 'no-store' });
        const data = res.ok ? ((await res.json()) as FlagsData) : null;
        if (!cancelled) setFlags(data?.flags ?? []);
      } catch {
        if (!cancelled) setFlags([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sport, league, date, refreshKey]);
  return { flags, loading };
}

export function SlateSpotlights({ cards, loading, lead }: {
  cards: SpotlightCard[];
  loading: boolean;
  /** A full-width card above the grid — the Edge / EV ranking (slate-polish v4, D). */
  lead?: ReactNode;
}) {
  // Nothing to show and nothing loading means the sport has no candidates at
  // all — the Games section above already says so, and a second empty card
  // repeating it would be noise.
  if (!loading && !lead && cards.every((c) => c.rows.length === 0)) return null;

  return (
    <section id="slate-spotlights" className="mb-6 scroll-mt-[150px]">
      <SectionBand title="Spotlights" />
      {lead ? <div className="mb-3">{lead}</div> : null}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {cards.map((card) => (
          <Card
            key={card.id}
            title={card.title}
            count={card.rows.length || undefined}
            scope={card.scope}
            flush
            state={loading && card.rows.length === 0 ? { kind: 'loading', lines: 6 } : { kind: 'ready' }}
            caption={card.caption}
          >
            {card.rows.length > 0 ? (
              <DataTable
                caption={card.title}
                columns={toColumns(card)}
                rows={card.rows}
                rowKey={(r) => r.key}
                // v4: no row opens. A flag's sentence sits under the name at
                // one width; the universal cards' "why" restated the bars and
                // the rate beside them, so it is not drawn.
              />
            ) : loading ? null : (
              <EmptyState title="Nothing to spotlight" reason={card.empty ?? 'No rows qualify on this slate.'} />
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
