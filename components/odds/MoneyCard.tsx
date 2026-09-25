'use client';

import { BookLogo } from '../BookLogo';
import { Sparkline } from '../charts/Sparkline';
import { useTeamColors } from '../useTeamColors';
import { Card, DataTable } from '../ui';
import { CardLiveDot } from './LiveHeader';
import { cadenceFor } from '@/lib/odds/section/cadence';
import { fmtAgo, fmtClock, fmtMoney, secondsSince } from '@/lib/odds/section/format';
import { dkMoneyTrend, gameMoneyRows, propMoneyRows, type MoneyPayload, type MoneyRow, type PropMoney } from '@/lib/odds/section/money';
import { teamColor } from '@/lib/sports/shared/teamColors';

export type MoneyView =
  | { kind: 'game'; sport: string; marketKey: string; teams: { home: { abbr: string }; away: { abbr: string } } }
  | { kind: 'prop'; marketKey: string; line: number | null };

/**
 * "Where the money is" (odds build P10, O-E of the approved mockup: `moneyGame`
 * and `moneyProp`). Every row names whose customers or which exchange it
 * describes; none of it speaks for all bettors and none of it is a total
 * wagered. Game lines: DraftKings customers, Circa customers, the
 * ScoresAndOdds consensus, Covers contest picks, Action Network's tracked
 * bet count and the exchanges, with DraftKings' money trend. Props: Sleeper's
 * pick counts, Kalshi's contracts, and the plain fact that no source
 * publishes money or bet share for a player prop. Rows come from
 * `lib/odds/section/money.ts`; this only draws them.
 */
export function MoneyCard({ money, view, now }: { money: MoneyPayload | null | undefined; view: MoneyView; now: number }) {
  return view.kind === 'game' ? <GameMoney money={money} view={view} now={now} /> : <PropMoneyCard money={money} view={view} now={now} />;
}

/** Two shares as one bar in the pair's colours, the labels under it. */
function ShareBar({ a, labels, colors }: { a: number; labels: [React.ReactNode, React.ReactNode]; colors: [string | null, string | null] }) {
  const pa = Math.max(0, Math.min(100, a));
  return (
    <div>
      <div className="mt-1 flex h-2 gap-0.5 overflow-hidden rounded-full bg-line-soft" role="img" aria-label={`${pa}% / ${100 - pa}%`}>
        <span className={colors[0] ? undefined : 'bg-cmp-a'} style={{ width: `${pa}%`, ...(colors[0] ? { background: colors[0] } : {}) }} />
        <span className={colors[1] ? undefined : 'bg-cmp-b'} style={{ width: `${100 - pa}%`, ...(colors[1] ? { background: colors[1] } : {}) }} />
      </div>
      <div className="mt-0.5 flex justify-between gap-2 text-label text-ink-muted"><span>{labels[0]}</span><span>{labels[1]}</span></div>
    </div>
  );
}

const PERIOD_NOTE = 'No splits source publishes period or team-total splits. Full-game spread, total and moneyline have them.';

