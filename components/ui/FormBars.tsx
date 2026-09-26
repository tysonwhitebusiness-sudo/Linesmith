'use client';

import type { ReactNode } from 'react';
import { Tooltip } from './Tooltip';
import { cx } from './cx';

/** One game in a form strip: what the player did, whether it cleared the line, and which game it was. */
export interface FormGame {
  /** The stat in that game; null draws a stub (no number held). */
  value: number | null;
  /** Cleared the line, missed it, or not graded (did not play). */
  hit: boolean | null;
  /** "Aug 4 @ WSH", or "3 games ago" where the date is not held. */
  label: string;
  /** "2 K" — the stat line the tooltip prints under the label. */
  detail?: string | null;
}

const H = 26;

/**
 * `FormBars` — the last N games as bars against the line (slate-polish v3/v4,
 * operator-approved 2026-09-26). It replaced a row of streak dots that the
 * operator called "a ton of dots": a dot said hit or miss and nothing else.
 *
 * A bar's HEIGHT is what the player did, the dashed rule is the line, green
 * cleared it and red missed it. Hovering (or focusing, or tapping) a bar names
 * the game — the question a dot could not answer.
 */
export function FormBars({ games, line, label, className }: { games: FormGame[]; line: number | null; label: string; className?: string }) {
  if (games.length === 0) return <span className="text-ink-muted">—</span>;
  const max = Math.max(line != null ? line * 2 : 0, ...games.map((g) => g.value ?? 0), 1);
  const px = (v: number) => Math.round((v / max) * H);
  return (
    <span role="group" aria-label={label} className={cx('relative inline-flex h-7 items-end gap-[3px] border-b border-line px-[3px]', className)}>
      {games.map((g, i) => (
        <Tooltip key={i} content={<FormTip game={g} line={line} />}>
          <span className="inline-flex h-full w-[9px] items-end rounded-xs outline-hidden focus-visible:ring-2 focus-visible:ring-ink">
            <span
              aria-label={`${g.label}: ${g.detail ?? g.value ?? 'no result'}, ${g.hit == null ? 'not graded' : g.hit ? 'cleared' : 'missed'}`}
              className={cx('block w-full rounded-t-[2px]', g.hit == null ? 'bg-card-sunk' : g.hit ? 'bg-good' : 'bg-bad')}
              style={{ height: Math.max(3, px(g.value ?? 0)) }}
            />
          </span>
        </Tooltip>
      ))}
      {line != null ? (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-muted" style={{ bottom: px(line) }} />
      ) : null}
    </span>
  );
}

function FormTip({ game, line }: { game: FormGame; line: number | null }): ReactNode {
  return (
    <span className="flex flex-col">
      <span className="font-semibold">{game.label}</span>
      <span>
        {game.detail ?? (game.value == null ? '—' : String(game.value))}
        {game.hit != null && line != null ? (
          <>
            {' · '}
            {/* A FILL, not an ink: the tooltip is dark, and the ink shades are for light cards. */}
            <span aria-hidden className={cx('mr-1 inline-block size-2 rounded-full align-middle', game.hit ? 'bg-good' : 'bg-bad')} />
            <b>
              {game.hit ? 'cleared' : 'missed'} {line}
            </b>
          </>
        ) : null}
      </span>
    </span>
  );
}
