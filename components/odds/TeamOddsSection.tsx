'use client';

import { useMemo } from 'react';
import { BookLogo } from '../BookLogo';
import { Card, DataTable } from '../ui';
import { GameLineCompact, type TeamsRef } from './GameLineCompact';
import { LineMovement } from './LineMovement';
import { useGameCloses, useGameOdds } from './useOdds';
import { bestPrice, boardRows, consensusLine } from '@/lib/odds/section/board';
import { fmtAmerican, fmtLine, fmtPct } from '@/lib/odds/section/format';
import { pinnacleAt } from '@/lib/odds/section/sharp';
import { marketSpec } from '@/lib/odds/section/types';

/** A finished game of the team's, for "Against the closing number". */
export interface TeamPastGame {
  gameId: string;
  start: string;
  date: string;
  opp: string;
  home: boolean;
  us: number;
  them: number;
}

interface CloseRow extends TeamPastGame {
  spread: number | null;     // the team's own closing spread
  total: number | null;
  ats: 'won' | 'lost' | 'push' | null;
  ou: 'over' | 'under' | 'push' | null;
}

/**
 * The team page's odds (odds build P8, O3; the mockup's team surface): the next
 * game's line, the team's own total, the spread's movement, and the team's
 * record against the closing number in its recent finished games (closes from
 * `/api/odds/closes`: the bridge's history, else the paid feeds' last pre-start
 * line; a close the app does not hold reads "—").
 * Sport-agnostic: `side` says which side of the next game the team is.
 */
export function TeamOddsSection({ sport, gameId, teams, side, past }: {
  sport: string;
  gameId: string;
  teams: TeamsRef;
  side: 'home' | 'away';
  past: TeamPastGame[];
}) {
  const odds = useGameOdds(sport, gameId);
  const closes = useGameCloses(sport, past);
  const now = odds.data ? Date.parse(odds.data.asOf) : Date.now();
  const by = useMemo(() => new Map((odds.data?.markets ?? []).map(m => [m.key, m])), [odds.data]);
  const me = side === 'home' ? teams.home.abbr : teams.away.abbr;
  const tt = by.get(`tt_${side}`) ?? null;
  const tspec = marketSpec('tot');
  const L = tt ? consensusLine(tt, tspec).modal : null;
  const rows = tt ? boardRows(tt, tspec, L) : [];
  const b0 = bestPrice(rows, 0), b1 = bestPrice(rows, 1);
  const pin = tt ? pinnacleAt(tt, tspec, L) : null;
  const sp = by.get('fg_sp');
  const spec = marketSpec('sp');
  const closeRows: CloseRow[] = past.map(g => {
    const c = closes.data?.closes[g.gameId];
    // The close is stored on the home side; the team's own number flips when it was away.
    const spread = c?.spread == null ? null : g.home ? c.spread : -c.spread;
    const m = g.us - g.them;
    const pts = g.us + g.them;
    return {
      ...g, spread, total: c?.total ?? null,
      ats: spread == null ? null : m + spread > 0 ? 'won' : m + spread < 0 ? 'lost' : 'push',
      ou: c?.total == null ? null : pts > c.total ? 'over' : pts < c.total ? 'under' : 'push',
    };
  });
  const tally = (xs: (string | null)[], a: string, b: string) => {
    const n = (k: string) => xs.filter(x => x === k).length;
    return `${n(a)}–${n(b)}${n('push') ? `–${n('push')}` : ''}`;
  };
  const withClose = closeRows.filter(r => r.spread != null || r.total != null);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <GameLineCompact sport={sport} gameId={gameId} teams={teams} title="Next game's line" odds={odds} />
        <Card title={`${me} team total`} scope={tt ? `${new Set(tt.cur.map(q => q.book)).size} books` : undefined} dense
          state={odds.loading && !odds.data ? { kind: 'loading', lines: 3 } : tt && L != null ? { kind: 'ready' } : { kind: 'empty', title: 'No team total yet', reason: "No book has priced this team's total." }}>
          <div className="grid grid-cols-2 gap-3">
            {([[b0, 'over'], [b1, 'under']] as const).map(([b, s]) => (
              <div key={s}>
                <p className="text-overline uppercase text-ink-muted">Best {s} {fmtLine(L)}</p>
                <p className="text-heading tabular-nums">{fmtAmerican(b?.quote.price)}</p>
                {b ? <BookLogo bookId={b.book} size={14} withLabel /> : null}
              </div>
            ))}
          </div>
          <p className="mt-2 text-body-sm text-ink-secondary">
            {pin ? `Pinnacle ${fmtAmerican(pin.a.price)}/${fmtAmerican(pin.b.price)} · fair over ${fmtPct(pin.fairA)}` : `No Pinnacle price at ${fmtLine(L)}`} · consensus {fmtLine(L)}
          </p>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {sp && Object.keys(sp.hist).length
          ? <LineMovement market={sp} spec={spec} sideLabels={[teams.home.abbr, teams.away.abbr]} now={now} />
          : <Card title="Line movement" dense state={{ kind: 'empty', title: 'No spread movement yet', reason: "No book's spread has moved since prices were first recorded." }} />}
        <Card title="Against the closing number" scope="recent finished games" flush
          state={closes.loading && !closes.data ? { kind: 'loading', lines: 4 } : past.length ? { kind: 'ready' } : { kind: 'empty', title: 'No finished games yet', reason: 'This season has no results to measure.' }}
          caption={withClose.length
            ? `${tally(closeRows.map(r => r.ats), 'won', 'lost')} ATS · ${tally(closeRows.map(r => r.ou), 'over', 'under')} O/U against the consensus close (the line most books closed at). A "—" is a close the app does not hold: spreads are kept per book from Sep 25, totals from August. Research, not a pick.`
            : 'No closes held for these games: spreads are kept per book from Sep 25, totals from August.'}>
          <DataTable<CloseRow>
            caption="Results against the closing spread and total"
            density="compact"
            rows={closeRows}
            rowKey={r => r.gameId}
            columns={[
              { key: 'g', label: 'Game', sortable: false, render: r => (
                <span><b>{r.home ? 'vs' : '@'} {r.opp}</b> <span className="text-label text-ink-muted">{r.date}</span>
                  <span className="block text-label">{r.us > r.them ? 'W' : r.us < r.them ? 'L' : 'T'} {r.us}–{r.them}</span></span>
              ) },
              { key: 'c', label: 'Close', sortable: false, render: r => (r.spread == null ? '—' : `${me} ${fmtLine(r.spread, true)}`) },
              { key: 'a', label: 'ATS', sortable: false, ink: r => (r.ats === 'won' ? 'good' : r.ats === 'lost' ? 'bad' : null),
                render: r => (r.ats == null ? '—' : r.ats === 'push' ? 'push' : `${r.ats} ATS`) },
              { key: 't', label: 'Total', sortable: false, render: r => (r.total == null ? '—' : `${fmtLine(r.total)} · ${r.ou} (${r.us + r.them})`) },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