function GameMoney({ money, view, now }: { money: MoneyPayload | null | undefined; view: Extract<MoneyView, { kind: 'game' }>; now: number }) {
  const index = useTeamColors(view.sport, null);
  const mk = view.marketKey.startsWith('fg_') ? view.marketKey.slice(3) : null;
  const full = mk === 'ml' || mk === 'sp' || mk === 'tot' ? mk : null;
  const tot = full === 'tot';
  const sides: [string, string] = tot ? ['over', 'under'] : ['home', 'away'];
  const labels: [string, string] = tot ? ['Over', 'Under'] : [view.teams.home.abbr, view.teams.away.abbr];
  const colors: [string | null, string | null] = tot ? [null, null]
    : [teamColor(index, { abbr: view.teams.home.abbr })?.primary ?? null, teamColor(index, { abbr: view.teams.away.abbr })?.primary ?? null];
  const rows = money && full ? gameMoneyRows(money, full, sides) : [];
  const trend = money && full ? dkMoneyTrend(money, full) : null;
  const newest = rows.map(r => ('at' in r ? r.at : null)).filter((v): v is string => !!v).sort().at(-1);
  const state = !full ? { kind: 'empty' as const, title: 'No splits for this market', reason: PERIOD_NOTE }
    : rows.length ? { kind: 'ready' as const }
      : { kind: 'empty' as const, title: 'No splits yet', reason: 'No source has published bets or money shares for this game yet.' };
  return (
    <Card
      title={<span className="inline-flex flex-wrap items-center gap-2">Where the money is {newest ? <CardLiveDot marketKeys={[]} checkedAt={newest} sources={[]} cadenceS={MONEY_CADENCE.game} /> : null}</span>}
      scope="each row names whose customers"
      state={state}
      caption="DraftKings, Circa and the rest each see only their own customers. A gap between money and bets is a fact about those customers, not a signal."
    >
      <div className="divide-y divide-line-soft" data-money-rows={rows.map(r => r.key).join(',')}>
        {rows.map(r => <GameRow key={r.key} r={r} labels={labels} colors={colors} now={now} />)}
      </div>
      {trend ? (
        <div className="mt-2 border-t border-line-soft pt-2">
          <div className="text-label text-ink-muted">
            DraftKings money on {labels[0]}: {trend.first.money}% ({fmtClock(trend.first.at, now)}) → <b className="text-ink">{trend.last.money}%</b> now
          </div>
          <Sparkline values={trend.points.map(p => p[1])} width={260} height={36} neutral label={`DraftKings money on ${labels[0]} over time`} className="mt-1 w-full" />
        </div>
      ) : null}
    </Card>
  );
}

function GameRow({ r, labels, colors, now }: { r: MoneyRow; labels: [string, string]; colors: [string | null, string | null]; now: number }) {
  const head = (note: string, at?: string) => (
    <div className="flex items-baseline justify-between gap-2">
      <b className="text-body-sm">{r.name}</b>
      <span className="text-label text-ink-muted">{note}{at ? ` · ${fmtAgo(secondsSince(at, now))} ago` : ''}</span>
    </div>
  );
  if (r.kind === 'split') {
    const bar = (a: number | null, b: number | null) => (a == null || b == null
      ? <div className="text-label text-ink-muted">not published</div>
      : <ShareBar a={a} colors={colors} labels={[<>{labels[0]} <b className="text-ink">{a}%</b></>, <><b className="text-ink">{b}%</b> {labels[1]}</>]} />);
    return (
      <div className="py-2" data-row={r.key}>
        {head(r.note, r.at)}
        <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><div className="text-label text-ink-muted">Money</div>{bar(r.a.money, r.b.money)}</div>
          <div><div className="text-label text-ink-muted">Bets</div>{bar(r.a.bets, r.b.bets)}</div>
        </div>
        {r.split ? (
          <p className="mt-1 text-body-sm" data-split>
            <span className="font-semibold text-warn-ink">Money and bets split:</span> {labels[r.split.side]} draws {r.split.pts} pts more of the money than of the bets
          </p>
        ) : null}
      </div>
    );
  }
  if (r.kind === 'picks') {
    return (
      <div className="py-2" data-row={r.key}>
        {head(`${r.note}${r.picks != null ? ` · ${r.picks.toLocaleString('en-US')} picks` : ''}`, r.at)}
        <ShareBar a={r.a} colors={colors} labels={[<>{labels[0]} <b className="text-ink">{r.a}%</b></>, <><b className="text-ink">{r.b}%</b> {labels[1]}</>]} />
      </div>
    );
  }
  if (r.kind === 'count') {
    return (
      <p className="py-2 text-body-sm" data-row={r.key}>
        <b>{r.name}</b> <span className="text-ink-muted">· {r.count.toLocaleString('en-US')} {r.note}</span>
      </p>
    );
  }
  return (
    <div className="py-2 text-body-sm" data-row={r.key}>
      <b>{r.name}</b> <span className="text-ink-muted">· {r.note}</span>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {r.kalshi ? (
          <span className="inline-flex items-center gap-1.5"><BookLogo bookId="kalshi" size={14} /> Kalshi moneyline <b>{fmtMoney(r.kalshi.volume24h)}</b> 24h · {fmtMoney(r.kalshi.openInterest)} open interest</span>
        ) : null}
        {r.polymarket ? (
          <span className="inline-flex items-center gap-1.5"><BookLogo bookId="polymarket" size={14} /> Polymarket <b>{fmtMoney(r.polymarket.volume24h)}</b> 24h · {fmtMoney(r.polymarket.liquidity)} liquidity</span>
        ) : null}
      </div>
    </div>
  );
}

