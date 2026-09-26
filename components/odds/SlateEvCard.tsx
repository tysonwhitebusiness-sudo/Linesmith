'use client';

import { BookLogo } from '../BookLogo';
import { Card, DataTable, EmptyState, StatusMark, cx } from '../ui';
import { GameMark } from '../slate/SlateSubject';
import type { SlateGameRef } from './SlateOddsMovers';
import { marketLabel } from '@/lib/odds/props/marketLabels';
import { fmtAmerican, fmtLine, fmtPct } from '@/lib/odds/section/format';
import type { EdgeRanking, EdgeRankRow } from '@/lib/odds/section/types';

/**
 * The Slate's Edge / EV card (slate-polish D, operator-approved 2026-09-26):
 * today's market lines ranked by EV against Pinnacle's no-vig price — real
 * edges first, then the best offers that did not pass, each with WHY in two or
 * three words.
 *
 * NEVER BLANK. On most nights no line passes every gate, and a card that went
 * empty then said nothing. It shows the best prices and the gate that stopped
 * each one; the self-check's pause is said once, at the top, not on every row.
 *
 * RENDER ONLY — every number is a field of `/api/odds/edges?rank=` (Python's
 * `market_edge_candidates`); nothing here converts or compares a price
 * (tests/scan-no-edge.test.ts). No sentence under a row: EV is the one
 * coloured number, and the status column carries the reason.
 */

const GAME_MARKET: Record<string, string> = { ml: 'Moneyline', sp: 'Spread', tot: 'Total', tt_home: 'Home team total', tt_away: 'Away team total' };

