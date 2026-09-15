'use client';

import { useState } from 'react';
import { Avatar, Card, Chip, Skeleton } from './ui';
import type { GameStateSlot } from '@/lib/sports/mlb/adapters/playerDetailAdapter';

/**
 * C4 — the game in progress on the player page (R6.1d), one card for every
 * sport. It reads `GameStateSlot`: the score, the period, the player's own game
 * so far and today's lines against their main line are shared; a sport's own
 * situation is a presence-checked block (`baseball` today). No sport check.
 *
 * Replaces the MLB-only "Live today" block that sat inside the prop section
 * with its own hand-sized type and colours.
 */
export function GameStateCard({ state, subjectName }: { state: GameStateSlot; subjectName: string }) {
  const [allPlays, setAllPlays] = useState(false);
  const title = (
    <span className="inline-flex items-center gap-2">
      Live now <Chip tone="live">{state.status === 'loading' ? 'Loading' : state.periodLabel ?? 'In progress'}</Chip>
    </span>
  );
  if (state.status === 'loading') {
    return <Card title={title} dense state={{ kind: 'loading', skeleton: <Skeleton h={96} className="w-full" /> }}>{null}</Card>;
  }

  const plays = state.subjectLine?.plays ?? [];
  const shownPlays = allPlays ? plays : plays.slice(-2);
  const b = state.baseball;

  return (
    <Card title={title} scope={`${state.away.abbr} @ ${state.home.abbr}`} dense>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,15rem)_1fr]">
        <div className="space-y-3">
          <div className="rounded-ctl border border-line-soft bg-card-sunk p-3">
            {[state.away, state.home].map((t) => (
              <div key={t.abbr} className="flex items-center justify-between gap-2 py-0.5">
                <span className="inline-flex items-center gap-2 text-body-sm font-semibold text-ink">
                  {t.logoUrl ? <Avatar kind="logo" src={t.logoUrl} label={t.abbr} size={20} /> : null}
                  {t.abbr}
                </span>
                <span className="text-heading tabular-nums text-ink">{t.score ?? '—'}</span>
              </div>
            ))}
          </div>

          {b ? (
            <div className="flex items-center justify-between gap-3 rounded-ctl border border-line-soft px-3 py-2">
              <div className="space-y-1">
                <CountDots label="B" filled={b.balls} total={3} />
                <CountDots label="S" filled={b.strikes} total={2} />
                <CountDots label="O" filled={b.outs} total={2} />
              </div>
              <BaseDiamond {...b.bases} />
            </div>
          ) : null}

          {b ? (
            <div className="space-y-2">
              {[
                ['At the plate', b.batter],
                ['On the mound', b.pitcher],
              ].map(([label, who]) =>
                who && typeof who === 'object' ? (
                  <div key={label as string} className="flex items-center gap-2 rounded-ctl border border-line-soft px-2.5 py-2">
                    <Avatar src={who.headshotUrl} label={who.name} size={32} />
                    <div className="min-w-0">
                      <div className="text-overline text-ink-muted">{label as string}</div>
                      <div className="truncate text-body-sm font-semibold text-ink">{who.name}</div>
                      <div className="text-label tabular-nums text-ink-muted">{who.line}</div>
                    </div>
                  </div>
                ) : null,
              )}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-3">
          <div>
            <div className="text-overline text-ink-muted">{subjectName} today</div>
            {state.subjectLine ? (
              <>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 tabular-nums">
                  <span className="text-body font-semibold text-ink">{state.subjectLine.headline}</span>
                  {state.subjectLine.facts.map((f) => (
                    <span key={f} className="text-body-sm text-ink-secondary">{f}</span>
                  ))}
                  {state.subjectLine.now ? <Chip tone="live">{state.subjectLine.now}</Chip> : null}
                </div>
                {plays.length ? (
                  <ul className="mt-2 space-y-1 border-t border-line-soft pt-2">
                    {shownPlays.map((p) => (
                      <li key={p.label} className="flex items-baseline gap-2 text-body-sm">
                        <span className="shrink-0 font-semibold text-ink">{p.label}</span>
                        <span className="min-w-0 flex-1 text-ink-secondary">{p.text}</span>
                        {p.note ? <span className="shrink-0 font-semibold text-good">{p.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {plays.length > 2 ? (
                  <button type="button" onClick={() => setAllPlays((v) => !v)} className="mt-1 text-label font-semibold text-ink-secondary underline">
                    {allPlays ? 'Show fewer' : `Show all ${plays.length}`}
                  </button>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-body-sm text-ink-muted">Not in the box score yet.</p>
            )}
          </div>

          <div>
            <div className="text-overline text-ink-muted">Lines so far</div>
            {state.lines.length === 0 ? (
              <p className="mt-1 text-body-sm text-ink-muted">None of today&apos;s markets for this player has a live value.</p>
            ) : (
              <ul className="mt-1 divide-y divide-line-soft">
                {state.lines.map((l) => {
                  const cleared = l.direction === 'O' ? l.value > l.line : l.value <= l.line;
                  return (
                    <li key={l.key} className="flex items-center gap-2 py-1.5 text-body-sm">
                      <span className="min-w-0 flex-1 truncate text-ink">
                        {l.label} {l.direction} {l.line}
                      </span>
                      <span className="tabular-nums text-ink-secondary">{l.value}</span>
                      <Chip tone={cleared ? 'good' : 'neutral'}>{cleared ? (l.direction === 'O' ? 'Cleared' : 'Under so far') : 'Not yet'}</Chip>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Ball, strike and out lights. */
function CountDots({ label, filled, total }: { label: string; filled: number; total: number }) {
  return (
    <span className="flex items-center gap-1.5" aria-label={`${label} ${filled}`}>
      <span className="w-2 text-overline text-ink-muted">{label}</span>
      <span className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={`h-2 w-2 rounded-full ${i < filled ? 'bg-ink' : 'bg-line'}`} />
        ))}
      </span>
    </span>
  );
}

/** Occupied bases; home is implied at the bottom. */
function BaseDiamond({ first, second, third }: { first: boolean; second: boolean; third: boolean }) {
  const base = (cx: number, cy: number, on: boolean, name: string) => (
    <rect key={name} x={cx - 5} y={cy - 5} width={10} height={10} transform={`rotate(45 ${cx} ${cy})`} className={on ? 'fill-ink stroke-ink' : 'fill-card stroke-line'} strokeWidth={1.5} />
  );
  const on = [first && 'first', second && 'second', third && 'third'].filter(Boolean).join(', ');
  return (
    <svg viewBox="0 0 44 40" width={44} height={40} role="img" aria-label={on ? `Runners on ${on}` : 'Bases empty'}>
      {base(22, 10, second, '2')}
      {base(34, 22, first, '1')}
      {base(10, 22, third, '3')}
    </svg>
  );
}
