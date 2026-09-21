'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Avatar, Button, Card, Chip, DataTable, Skeleton, cx } from './ui';
import { BookLogo } from './BookLogo';
import { fmt } from './charts/tokens';
import type { GameStateSlot } from '@/lib/sports/mlb/adapters/playerDetailAdapter';

/**
 * C4 — the game in progress, its own section under the hero (R6.3 rework;
 * mockup `docs/design/hero-live/index.html`). One card for every sport: it
 * reads `GameStateSlot`, so the score, the player's own game, his lines and the
 * event feed are shared, and a sport's situation is a presence-checked block
 * beside the score (`baseball`, `football` today).
 *
 * WHAT THE REWORK CHANGED. The first cut (R6.1d) sat inside "Prop analysis",
 * between that heading and the block it introduced, and stacked three bordered
 * boxes inside a card inside a section — four borders deep. The lines were a
 * flat list with a chip. Now: bands rather than boxes, the scoreboard beside
 * the situation, and the lines as a table where a cleared line tints its row
 * and carries a check, with the book behind each price (operator, 2026-09-15:
 * "green highlight to the whole row if they hit", "market should have book
 * logo as well").
 */
export function GameStateCard({ state, subjectName }: { state: GameStateSlot; subjectName: string }) {
  const [allPlays, setAllPlays] = useState(false);
  const title = (
    <span className="inline-flex items-center gap-2">
      <Chip tone="live">Live</Chip>
      <span>
        {state.away.abbr} @ {state.home.abbr}
        {state.periodLabel ? ` · ${state.periodLabel}` : ''}
      </span>
    </span>
  );
  if (state.status === 'loading') {
    return (
      <Card title={title} dense state={{ kind: 'loading', skeleton: <Skeleton h={96} className="w-full" /> }}>
        {null}
      </Card>
    );
  }

  const plays = state.subjectLine?.plays ?? [];
  const shownPlays = allPlays ? plays : plays.slice(-2);
  const b = state.baseball;
  const f = state.football;

  return (
    <Card
      title={title}
      scope={state.gameHref ? <Link href={state.gameHref} className="text-ink-secondary underline-offset-2 hover:underline">Game page →</Link> : undefined}
      dense
      bodyClassName="p-0"
    >
      <div className="grid grid-cols-1 gap-4 border-b border-line-soft p-4 md:grid-cols-[minmax(0,15rem)_1fr] md:items-center">
        <div className="space-y-1.5">
          {[state.away, state.home].map((t) => (
            <div key={t.abbr} className="flex items-center gap-3">
              <span className="flex flex-1 items-center gap-2 text-body font-semibold text-ink">
                {t.logoUrl ? <Avatar kind="logo" src={t.logoUrl} label={t.abbr} size={22} decorative /> : null}
                {t.abbr}
              </span>
              <span className="text-heading tabular-nums text-ink">{t.score ?? '—'}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          {b ? (
            <>
              <Fact label="Count">
                <div className="text-body font-semibold tabular-nums text-ink">
                  {b.balls}–{b.strikes}
                </div>
                <Dots filled={b.balls} total={3} label={`${b.balls} balls`} />
                <Dots filled={b.strikes} total={2} label={`${b.strikes} strikes`} />
              </Fact>
              <Fact label="Outs">
                <div className="text-body font-semibold tabular-nums text-ink">{b.outs}</div>
                <Dots filled={b.outs} total={2} label={`${b.outs} out`} />
              </Fact>
              <Fact label="Bases">
                <BaseDiamond {...b.bases} />
              </Fact>
              <div className="space-y-2">
                {[
                  ['At the plate', b.batter] as const,
                  ['On the mound', b.pitcher] as const,
                ].map(([label, who]) =>
                  who ? (
                    <div key={label} className="flex items-center gap-2">
                      <Avatar src={who.headshotUrl} label={who.name} size={30} />
                      <div className="min-w-0">
                        <div className="text-overline uppercase text-ink-muted">{label}</div>
                        <div className="truncate text-body-sm font-semibold text-ink">{who.name}</div>
                        <div className="text-label tabular-nums text-ink-muted">{who.line}</div>
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            </>
          ) : null}
          {f ? (
            <>
              {f.possession ? <Fact label="Possession"><div className="text-body font-semibold text-ink">{f.possession}</div></Fact> : null}
              {f.downAndDistance ? <Fact label="Down"><div className="text-body font-semibold tabular-nums text-ink">{f.downAndDistance}</div></Fact> : null}
              {f.ballOn ? <Fact label="Ball on"><div className="text-body font-semibold tabular-nums text-ink">{f.ballOn}</div></Fact> : null}
              {f.redZone ? <Chip tone="bad">Red zone</Chip> : null}
            </>
          ) : null}
          {!b && !f ? <span className="text-body-sm text-ink-muted">{state.periodLabel}</span> : null}
        </div>
      </div>

      <div className="border-b border-line-soft p-4">
        <div className="text-overline uppercase text-ink-muted">{subjectName} today</div>
        {state.subjectLine ? (
          <>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 tabular-nums">
              <span className="text-title text-ink">{state.subjectLine.headline}</span>
              {state.subjectLine.facts.map((x) => (
                <span key={x} className="text-body-sm text-ink-secondary">
                  {x}
                </span>
              ))}
              {state.subjectLine.now ? <Chip tone="live">{state.subjectLine.now}</Chip> : null}
            </div>
            {plays.length ? (
              <ul className="mt-2 space-y-1">
                {shownPlays.map((p) => (
                  <li key={p.label} className="flex items-baseline gap-2 text-body-sm">
                    <span className="shrink-0 font-semibold text-ink">{p.label}</span>
                    <span className="min-w-0 flex-1 text-ink-secondary">{p.text}</span>
                    {p.note ? <span className="shrink-0 font-semibold text-good-ink">{p.note}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {plays.length > 2 ? (
              <Button variant="link" size="sm" onPress={() => setAllPlays((v) => !v)} className="mt-1 text-label text-ink-secondary">
                {allPlays ? 'Show fewer' : `Show all ${plays.length}`}
              </Button>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-body-sm text-ink-muted">{state.notHeld ?? 'Not in the box score yet.'}</p>
        )}
      </div>

      <div className={cx('p-4', state.events.length ? 'border-b border-line-soft' : undefined)}>
        <div className="mb-1 text-overline uppercase text-ink-muted">Lines so far</div>
        {state.lines.length === 0 ? (
          <p className="text-body-sm text-ink-muted">None of today&apos;s markets for this player has a live value.</p>
        ) : (
          <DataTable
            caption={`${subjectName}'s markets against their line, live`}
            rows={state.lines}
            rowKey={(r) => r.key}
            rowClassName={(r) => (r.cleared ? '[&>td]:bg-good/10' : undefined)}
            columns={[
              {
                key: 'label',
                label: 'Market',
                render: (r) => (
                  <span className="inline-flex items-center gap-2">
                    {r.price?.bookmaker ? <BookLogo bookId={r.price.bookmaker} size={16} /> : null}
                    <span className="text-ink">{r.label}</span>
                  </span>
                ),
              },
              { key: 'line', label: 'Line', render: (r) => `${r.direction} ${r.line}`, sortValue: (r) => r.line },
              {
                key: 'value',
                label: 'Now',
                numeric: true,
                render: (r) => (
                  <span className={r.cleared ? 'font-semibold text-good-ink' : undefined}>
                    {r.value}
                    {r.cleared ? <span aria-label="cleared"> ✓</span> : null}
                  </span>
                ),
              },
              { key: 'price', label: 'Price', numeric: true, sortValue: (r) => r.price?.americanOdds ?? null, render: (r) => (r.price ? fmt.american(r.price.americanOdds) : '—') },
            ]}
          />
        )}
      </div>

      {state.events.length ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 p-4 text-body-sm text-ink-secondary">
          {state.events.map((e) => (
            <span key={e.clock + e.text}>
              <span className="font-semibold text-ink">{e.clock}</span> {e.text}
            </span>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-overline uppercase text-ink-muted">{label}</div>
      <div className="mt-0.5 space-y-1">{children}</div>
    </div>
  );
}

/** Ball, strike and out lights. */
function Dots({ filled, total, label }: { filled: number; total: number; label: string }) {
  return (
    <span className="flex gap-1" role="img" aria-label={label}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={cx('h-2 w-2 rounded-full', i < filled ? 'bg-ink' : 'bg-line')} />
      ))}
    </span>
  );
}

/** Occupied bases; home is implied at the bottom. */
function BaseDiamond({ first, second, third }: { first: boolean; second: boolean; third: boolean }) {
  const base = (cx0: number, cy: number, on: boolean, name: string) => (
    <rect key={name} x={cx0 - 5} y={cy - 5} width={10} height={10} transform={`rotate(45 ${cx0} ${cy})`} className={on ? 'fill-ink stroke-ink' : 'fill-card stroke-line'} strokeWidth={1.5} />
  );
  const on = [first && 'first', second && 'second', third && 'third'].filter(Boolean).join(', ');
  return (
    <svg viewBox="0 0 44 36" width={44} height={36} role="img" aria-label={on ? `Runners on ${on}` : 'Bases empty'}>
      {base(22, 8, second, '2')}
      {base(34, 20, first, '1')}
      {base(10, 20, third, '3')}
    </svg>
  );
}
