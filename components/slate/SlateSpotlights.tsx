'use client';

import { Avatar, Card, DataTable, EmptyState, type Column, SectionBand } from '@/components/ui';
import { TeamLogo } from '../SubjectAvatar';
import type { SpotlightCard, SpotlightRow } from '@/lib/slate/spotlights';

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
 */

function toColumns(card: SpotlightCard): Column<SpotlightRow>[] {
  return [
    {
      key: 'subject',
      label: 'Player',
      sortable: false,
      render: (r) => (
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className="relative block shrink-0">
            <Avatar label={r.subjectName} src={r.headshotUrl ?? undefined} fallbackSrc={r.logoUrl ?? undefined} size={24} href={r.href ?? undefined} decorative />
            {r.teamLogoUrl ? (
              <span className="absolute -bottom-0.5 -right-0.5 grid size-[14px] place-items-center rounded-full bg-card ring-1 ring-line">
                <TeamLogo logoUrl={r.teamLogoUrl} size={9} />
              </span>
            ) : null}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-semibold text-ink text-body-sm">{r.subjectName}</span>
            <span className="truncate text-label text-ink-muted">{[r.market, r.context].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
      ),
    },
    ...card.columns.map<Column<SpotlightRow>>((c) => ({
      key: c.key,
      label: c.label,
      info: c.info,
      numeric: c.numeric,
      sortable: false,
      render: (r) => r.values[c.key]?.text ?? '—',
      bar: (r) => r.values[c.key]?.bar ?? null,
    })),
  ];
}

export function SlateSpotlights({ cards, loading }: { cards: SpotlightCard[]; loading: boolean }) {
  // Nothing to show and nothing loading means the sport has no candidates at
  // all — the Games section above already says so, and a second empty card
  // repeating it would be noise.
  if (!loading && cards.every((c) => c.rows.length === 0)) return null;

  return (
    <section id="slate-spotlights" className="mb-6 scroll-mt-[150px]">
      <SectionBand title="Spotlights" />
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
                // The "why" OPENS from the row rather than sitting in a
                // column: two of these cards sit side by side at 1440, and a
                // wrapping sentence beside five factor columns was clipped.
                expand={(r) => (
                  <p className="text-body-sm text-ink-secondary">
                    {r.why}
                    {r.href ? (
                      <>
                        {' '}
                        <a href={r.href} className="text-ink underline underline-offset-2">
                          Open the player →
                        </a>
                      </>
                    ) : null}
                  </p>
                )}
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