function PropMoneyCard({ money, view, now }: { money: MoneyPayload | null | undefined; view: Extract<MoneyView, { kind: 'prop' }>; now: number }) {
  const pm: PropMoney = money ? propMoneyRows(money, view.marketKey, view.line) : { sleeper: null, kalshi: [] };
  const sl = pm.sleeper;
  return (
    <Card
      title={<span className="inline-flex flex-wrap items-center gap-2">Where the money is {sl ? <CardLiveDot marketKeys={[]} checkedAt={sl.at} sources={[]} cadenceS={MONEY_CADENCE.prop} /> : null}</span>}
      scope="props: pick counts + exchange volume"
    >
      <div className="divide-y divide-line-soft">
        {sl ? (
          <div className="pb-2" data-row="sleeper">
            <div className="flex items-baseline justify-between gap-2">
              <b className="inline-flex items-center gap-1.5 text-body-sm"><BookLogo bookId="sleeper" size={14} /> Sleeper pick counts at {sl.line}</b>
              <span className="text-label text-ink-muted">{fmtAgo(secondsSince(sl.at, now))} ago</span>
            </div>
            <div className="mt-1 flex h-2 gap-0.5 overflow-hidden rounded-full bg-line-soft" role="img" aria-label={`Over ${sl.pctOver}%, under ${100 - sl.pctOver}%`}>
              <span className="bg-good" style={{ width: `${sl.pctOver}%` }} />
              <span className="bg-line" style={{ width: `${100 - sl.pctOver}%` }} />
            </div>
            <div className="mt-0.5 flex justify-between text-label text-ink-muted">
              <span>Over <b className="text-ink">{sl.over.toLocaleString('en-US')}</b> ({sl.pctOver}%)</span>
              <span><b className="text-ink">{sl.under.toLocaleString('en-US')}</b> ({100 - sl.pctOver}%) Under</span>
            </div>
            <div className="text-label text-ink-muted">Entries in Sleeper&apos;s pick&apos;em: counts, not money</div>
          </div>
        ) : <p className="pb-2 text-body-sm text-ink-muted" data-row="sleeper-none">Sleeper pick counts: no data available for this market at this line.</p>}
        {pm.kalshi.length ? (
          <div className="py-2" data-row="kalshi">
            <b className="inline-flex items-center gap-1.5 text-body-sm"><BookLogo bookId="kalshi" size={14} /> Kalshi contracts</b>{' '}
            <span className="text-label text-ink-muted">traded on Kalshi&apos;s own markets</span>
            <DataTable<PropMoney['kalshi'][number]>
              caption="Kalshi contracts"
              density="compact"
              rows={pm.kalshi.slice(0, 8)}
              rowKey={k => String(k.point)}
              columns={[
                { key: 'contract', label: 'Contract', sortable: false },
                { key: 'yes', label: 'Yes bid–ask', numeric: true, sortable: false,
                  render: k => (k.bid != null && k.ask != null ? `${Math.round(k.bid * 100)}–${Math.round(k.ask * 100)}¢` : '—') },
                { key: 'vol', label: '24h volume', numeric: true, sortable: false, render: k => fmtMoney(k.volume24h) },
                { key: 'oi', label: 'Open interest', numeric: true, sortable: false, render: k => fmtMoney(k.openInterest) },
              ]}
            />
          </div>
        ) : <p className="py-2 text-body-sm text-ink-muted" data-row="kalshi-none">Kalshi volume: no Kalshi contract for this market.</p>}
        <p className="pt-2 text-body-sm" data-row="no-share">
          <b>Money % / bets %</b> <span className="text-ink-muted">· <b className="text-ink">No data available.</b> No source publishes money or bet share for player props.</span>
        </p>
      </div>
    </Card>
  );
}

/** The cadence each card's dot is measured against (P9): DK Network splits and Sleeper pick counts. */
const MONEY_CADENCE = { game: cadenceFor('dknetwork'), prop: cadenceFor('sleeper', 'pick_counts') };
