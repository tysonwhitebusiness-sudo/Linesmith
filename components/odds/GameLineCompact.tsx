'use client';

import { BookLogo } from '../BookLogo';
import { Card, DataTable, LiveDot } from '../ui';
import { useGameOdds } from './useOdds';
import { bestPrice, boardRows, consensusLine } from '@/lib/odds/section/board';
import { fmtAmerican, fmtLine, fmtPct } from '@/lib/odds/section/format';
import { pinnacleAt } from '@/lib/odds/section/sharp';
import { marketSpec, type MarketSpec, type OddsMarket } from '@/lib/odds/section/types';

export interface TeamsRef {
  home: { abbr: string };
  away: { abbr: string };
}

interface Row {
  key: string;
  name: string;
  market: OddsMarket;
  spec: MarketSpec;
}

/**
 * The game line, compact (the player and team pages; the mockup's
 * `gameLineCompact`, and the P1 fix: it reads the same rows the game page
 * does). Best price per side across every book, and Pinnacle's two prices and
 * fair %, for the full-game spread, total and moneyline.
 */
export function GameLineCompact({ sport, gameId, teams, title = 'Game line', href }: {
  sport: string;
  gameId: string;
  teams: TeamsRef;
  title?: string;
  href?: string;
}) {
  const odds = useGameOdds(sport, gameId);
  const now = odds.data ? Date.parse(odds.data.asOf) : Date.now();
  const by = new Map((odds.data?.markets ?? []).map(m => [m.key, m]));
  const rows: Row[] = ([['fg_sp', 'Spread', 'sp'], ['fg_tot', 'Total', 'tot'], ['fg_ml', 'Moneyline', 'ml']] as const)
    .filter(([k]) => by.has(k)).map(([k, name, kind]) => ({ key: k, name, market: by.get(k)!, spec: marketSpec(kind) }));
  const checks = rows.flatMap(r => r.market.cur.map(q => q.checkedAt)).filter((v): v is string => !!v).sort();
  const line = (r: Row) => (r.spec.noLine ? null : consensusLine(r.market, r.spec).modal);
  return (
    <Card
      title={<span className="inline-flex flex-wrap items-center gap-2">{title} <LiveDot checkedAt={checks[checks.length - 1]} cadenceS={70} now={now} /></span>}
      scope={`${teams.away.abbr} @ ${teams.home.abbr}`}
      dense
      state={odds.loading && !odds.data ? { kind: 'loading', lines: 3 } : rows.length ? { kind: 'ready' } : { kind: 'empty', title: 'No game line yet', reason: 'No book has priced this matchup.' }}
      caption={href ? <a className="text-body-sm text-ink underline-offset-2 hover:underline" href={href}>All game lines, movement and splits →</a> : undefined}
    >
      <DataTable<Row>
        caption="Best price per side and Pinnacle"
        density="compact"
        rows={rows}
        rowKey={r => r.key}
        columns={[
          { key: 'm', label: 'Market', sortable: false, render: r => <span><b>{r.name}</b><span className="block text-label text-ink-muted">{new Set(r.market.cur.map(q => q.book)).size} books</span></span> },
          {
            key: 'best', label: 'Best price', sortable: false,
            render: r => {
              const L = line(r);
              const br = boardRows(r.market, r.spec, L);
              const sides = r.spec.kind === 'tot' ? ['O', 'U'] : [teams.home.abbr, teams.away.abbr];
              return (
                <span className="flex flex-col gap-0.5">
                  {([0, 1] as const).map(i => {
                    const b = bestPrice(br, i);
                    const ln = r.spec.noLine ? '' : r.spec.kind === 'tot' ? fmtLine(L) : fmtLine(i ? (L == null ? null : -L) : L, true);
                    return <span key={i} className="inline-flex items-center gap-1.5">{sides[i]} {ln} <b className="tabular-nums">{fmtAmerican(b?.quote.price)}</b>{b ? <BookLogo bookId={b.book} size={13} /> : null}</span>;
                  })}
                </span>
              );
            },
          },
          {
            key: 'pin', label: 'Pinnacle', sortable: false,
            render: r => {
              const p = pinnacleAt(r.market, r.spec, line(r));
              return p ? <span className="tabular-nums">{fmtAmerican(p.a.price)} / {fmtAmerican(p.b.price)}<span className="block text-label text-ink-muted">fair {fmtPct(p.fairA)}</span></span> : <span className="text-ink-faint">—</span>;
            },
          },
        ]}
      />
    </Card>
  );
}
