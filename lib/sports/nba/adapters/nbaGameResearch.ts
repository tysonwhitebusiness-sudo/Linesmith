/**
 * The NBA game page — R8.4a, `toGameResearchData`, imported by
 * `GameResearchPage.tsx`. Sections follow G2 `game-hoops-hockey.js`: game flow
 * (win probability, the lead tracker, scoring runs), the shot chart, team
 * stats, box score, lines and props with the season series, play-by-play; before
 * the tip, the shared Matchup and Players sections, injuries and lines; live,
 * "Right now" first.
 *
 * Pure: no fetching, no JSX.
 */

import type { NbaGameResearchPayload, NbaPropResult } from '@/lib/sports/nba/gameResearch';
import type { CourtPlay } from '@/lib/sports/espn/summaryParsers';
import { buildGameHero, gameStates, resolveState, stateNote } from '@/lib/sports/shared/gameResearch';
import type { GameResearchData, GameState } from '@/lib/sports/shared/gameResearchShapes';
import type { ResearchCard, ResearchColumn, ResearchSection, ResearchTableRow } from '@/lib/sports/shared/playerResearchShapes';
import { inGameOddsCards, matchupSection, propHistorySection, propsTrackerCard } from '@/lib/sports/shared/gameResearchSections';
import { espnHeadshot } from '@/lib/sports/shared/identity';

type Payload = NbaGameResearchPayload;
type Side = 'away' | 'home';

export const NBA_MARKET_LABELS: Record<string, string> = {
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
  steals: 'Steals',
  blocks: 'Blocks',
  turnovers: 'Turnovers',
  threes: 'Threes made',
  'three-pointers': 'Threes made',
  'points-rebounds-assists': 'Pts + reb + ast',
  'points-rebounds': 'Pts + reb',
  'points-assists': 'Pts + ast',
  'rebounds-assists': 'Reb + ast',
  'steals-blocks': 'Steals + blocks',
};