/** Two or three words for the gate that stopped a line — the detail Python wrote, said plainly. */
function reasonWords(r: EdgeRankRow): string | null {
  if (r.status === 'edge') return null;
  if (r.status === 'held') return 'passes every gate';
  if (r.gate === 'g6_conservative') return 'below the fair price';
  const d = r.detail ?? '';
  const soft = /soft checked (\d+)\s*s/.exec(d);
  if (soft) {
    const s = Number(soft[1]);
    return `price ${s >= 120 ? `${Math.round(s / 60)} min` : `${s} s`} old`;
  }
  const sharp = /sharp checked (\d+)\s*min/.exec(d);
  if (sharp) return `Pinnacle ${sharp[1]} min old`;
  if (/no measured delay/.test(d)) return 'relay delay unmeasured';
  if (/price time unknown/.test(d)) return 'no price history';
  if (r.gate === 'g3_corroboration') return 'not corroborated';
  if (r.gate === 'g4_settled') return 'market not settled';
  if (r.gate === 'g5_pregame') return 'game has started';
  if (r.gate === 'g7_copies') return 'a copied price';
  return d.split(/[:(]/)[0].trim().slice(0, 28) || null;
}

function Status({ r }: { r: EdgeRankRow }) {
  if (r.status === 'edge') return <StatusMark status="ok" word="Edge" />;
  if (r.status === 'held') return <StatusMark status="hold" word="Held" reason={reasonWords(r)} />;
  return <StatusMark status="no" word={r.gate === 'g6_conservative' ? 'No edge' : 'Unverified'} reason={reasonWords(r)} />;
}

export function SlateEvCard({ ranking, refs, sport, nameOf }: {
  ranking: EdgeRanking | null;
  refs: Map<string, SlateGameRef>;
  sport: string;
  /** A prop line's player, from the slate's own props (the candidates table holds only the id). */
  nameOf?: (subjectId: string) => string | null;
}) {
  const game = (id: string) => {
    const g = refs.get(id);
    return g?.teams ? <GameMark away={g.teams.away} home={g.teams.home} href={g.href} /> : <b>{g?.label ?? id}</b>;
  };
  const teamOf = (r: EdgeRankRow) => {
    const t = refs.get(r.gameId)?.teams;
    return (r.side === 'home' ? t?.home.abbr : r.side === 'away' ? t?.away.abbr : null) ?? (r.side === 'home' ? 'Home' : 'Away');
  };
  const market = (r: EdgeRankRow) => {
    const side = r.side === 'over' ? 'Over' : r.side === 'under' ? 'Under' : r.side === 'yes' ? 'Yes' : r.side === 'no' ? 'No' : teamOf(r);
    if (r.kind === 'prop') {
      return (
        <span className="flex flex-col">
          <span className="font-semibold text-ink">{nameOf?.(r.subjectId) ?? 'Player'}</span>
          <span className="text-label text-ink-muted">
            {marketLabel(r.marketKey, sport)} · {side} {fmtLine(r.line)}
          </span>
        </span>
      );
    }
    const m = r.marketKey.split('_').slice(1).join('_');
    // A spread's stored line is the home point; the away side's is its negative.
    const point = m === 'sp' && r.line != null ? fmtLine(r.side === 'away' ? -r.line : r.line, true) : m === 'ml' ? '' : fmtLine(r.line);
    return (
      <span className="whitespace-nowrap">
        <b className="font-semibold text-ink">{GAME_MARKET[m] ?? m}</b> <span className="text-ink-secondary">{side} {point}</span>
      </span>
    );
  };

  const rows = ranking?.rows ?? [];
  const body =
    !ranking ? null : ranking.status === 'off' || ranking.status === 'stale' ? (
      <EmptyState title={ranking.status === 'off' ? 'Edges are switched off' : 'The edge check has stopped'} reason={ranking.reason ?? ''} />
    ) : rows.length === 0 ? (
      <EmptyState title="No sharp price to compare yet" reason="No market line on this slate has a Pinnacle price the check could use." />
    ) : (
      <>
        {ranking.status === 'paused' ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft bg-surface-subtle px-4 py-2">
            <StatusMark status="hold" word="Edges paused tonight" />
            <span className="text-label text-ink-muted">self-check · {(ranking.reason ?? '').replace(/\s*\(.*\)\s*$/, '')}</span>
          </div>
        ) : null}
        <DataTable<EdgeRankRow>
          caption="Today's market lines by EV against Pinnacle's no-vig price"
          rows={rows}
          rowKey={(r) => `${r.gameId}|${r.subjectId}|${r.marketKey}|${r.side}|${r.line}|${r.book}`}
          columns={[
            {
              key: 'rank',
              label: '#',
              sortable: false,
              render: (r) => (
                <span className={cx('text-label font-bold tabular-nums', r.status === 'unverified' ? 'text-ink-muted' : 'text-ink')}>{rows.indexOf(r) + 1}</span>
              ),
            },
            { key: 'game', label: 'Game', sortable: false, render: (r) => game(r.gameId) },
            { key: 'market', label: 'Market', sortable: false, render: market },
            {
              key: 'price',
              label: 'Best price',
              sortable: false,
              render: (r) => (
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <BookLogo bookId={r.book} size={15} withLabel />
                  <b className="tabular-nums text-ink">{fmtAmerican(r.price)}</b>
                </span>
              ),
            },
            {
              key: 'fair',
              label: 'Fair',
              numeric: true,
              sortable: false,
              info: "Pinnacle's price with its margin removed, at the lowest of three de-vig methods.",
              render: (r) => <span className="tabular-nums text-ink-secondary">{fmtAmerican(r.fairPrice)}</span>,
            },
            {
              key: 'ev',
              label: 'EV',
              numeric: true,
              sortable: false,
              info: "The fair probability times the book's decimal price, minus one.",
              render: (r) => (
                <b className={cx('text-body font-bold tabular-nums', r.ev > 0 ? 'text-good-ink' : 'text-bad-ink')}>
                  {r.ev > 0 ? '+' : '−'}
                  {fmtPct(Math.abs(r.ev))}
                </b>
              ),
            },
            { key: 'status', label: 'Status', sortable: false, render: (r) => <Status r={r} /> },
          ]}
        />
      </>
    );

  return (
    <Card
      title="Edge / EV"
      count={rows.length || undefined}
      scope="Every book against Pinnacle, margin removed"
      flush
      state={!ranking ? { kind: 'loading', lines: 5 } : { kind: 'ready' }}
      caption="Verified edges first, then the best offers that did not pass a check, with the reason. Left out: lines with no trusted sharp price, and anything over the 8% cap (a probable data error)."
    >
      {body}
    </Card>
  );
}
