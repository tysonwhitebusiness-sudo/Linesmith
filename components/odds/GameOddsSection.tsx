'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookLogo } from '../BookLogo';
import { Button, Card, DataTable, SegmentedToggle, Tabs, Tooltip } from '../ui';
import { BestPrice } from './BestPrice';
import { EdgeCard, EdgeDot, edgeMarketKeys } from './EdgeCard';
import { Depth } from './Depth';
import { Ladder } from './Ladder';
import { LineMovement } from './LineMovement';
import { MoneyCard } from './MoneyCard';
import { OpenNow } from './OpenNow';
import { PriceBoard } from './PriceBoard';
import { SharpPrices } from './SharpPrices';
import { LiveHeader, marketOf } from './LiveHeader';
import { LiveProvider } from './live';
import { useGameOdds } from './useOdds';
import { bookGroup } from '@/lib/odds/books/registry';
import { boardRows, consensusLine, pricedLines } from '@/lib/odds/section/board';
import { freshness } from '@/lib/odds/section/freshness';
import { fmtAgo, fmtAmerican, fmtLine, secondsSince } from '@/lib/odds/section/format';
import { pinnacleAt, pinnacleMain } from '@/lib/odds/section/sharp';
import { marketSpec, type MarketSpec, type OddsMarket } from '@/lib/odds/section/types';

const PERIOD_LABEL: Record<string, string> = { fg: 'Full game', '1h': '1st half', '2h': '2nd half', '1q': '1st quarter', '2q': '2nd quarter',
  '3q': '3rd quarter', '4q': '4th quarter', p1: '1st period', p2: '2nd period', p3: '3rd period', f5: 'First 5', f3: 'First 3', f7: 'First 7',
  i1: '1st inning', s1: '1st set' };
const PERIOD_ORDER = ['fg', '1h', '2h', '1q', '2q', '3q', '4q', 'p1', 'p2', 'p3', 'f5', 'f3', 'f7', 'i1', 's1'];

export interface GameTeams {
  home: { abbr: string };
  away: { abbr: string };
}

const specFor = (market: string): MarketSpec => (market === 'sp' ? marketSpec('sp') : market === 'ml' ? marketSpec('ml') : marketSpec('tot'));

/**
 * The game page's "Lines" (odds build P8, O3) — the approved mockup's game
 * surface: period tabs (only the periods priced) · market tabs (spread, total,
 * moneyline, each team total) · line stepper · Sharp prices · Best price ·
 * Every book / All lines · Line movement · Vegas board + Depth · Opening →
 * now. Sport-agnostic: it reads `/api/odds/game` and draws what is there.
 * `final` marks the prices as closed (no live dot); the full closing-line
 * card of O3 (`GameFinalOddsSection`) is not built yet.
 */