const am = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));
const signedLine = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));
export const quarter = (p: number | null) => (p == null ? '' : p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`);
const lineOf = (p: NbaPropResult) => p.line ?? 0.5;

export function toGameResearchData(input: { payload: Payload; requestedState?: string | null }): GameResearchData {
  const { payload } = input;
  const state = resolveState(payload, input.requestedState);
  const chips = nbaLineChips(payload, state);
  const wpNow = payload.nba.winProbability.at(-1);
  if (state === 'live' && wpNow) chips.unshift({ label: `Win probability ${payload.home.abbr} ${Math.round(wpNow.home * 100)}%` });
  const atTip = () =>
    [nbaMatchupSection(payload, state), nbaPlayersSection(payload, state)]
      .filter((s): s is ResearchSection => s !== null)
      .map((s) => ({ ...s, id: `pre-${s.id}`, title: `${s.title} · at tip-off` }));
  const sections = (
    state === 'live'
      ? [nbaNowSection(payload), nbaFlowSection(payload), nbaShotsSection(payload), nbaTeamStatsSection(payload), nbaBoxSection(payload), nbaPlaysSection(payload), ...atTip()]
      : state === 'pre' || state === 'postponed'
        ? [nbaMatchupSection(payload, state), nbaPlayersSection(payload, state), payload.state === 'pre' || payload.state === 'postponed' ? nbaInjuriesSection(payload) : null, nbaLinesSection(payload, state)]
        : [nbaFlowSection(payload), nbaShotsSection(payload), nbaTeamStatsSection(payload), nbaBoxSection(payload), nbaLinesSection(payload, state), nbaPlaysSection(payload), ...atTip()]
  ).filter((s): s is ResearchSection => s !== null);
  return { state, states: gameStates(payload.state), hero: buildGameHero(payload, state, chips), stateNote: stateNote(state, payload.state), sections, sources: payload.sources };
}

const sideOfTeam = (payload: Payload, teamId: string | null): Side | null => (teamId === payload.home.id ? 'home' : teamId === payload.away.id ? 'away' : null);
const abbrOf = (payload: Payload, teamId: string | null) => (teamId === payload.home.id ? payload.home.abbr : teamId === payload.away.id ? payload.away.abbr : '');

export function nbaLineChips(payload: Payload, state: GameState): GameResearchData['hero']['chips'] {
  const l = payload.nba.lines;
  if (!l) return [];
  const out: GameResearchData['hero']['chips'] = [];
  const final = state === 'final' && payload.away.score != null && payload.home.score != null;
  const a = payload.away.score ?? 0;
  const h = payload.home.score ?? 0;
  if (l.moneyline.away.close != null || l.moneyline.home.close != null) out.push({ label: `ML ${payload.away.abbr} ${am(l.moneyline.away.close)} · ${payload.home.abbr} ${am(l.moneyline.home.close)}` });
  const spread = l.spread.away.line.close;
  if (spread != null) {
    const margin = a - h + spread;
    const who = `${payload.away.abbr} ${signedLine(spread)}`;
    out.push({ label: final ? `${who} ${margin > 0 ? 'covered' : margin < 0 ? 'did not cover' : 'push'}` : who });
  }
  const total = l.total.over.line.close;
  if (total != null) out.push({ label: final ? `Total ${total} · ${a + h > total ? 'over' : a + h < total ? 'under' : 'push'} (${a + h})` : `Total ${total}` });
  return out;
}

function nbaFlowSection(payload: Payload): ResearchSection | null {
  const n = payload.nba;
  const rows: ResearchCard[][] = [];
  const wp = n.winProbability;
  if (wp.length >= 2) {
    rows.push([
      {
        kind: 'series',
        key: 'wp',
        title: `${payload.home.abbr} win probability`,
        scope: `${wp.length} plays · x-axis is quarters`,
        values: wp.map((p) => Math.round(p.home * 1000) / 10),
        xLabels: wp.map((p, i) => (i === 0 || p.period !== wp[i - 1].period ? quarter(p.period) : '')),
        reference: { value: 50, label: 'even' },
        zeroBased: true,
        min: 0,
        max: 100,
        decimals: 0,
        unit: '%',
        tips: wp.map((p) => [`${payload.home.abbr} ${(p.home * 100).toFixed(0)}%`, `${quarter(p.period)} ${p.clock ?? ''} · ${payload.away.abbr} ${p.awayScore ?? '—'}–${p.homeScore ?? '—'} ${payload.home.abbr}`, p.text ?? '']),
        caption: `Above 50 favours ${payload.home.name}, below it ${payload.away.name}. ESPN win probability.`,
      },
    ]);
  }
  const lead = n.lead;
  if (lead.length >= 2) {
    let changes = 0;
    for (let i = 1; i < lead.length; i++) if (Math.sign(lead[i].margin) !== 0 && Math.sign(lead[i].margin) === -Math.sign(lead[i - 1].margin)) changes++;
    const most = (side: Side) => Math.max(0, ...lead.map((p) => (side === 'home' ? p.margin : -p.margin)));
    const tracker: ResearchCard = {
      kind: 'series',
      key: 'lead',
      title: 'Lead tracker',
      scope: `${changes} lead change${changes === 1 ? '' : 's'} · largest leads ${payload.away.abbr} ${most('away')}, ${payload.home.abbr} ${most('home')}`,
      values: lead.map((p) => p.margin),
      xLabels: lead.map((p, i) => (i === 0 || p.period !== lead[i - 1].period ? quarter(p.period) : '')),
      reference: { value: 0, label: 'tied' },
      zeroBased: false,
      decimals: 0,
      unit: '',
      tips: lead.map((p) => [p.margin === 0 ? 'Tied' : `${p.margin > 0 ? payload.home.abbr : payload.away.abbr} by ${Math.abs(p.margin)}`, `${quarter(p.period)} ${p.clock ?? ''}`]),
      caption: `Above zero ${payload.home.abbr} leads, below it ${payload.away.abbr}. After every scoring play.`,
    };
    const runs: ResearchCard = {
      kind: 'table',
      key: 'runs',
      title: 'Scoring runs',
      scope: '8 or more unanswered points',
      labelHeader: 'When',
      fixedOrder: true,
      emptyText: 'No run of 8 or more',
      columns: [
        { key: 'team', label: 'Team', decimals: 0 },
        { key: 'run', label: 'Run', decimals: 0 },
      ],
      rows: [...n.runs].sort((x, y) => y.points - x.points).slice(0, 8).map((r) => ({ key: r.startPlayId, label: `${quarter(r.period)} ${r.clock ?? ''}`, values: { team: abbrOf(payload, r.teamId), run: `${r.points}-0` } })),
    };
    rows.push([tracker, runs]);
  }
  if (!rows.length) return null;
  return { id: 'flow', navLabel: 'Game flow', title: 'Game flow', rows, state: { kind: 'ready' } };
}

function nbaShotsSection(payload: Payload): ResearchSection | null {
  const shots = payload.nba.plays
    .map((p) => ({ p, side: sideOfTeam(payload, p.teamId) }))
    .filter((x): x is { p: CourtPlay; side: Side } => x.side != null && x.p.shooting && x.p.x != null && x.p.y != null && !/free throw/i.test(x.p.type ?? x.p.text ?? ''));
  if (!shots.length) return null;
  const made = (p: CourtPlay) => p.scoring;
  const count = (side: Side) => shots.filter((s) => s.side === side).length;
  const scatter: ResearchCard = {
    kind: 'scatter',
    key: 'shot-chart',
    title: 'Where the shots came from',
    scope: `${shots.length} located field goal attempts`,
    surface: 'court',
    points: shots.map((s) => [s.side, s.p.x!, s.p.y!] as [string, number, number]),
    emphasis: shots.map((s) => made(s.p)),
    tips: shots.map((s) => [`${quarter(s.p.period)} ${s.p.clock ?? ''} · ${abbrOf(payload, s.p.teamId)}`, s.p.text ?? '']),
    groups: [
      { key: 'away', label: payload.away.abbr, count: count('away') },
      { key: 'home', label: payload.home.abbr, count: count('home') },
    ],
    defaultVisible: ['away', 'home'],
    caption: 'Both teams on one half court, rim at the top. Filled is a make.',
  };
  const summary = (side: Side) => {
    const mine = shots.filter((s) => s.side === side).map((s) => s.p);
    const threes = mine.filter((p) => (p.pointsAttempted ?? 2) === 3);
    const paint = mine.filter((p) => Math.hypot((p.x ?? 25) - 25, p.y ?? 0) <= 8);
    const pct = (xs: CourtPlay[]) => (xs.length ? `${((100 * xs.filter(made).length) / xs.length).toFixed(0)}% (${xs.filter(made).length}/${xs.length})` : '—');
    return { all: pct(mine), threes: pct(threes), paint: pct(paint) };
  };
  const a = summary('away');
  const h = summary('home');
  const table: ResearchCard = {
    kind: 'table',
    key: 'shot-summary',
    title: 'Shooting by zone',
    scope: 'from the located attempts',
    labelHeader: '',
    fixedOrder: true,
    compare: 'row',
    columns: [
      { key: 'away', label: payload.away.abbr, decimals: 0, imageUrl: payload.away.logoUrl, bar: true },
      { key: 'home', label: payload.home.abbr, decimals: 0, imageUrl: payload.home.logoUrl, bar: true },
    ],
    rows: [
      { key: 'all', label: 'All located', values: { away: a.all, home: h.all } },
      { key: 'paint', label: 'Within 8 ft', values: { away: a.paint, home: h.paint } },
      { key: 'threes', label: 'Threes', values: { away: a.threes, home: h.threes } },
    ],
  };
  return { id: 'shots', navLabel: 'Shot chart', title: 'Shot chart', sub: 'every located field goal attempt', rows: [[scatter, table]], state: { kind: 'ready' } };
}

function nbaTeamStatsSection(payload: Payload): ResearchSection | null {
  const stats = payload.nba.teamStats.filter((r) => !/technical|flagrant|teamTurnovers|leadPercentage/i.test(r.key));
  if (!stats.length) return null;
  const columns: ResearchColumn[] = [
    { key: 'away', label: payload.away.abbr, decimals: 0, imageUrl: payload.away.logoUrl, bar: true },
    { key: 'home', label: payload.home.abbr, decimals: 0, imageUrl: payload.home.logoUrl, bar: true },
  ];
  return {
    id: 'teams',
    navLabel: 'Team stats',
    title: 'Team stats',
    rows: [[{ kind: 'table', key: 'team-stats', title: 'Team stats', labelHeader: 'Stat', compare: 'row' as const, columns, rows: stats.map((r) => ({ key: r.key, label: r.label, values: { away: r.away, home: r.home } })), fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

function nbaBoxSection(payload: Payload): ResearchSection | null {
  const box = payload.nba.box;
  if (!box.length) return null;
  const views = (['away', 'home'] as const).flatMap((side) => {
    const g = box.find((t) => t.teamId === payload[side].id)?.groups[0];
    if (!g) return [];
    // ESPN's own labels, so the headline stat is found by name (R9c).
    const columns: ResearchColumn[] = g.labels.map((l, i) => ({
      key: `c${i}`,
      label: l,
      decimals: 0,
      ...(l === 'PTS' ? { bar: true as const, leader: 'high' as const } : {}),
    }));
    const rows: ResearchTableRow[] = g.athletes
      .filter((a) => a.stats.length)
      .map((a) => ({ key: `${side}-${a.id}`, label: a.name, href: `/nba/player/${a.id}`, imageUrl: espnHeadshot('nba', a.id), imageKind: 'player' as const, values: Object.fromEntries(a.stats.map((v, i) => [`c${i}`, v])) }));
    return [{ key: side, label: payload[side].abbr, labelHeader: 'Player', columns, rows }];
  });
  if (!views.length) return null;
  return {
    id: 'box',
    navLabel: 'Box score',
    title: 'Box score',
    rows: [[{ kind: 'table', key: 'box', title: 'Box score', scope: 'starters first', labelHeader: 'Player', columns: views[0].columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

function nbaLinesSection(payload: Payload, state: GameState): ResearchSection {
  const n = payload.nba;
  const final = state === 'final';
  const l = n.lines;
  const priced = (line: number | null, odds: number | null) => (line == null && odds == null ? '—' : `${line != null ? `${signedLine(line)} ` : ''}${am(odds)}`);
  const lineRows: ResearchTableRow[] = l
    ? [
        { key: 'ml-away', label: `Moneyline · ${payload.away.abbr}`, values: { open: am(l.moneyline.away.open), close: am(l.moneyline.away.close) } },
        { key: 'ml-home', label: `Moneyline · ${payload.home.abbr}`, values: { open: am(l.moneyline.home.open), close: am(l.moneyline.home.close) } },
        { key: 'sp-away', label: `Spread · ${payload.away.abbr}`, values: { open: priced(l.spread.away.line.open, l.spread.away.odds.open), close: priced(l.spread.away.line.close, l.spread.away.odds.close) } },
        { key: 'sp-home', label: `Spread · ${payload.home.abbr}`, values: { open: priced(l.spread.home.line.open, l.spread.home.odds.open), close: priced(l.spread.home.line.close, l.spread.home.odds.close) } },
        { key: 'to-over', label: 'Total · over', values: { open: priced(l.total.over.line.open, l.total.over.odds.open).replace(/^\+/, ''), close: priced(l.total.over.line.close, l.total.over.odds.close).replace(/^\+/, '') } },
        { key: 'to-under', label: 'Total · under', values: { open: priced(l.total.under.line.open, l.total.under.odds.open).replace(/^\+/, ''), close: priced(l.total.under.line.close, l.total.under.odds.close).replace(/^\+/, '') } },
      ].filter((r) => r.values.open !== '—' || r.values.close !== '—')
    : [];
  const lines: ResearchCard = {
    kind: 'table',
    key: 'game-lines',
    title: 'Game lines',
    scope: 'open to the last quote before the tip',
    labelHeader: 'Market',
    fixedOrder: true,
    emptyText: 'No game lines held for this game',
    columns: [
      { key: 'open', label: 'Open', decimals: 0 },
      { key: 'close', label: 'Close', decimals: 0 },
    ],
    rows: lineRows,
    caption: `${l?.provider ?? 'DraftKings'} through ESPN.`,
  };
  const regular = n.seasonSeries.find((s) => s.type === 'season') ?? n.seasonSeries[0];
  const series: ResearchCard = {
    kind: 'table',
    key: 'season-series',
    title: regular?.title ?? 'Season series',
    scope: regular?.summary ?? undefined,
    labelHeader: 'Date',
    fixedOrder: true,
    emptyText: 'No season series for these teams',
    columns: [
      { key: 'at', label: 'At', decimals: 0 },
      { key: 'score', label: 'Score', decimals: 0 },
    ],
    rows: (regular?.games ?? []).map((g) => ({
      key: g.id,
      label: g.date ? new Date(g.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }) : '—',
      href: g.id !== payload.gameId ? `/nba/game/${g.id}` : null,
      highlight: g.id === payload.gameId,
      values: { at: g.home.abbr, score: g.completed ? `${g.away.abbr} ${g.away.score ?? '—'} · ${g.home.abbr} ${g.home.score ?? '—'}` : 'To play' },
    })),
  };
  const props = n.props.filter((p) => p.books >= 2 && (!final || p.result != null));
  const propsCard: ResearchCard = {
    kind: 'table',
    key: 'props',
    title: final ? 'Props against results' : 'Player props',
    scope: final ? 'main line at the tip against the box score' : 'main line, both sides quoted',
    labelHeader: 'Player',
    emptyText: 'No player props held for this game',
    sortKey: final ? undefined : 'books',
    columns: [
      { key: 'market', label: 'Market', decimals: 0, text: true },
      { key: 'line', label: 'Line', decimals: 1 },
      { key: 'over', label: 'Best over', decimals: 0 },
      { key: 'under', label: 'Best under', decimals: 0 },
      { key: 'books', label: 'Books', decimals: 0 },
      ...(final ? [{ key: 'result', label: 'Result', decimals: 0 }, { key: 'went', label: 'Went', decimals: 0 }] : []),
    ],
    rows: props.map((p) => ({
      key: `${p.athleteId}-${p.market}`,
      label: p.name,
      imageUrl: espnHeadshot('nba', p.athleteId),
      imageKind: 'player' as const,
      labelNote: p.side ? payload[p.side].abbr : null,
      href: `/nba/player/${p.athleteId}`,
      values: {
        market: NBA_MARKET_LABELS[p.market] ?? p.market,
        line: p.line == null ? 'yes/no' : p.line,
        over: `${am(p.over.price)} ${p.over.book}`,
        under: p.under ? `${am(p.under.price)} ${p.under.book}` : '—',
        books: p.books,
        result: p.result,
        went: p.result == null ? null : p.result > lineOf(p) ? 'Over' : p.result < lineOf(p) ? 'Under' : 'Push',
      },
    })),
    caption: 'Markets with one book quoting both sides are left out.',
  };
  return { id: 'lines', navLabel: final ? 'Lines & props' : 'Lines', title: final ? 'Lines & props' : 'Lines', rows: [[lines, series], [propsCard]], state: { kind: 'ready' } };
}

function nbaPlaysSection(payload: Payload): ResearchSection | null {
  const plays = payload.nba.plays.filter((p) => p.text);
  if (!plays.length) return null;
  const columns: ResearchColumn[] = [
    { key: 'team', label: 'Team', decimals: 0 },
    { key: 'play', label: 'Play', decimals: 0, text: true },
    { key: 'score', label: `${payload.away.abbr}–${payload.home.abbr}`, decimals: 0 },
  ];
  const row = (p: CourtPlay): ResearchTableRow => ({ key: p.id, label: `${quarter(p.period)} ${p.clock ?? ''}`, values: { team: abbrOf(payload, p.teamId), play: p.text, score: `${p.awayScore ?? '—'}–${p.homeScore ?? '—'}` } });
  const scoring = plays.filter((p) => p.scoring);
  const views = [
    { key: 'all', label: `Every play · ${plays.length}`, labelHeader: 'When', columns, rows: plays.map(row) },
    { key: 'scoring', label: `Scoring · ${scoring.length}`, labelHeader: 'When', columns, rows: scoring.map(row) },
  ];
  return { id: 'plays', navLabel: 'Play-by-play', title: 'Play-by-play', rows: [[{ kind: 'table', key: 'plays', title: 'Plays', labelHeader: 'When', columns, rows: views[0].rows, views, fixedOrder: true }]], state: { kind: 'ready' } };
}

function nbaMatchupSection(payload: Payload, state: GameState): ResearchSection {
  return matchupSection({
    away: payload.away,
    home: payload.home,
    state,
    pre: payload.nba.pregame,
    words: { attack: 'offense', defend: 'defense', unit: 'point', pool: 'all 30 teams', gameHref: (id) => `/nba/game/${id}`, h2hCaption: 'Regular season and playoffs, newest first.' },
  });
}

function nbaPlayersSection(payload: Payload, state: GameState): ResearchSection | null {
  const n = payload.nba;
  return propHistorySection({
    away: payload.away,
    home: payload.home,
    state,
    props: n.props
      .filter((p) => p.books >= 2)
      .map((p) => ({ key: `${p.athleteId}-${p.market}`, name: p.name, href: `/nba/player/${p.athleteId}`, imageUrl: espnHeadshot('nba', p.athleteId), side: p.side, marketLabel: NBA_MARKET_LABELS[p.market] ?? p.market, line: lineOf(p), books: p.books, history: n.pregame.propHistory[`${p.athleteId}|${p.market}`] ?? [] })),
  });
}

function nbaInjuriesSection(payload: Payload): ResearchSection | null {
  const report = payload.nba.injuries;
  const described = report.teams.some((t) => t.items.some((i) => i.type || i.detail));
  const view = (side: Side) => {
    const team = report.teams.find((t) => t.teamId === payload[side].id);
    return {
      key: side,
      label: `${payload[side].abbr} · ${team?.items.length ?? 0}`,
      labelHeader: 'Player',
      columns: [
        { key: 'pos', label: 'Pos', decimals: 0 },
        { key: 'status', label: 'Status', decimals: 0, text: true },
        ...(described ? [{ key: 'detail', label: 'Injury', decimals: 0, text: true }] : []),
      ] as ResearchColumn[],
      rows: (team?.items ?? []).map((i, k) => ({ key: i.athleteId ?? `${side}-${k}`, label: i.name ?? '—', href: i.athleteId ? `/nba/player/${i.athleteId}` : null, imageUrl: espnHeadshot('nba', i.athleteId), imageKind: 'player' as const, values: { pos: i.position, status: i.status, detail: [i.type, i.detail].filter(Boolean).join(' · ') || '—' } })),
    };
  };
  const views = [view('away'), view('home')];
  if (!views.some((v) => v.rows.length)) return null;
  return { id: 'injuries', navLabel: 'Injuries', title: 'Injuries', rows: [[{ kind: 'table', key: 'injuries', title: 'Injury report', scope: 'as ESPN reports it now', labelHeader: 'Player', columns: views[0].columns, rows: views[0].rows, views, fixedOrder: true }]], state: { kind: 'ready' } };
}

function nbaNowSection(payload: Payload): ResearchSection {
  const n = payload.nba;
  const last = [...n.plays].reverse().find((p) => p.text);
  const wp = n.winProbability.at(-1);
  const rows: ResearchCard[][] = [
    [
      {
        kind: 'table',
        key: 'situation',
        title: 'The game now',
        scope: [quarter(n.live?.period ?? null), n.live?.clock].filter(Boolean).join(' '),
        labelHeader: '',
        fixedOrder: true,
        columns: [{ key: 'value', label: '', decimals: 0, text: true }],
        rows: [
          { key: 'score', label: 'Score', values: { value: `${payload.away.abbr} ${payload.away.score ?? 0} · ${payload.home.abbr} ${payload.home.score ?? 0}` } },
          ...(last ? [{ key: 'last', label: 'Last play', values: { value: last.text } }] : []),
          ...(wp ? [{ key: 'wp', label: 'Win probability', values: { value: `${payload.home.abbr} ${(wp.home * 100).toFixed(1)}% · ${payload.away.abbr} ${(100 - wp.home * 100).toFixed(1)}%` } }] : []),
        ],
      },
    ],
    [
      propsTrackerCard(
        n.props.map((p) => ({ key: `${p.athleteId}-${p.market}`, name: p.name, href: `/nba/player/${p.athleteId}`, imageUrl: espnHeadshot('nba', p.athleteId), sideAbbr: p.side ? payload[p.side].abbr : null, marketLabel: NBA_MARKET_LABELS[p.market] ?? p.market, line: lineOf(p), books: p.books, result: p.result })),
      ),
    ],
  ];
  if (n.live) {
    const l = n.lines;
    rows.push(
      inGameOddsCards({
        away: payload.away,
        home: payload.home,
        inGame: n.live.inGame,
        close: (market) =>
          l && market === 'moneyline'
            ? { sides: [{ side: 'away', point: null, americanOdds: l.moneyline.away.close }, { side: 'home', point: null, americanOdds: l.moneyline.home.close }] }
            : l && market === 'spread'
              ? { sides: [{ side: 'away', point: l.spread.away.line.close, americanOdds: l.spread.away.odds.close }, { side: 'home', point: l.spread.home.line.close, americanOdds: l.spread.home.odds.close }] }
              : l && market === 'total'
                ? { sides: [{ side: 'over', point: l.total.over.line.close, americanOdds: l.total.over.odds.close }, { side: 'under', point: l.total.under.line.close, americanOdds: l.total.under.odds.close }] }
                : null,
        spreadLabel: 'Spread',
        startWord: 'the tip',
        scoredSince: () => null,
      }),
    );
  }
  return { id: 'now', navLabel: 'Right now', title: 'Right now', sub: 'refreshed every 15 seconds', rows, state: { kind: 'ready' } };
}