export function GameOddsSection({ sport, gameId, teams, final, userBook }: {
  sport: string;
  gameId: string;
  teams: GameTeams;
  final?: boolean;
  userBook?: string | null;
}) {
  const odds = useGameOdds(sport, gameId, { live: !final });
  const live = odds.live;
  const now = odds.data ? Date.parse(odds.data.asOf) : Date.now();
  const byKey = useMemo(() => new Map((odds.data?.markets ?? []).filter(m => m.cur.length).map(m => [m.key, m])), [odds.data]);
  const periods = PERIOD_ORDER.filter(p => [...byKey.keys()].some(k => k.startsWith(p + '_') && /_(sp|tot|ml)$/.test(k)));
  const [period, setPeriod] = useState<string | null>(null);
  const per = period && periods.includes(period) ? period : periods[0] ?? 'fg';
  const [kind, setKind] = useState<string>('sp');
  const edgeKeys = edgeMarketKeys(odds.data?.edges);
  const kinds = [
    { value: 'sp', label: 'Spread' }, { value: 'tot', label: 'Total' }, { value: 'ml', label: 'Moneyline' },
    ...(per === 'fg' ? [{ value: 'tt_home', label: `${teams.home.abbr} team total` }, { value: 'tt_away', label: `${teams.away.abbr} team total` }] : []),
  ].filter(k => byKey.has(`${per}_${k.value}`)).map(k => {
    const n = k.value === kind ? 0 : live.newIn(`${per}|${k.value}`);
    const dot = edgeKeys.has(`${per}_${k.value}`);
    return n || dot ? { ...k, label: <span className="inline-flex items-center gap-1.5">{k.label}{dot ? <EdgeDot /> : null}{n ? <span className="text-label font-semibold text-good-ink" data-tab-new>{n} new</span> : null}</span> } : k;
  });
  const mk = kinds.some(k => k.value === kind) ? kind : kinds[0]?.value ?? 'sp';
  const market = byKey.get(`${per}_${mk}`) ?? null;
  const spec = specFor(mk);
  const [lineBy, setLineBy] = useState<Record<string, number>>({});
  const [all, setAll] = useState<'line' | 'all'>('line');
  useEffect(() => { if (market) live.look(marketOf(market.key, true)); }, [market, live]);

  if (odds.loading && !odds.data) return <Card title="Lines" state={{ kind: 'loading', lines: 6 }} />;
  if (!market) {
    return <Card title="Lines" state={{ kind: 'empty', title: 'No game line yet', reason: odds.error ? 'The lines could not be read just now.' : 'No book has priced this matchup.' }} />;
  }
  const mkKey = market.key;
  const modal = spec.noLine ? null : consensusLine(market, spec).modal;
  const lines = spec.noLine ? [] : pricedLines(market, spec, spec.signed ? 6 : 8);
  const def = spec.noLine ? null : pinnacleMain(market, spec) ?? modal;
  const L = spec.noLine ? null : lineBy[mkKey] != null && lines.includes(lineBy[mkKey]) ? lineBy[mkKey] : def;
  const li = L == null ? -1 : lines.indexOf(L);
  const setL = (v: number) => setLineBy(s => ({ ...s, [mkKey]: v }));
  const rows = boardRows(market, spec, L, userBook);
  const fr = freshness(market, rows, now);
  const labels: [string, string] = spec.kind === 'sp'
    ? [`${teams.home.abbr} ${fmtLine(L, true)}`, `${teams.away.abbr} ${fmtLine(L == null ? null : -L, true)}`]
    : spec.noLine ? [teams.home.abbr, teams.away.abbr] : [`Over ${fmtLine(L)}`, `Under ${fmtLine(L)}`];
  return (
    <LiveProvider value={live}>
    <div className="space-y-3" data-show-recent={live.showRecent ? 'true' : undefined}>
      <LiveHeader beats={fr.heartbeat}>
        <span>· {fr.books} books · newest check {fmtAgo(secondsSince(fr.newestCheckAt, now))} ago</span>
        {fr.pulled.length ? <span className="text-bad-ink"> · {fr.pulled.length} pulled</span> : null}
        {final ? <span> · final: the prices as they closed</span> : null}
      </LiveHeader>
      {periods.length > 1 ? (
        <SegmentedToggle label="Period" size="sm" value={per} onChange={setPeriod}
          options={periods.map(p => ({ value: p, label: PERIOD_LABEL[p] ?? p }))} />
      ) : null}
      <Tabs label="Market" value={mk} onChange={setKind} items={kinds} />
      {spec.noLine ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-label font-semibold">Line</span>
          <Button size="sm" variant="secondary" aria-label="Lower line" isDisabled={li <= 0} onPress={() => setL(lines[li - 1])}>◀</Button>
          <b className="min-w-14 text-center tabular-nums">{fmtLine(L, spec.signed)}</b>
          <Button size="sm" variant="secondary" aria-label="Higher line" isDisabled={li < 0 || li >= lines.length - 1} onPress={() => setL(lines[li + 1])}>▶</Button>
          <span className="text-label text-ink-muted">{lines.length} lines priced · consensus {fmtLine(modal, spec.signed)} · Pinnacle {fmtLine(pinnacleMain(market, spec), spec.signed) || '—'}</span>
        </div>
      )}
      <SharpPrices market={market} spec={spec} line={L} sideLabels={labels} now={now} onGoToLine={setL} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <BestPrice marketKey={market.key} rows={rows} spec={spec} line={L} sideLabels={labels} userBook={userBook} now={now} />
        {final ? null : <EdgeCard edges={odds.data?.edges} view={odds.data?.edgeView} marketKey={market.key} spec={spec} line={L} sideLabels={labels}
          sharpAtLine={!!pinnacleAt(market, spec, L)} sharpMainLine={spec.noLine ? null : pinnacleMain(market, spec)}
          onGoToLine={setL} now={now} />}
      </div>
      <Card title="Every book" scope={spec.noLine ? 'Moneyline' : `at ${fmtLine(L, spec.signed)}`} flush>
        {spec.noLine ? null : (
          <div className="px-3 pt-2">
            <SegmentedToggle label="Board view" size="sm" value={all} onChange={setAll}
              options={[{ value: 'line', label: 'This line' }, { value: 'all', label: 'All lines' }]} />
          </div>
        )}
        {all === 'all' && !spec.noLine
          ? <Ladder market={market} spec={spec} span={spec.signed ? 6 : 8} line={L} sideLabels={labels} />
          : <PriceBoard market={market} spec={spec} line={L} rows={rows} sideLabels={labels} userBook={userBook} latency={odds.data?.latency ?? []} now={now} />}
      </Card>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <LineMovement market={market} spec={spec} sideLabels={labels} userBook={userBook} now={now} closed={final} />
        <MoneyCard money={odds.data?.money} view={{ kind: 'game', sport, marketKey: market.key, teams }} now={now} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {per === 'fg' ? <VegasBoard byKey={byKey} teams={teams} power={odds.data?.powerRatings ?? []} /> : null}
        <Depth market={market} spec={spec} line={L} now={now} />
      </div>
      <OpenNow market={market} spec={spec} now={now} />
    </div>
    </LiveProvider>
  );
}

interface VegasRow {
  book: string;
  sp: { open: number | null; now: number | null; flagged: boolean; reason: string | null };
  tot: { open: number | null; now: number | null };
  ml: { open: number | null; now: number | null };
}

/** Circa and the Nevada books, via VSiN: each book's OPEN against now, with the opener sanity flag (the mockup's `vegasCard`). */
function VegasBoard({ byKey, teams, power }: { byKey: Map<string, OddsMarket>; teams: GameTeams; power: { subject: string; data: Record<string, unknown> }[] }) {
  const sp = byKey.get('fg_sp'), tot = byKey.get('fg_tot'), ml = byKey.get('fg_ml');
  const nevada = new Set<string>();
  for (const m of [sp, tot, ml]) for (const q of m?.cur ?? []) if (q.book === 'circa' || bookGroup(q.book) === 'nevada') nevada.add(q.book);
  for (const m of [sp, tot, ml]) for (const k of Object.keys(m?.open ?? {})) if (k === 'circa' || bookGroup(k) === 'nevada') nevada.add(k);
  const mainOf = (m: OddsMarket | undefined, book: string, side: string) => m?.cur.find(q => q.book === book && q.side === side && q.main) ?? null;
  const rows: VegasRow[] = [...nevada].sort().map(book => ({
    book,
    sp: { open: sp?.open[book]?.line ?? null, now: mainOf(sp, book, 'home')?.line ?? null, flagged: !!(sp?.open[book]?.flagged || tot?.open[book]?.flagged),
      reason: sp?.open[book]?.reason ?? tot?.open[book]?.reason ?? null },
    tot: { open: tot?.open[book]?.line ?? null, now: mainOf(tot, book, 'over')?.line ?? null },
    ml: { open: ml?.open[book]?.priceA ?? null, now: mainOf(ml, book, 'home')?.price ?? null },
  }));
  const ratings = power.map(p => `${p.subject} ${String(p.data.PR ?? '—')}${p.data.Rank ? ` (#${String(p.data.Rank)})` : ''}`).join(' · ');
  return (
    <Card title="Vegas board" scope="Circa + Nevada books, via VSiN" dense
      state={rows.length ? { kind: 'ready' } : { kind: 'empty', title: 'No Nevada book prices this game', reason: 'VSiN carries Circa and the Nevada books for NFL, CFB, MLB, NBA and NHL.' }}
      caption={`Openers are VSiN's own OPEN row per book; a flagged opener failed the sanity check against the other books and is shown, never used as the opener.${ratings ? ` VSiN power ratings (research context): ${ratings}.` : ''}`}>
      <DataTable<VegasRow>
        caption="Circa and Nevada books, open and now"
        density="compact"
        rows={rows}
        rowKey={r => r.book}
        columns={[
          { key: 'b', label: 'Book', sortable: false, render: r => (
            <span className="inline-flex items-center gap-1"><BookLogo bookId={r.book} size={14} withLabel />
              {r.sp.flagged ? <Tooltip content={r.sp.reason ?? 'The opener looks wrong against every other book.'}><span className="text-warn-ink">⚠ check</span></Tooltip> : null}</span>
          ) },
          { key: 'so', label: `${teams.home.abbr} open`, numeric: true, sortable: false, render: r => fmtLine(r.sp.open, true) || '—' },
          { key: 'sn', label: 'now', numeric: true, sortable: false, render: r => <b>{fmtLine(r.sp.now, true) || '—'}</b> },
          { key: 'to', label: 'Total open', numeric: true, sortable: false, render: r => fmtLine(r.tot.open) || '—' },
          { key: 'tn', label: 'now', numeric: true, sortable: false, render: r => <b>{fmtLine(r.tot.now) || '—'}</b> },
          { key: 'mo', label: `${teams.home.abbr} ML open`, numeric: true, sortable: false, render: r => fmtAmerican(r.ml.open) },
          { key: 'mn', label: 'now', numeric: true, sortable: false, render: r => <b>{fmtAmerican(r.ml.now)}</b> },
        ]}
      />
    </Card>
  );
}
