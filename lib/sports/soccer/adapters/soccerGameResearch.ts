/**
 * The soccer game page — R8.3a, `toGameResearchData`, imported by
 * `GameResearchPage.tsx`. Sections follow G2 `game-soccer-tennis.js`: match flow
 * (a timeline of goals, cards, substitutions and shots), the shot map, lineups,
 * team stats, lines and props with the draw, and commentary; before the start,
 * the shared Matchup and Players sections, lineups once announced, injuries and
 * lines; while live, "Right now" first.
 *
 * Pure: no fetching, no JSX.
 */

import { marketLabel } from '@/lib/odds/props/marketLabels';
import type { SoccerGameResearchPayload, SoccerPropResult } from '@/lib/sports/soccer/gameResearch';
import { buildGameHero, gameStates, resolveState, stateNote } from '@/lib/sports/shared/gameResearch';
import type { GameResearchData, GameState } from '@/lib/sports/shared/gameResearchShapes';
import type { ResearchCard, ResearchColumn, ResearchSection, ResearchTableRow } from '@/lib/sports/shared/playerResearchShapes';
import { inGameOddsCards, matchupSection, propHistorySection, propsTrackerCard } from '@/lib/sports/shared/gameResearchSections';

type Payload = SoccerGameResearchPayload;
type Side = 'away' | 'home';

const am = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));
const signedLine = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));
/** A yes/no market's value is 1 or 0 (`soccerMarketValue`), so every one settles over 0.5: "two or more goals" is decided inside the value. */
const YES_NO_LINE = 0.5;
const lineOf = (p: SoccerPropResult) => p.line ?? YES_NO_LINE;

export function toGameResearchData(input: { payload: Payload; requestedState?: string | null }): GameResearchData {
  const { payload } = input;
  const state = resolveState(payload, input.requestedState);
  const atKickoff = () =>
    [soccerMatchupSection(payload, state), soccerPlayersSection(payload, state)]
      .filter((s): s is ResearchSection => s !== null)
      .map((s) => ({ ...s, id: `pre-${s.id}`, title: `${s.title} · at kickoff` }));
  const sections: ResearchSection[] =
    state === 'live'
      ? [soccerNowSection(payload), soccerFlowSection(payload), soccerShotsSection(payload), soccerTeamStatsSection(payload), soccerLineupsSection(payload), soccerCommentarySection(payload), ...atKickoff()].filter(
          (s): s is ResearchSection => s !== null,
        )
      : state === 'pre' || state === 'postponed'
        ? [
            soccerMatchupSection(payload, state),
            soccerLineupsSection(payload),
            soccerPlayersSection(payload, state),
            payload.state === 'pre' || payload.state === 'postponed' ? soccerInjuriesSection(payload) : null,
            soccerLinesSection(payload, state),
          ].filter((s): s is ResearchSection => s !== null)
        : [
            soccerFlowSection(payload),
            soccerShotsSection(payload),
            soccerLineupsSection(payload),
            soccerTeamStatsSection(payload),
            soccerLinesSection(payload, state),
            soccerCommentarySection(payload),
            ...atKickoff(),
          ].filter((s): s is ResearchSection => s !== null);
  return {
    state,
    states: gameStates(payload.state),
    hero: buildGameHero(payload, state, soccerLineChips(payload, state)),
    stateNote: stateNote(state, payload.state),
    sections,
    sources: payload.sources,
  };
}

const sideOfTeam = (payload: Payload, teamId: string | null): Side | null => (teamId === payload.home.id ? 'home' : teamId === payload.away.id ? 'away' : null);
/** Commentary names the team but carries no id; the full display name tells "Manchester City" from "Manchester United". */
const sideOfCommentary = (payload: Payload, c: { teamId: string | null; teamName: string | null }): Side | null =>
  sideOfTeam(payload, c.teamId) ?? (c.teamName === payload.home.name ? 'home' : c.teamName === payload.away.name ? 'away' : null);

/** Pickcenter's three-way close, and once final the result against the total and the handicap. */
export function soccerLineChips(payload: Payload, state: GameState): GameResearchData['hero']['chips'] {
  const l = payload.soccer.lines;
  if (!l) return [];
  const out: GameResearchData['hero']['chips'] = [];
  const final = state === 'final' && payload.away.score != null && payload.home.score != null;
  const a = payload.away.score ?? 0;
  const h = payload.home.score ?? 0;
  if (l.moneyline.home.close != null || l.moneyline.away.close != null) {
    out.push({ label: `${payload.home.abbr} ${am(l.moneyline.home.close)} · Draw ${am(l.moneyline.draw?.close)} · ${payload.away.abbr} ${am(l.moneyline.away.close)}` });
  }
  if (final) out.push({ label: h > a ? `${payload.home.abbr} won` : a > h ? `${payload.away.abbr} won` : 'Draw' });
  const total = l.total.over.line.close;
  if (total != null) out.push({ label: final ? `Total ${total} · ${a + h > total ? 'over' : a + h < total ? 'under' : 'push'} (${a + h})` : `Total ${total}` });
  return out;
}

// ---------------------------------------------------------------------------
// flow, shots, lineups, team stats, commentary
// ---------------------------------------------------------------------------

const minuteOf = (seconds: number | null, label: string | null) => (seconds != null ? seconds / 60 : Number.parseInt(label ?? '0', 10) || 0);

function soccerFlowSection(payload: Payload): ResearchSection | null {
  const s = payload.soccer;
  const events: Extract<ResearchCard, { kind: 'timeline' }>['events'] = [];
  for (const k of s.keyEvents) {
    const side = sideOfTeam(payload, k.teamId);
    if (!side) continue;
    const kind = /goal/i.test(k.type) && !/disallowed/i.test(k.type) ? 'goal' : /red card/i.test(k.type) ? 'red' : /yellow card/i.test(k.type) ? 'yellow' : /substitution/i.test(k.type) ? 'sub' : null;
    if (kind) events.push({ key: k.id, side, minute: minuteOf(k.seconds, k.minute), kind, tip: [`${k.minute ?? ''} ${k.type}`, k.text ?? ''] });
  }
  s.commentary.forEach((c, i) => {
    const side = sideOfCommentary(payload, c);
    if (!side || !/^shot/i.test(c.type ?? '')) return;
    events.push({ key: `c${i}`, side, minute: minuteOf(c.seconds, c.minute), kind: /on target|woodwork/i.test(c.type ?? '') ? 'shot-on' : 'shot', tip: [`${c.minute ?? ''} ${c.type ?? ''}`, c.text ?? ''] });
  });
  if (!events.length) return { id: 'flow', navLabel: 'Match flow', title: 'Match flow', rows: [], state: { kind: 'empty', title: 'Nothing has happened yet', reason: 'Goals, cards, substitutions and shots appear as ESPN records them.' } };
  return {
    id: 'flow',
    navLabel: 'Match flow',
    title: 'Match flow',
    sub: 'no win probability is published for soccer',
    rows: [
      [
        {
          kind: 'timeline',
          key: 'timeline',
          title: 'Timeline',
          scope: 'goals, cards, substitutions and every located shot',
          teams: { away: payload.away.abbr, home: payload.home.abbr },
          events: events.sort((a, b) => a.minute - b.minute),
          caption: 'G is a goal; the card marks are cards; arrows are substitutions; small dots are shots, filled when on target or off the woodwork.',
        },
      ],
    ],
    state: { kind: 'ready' },
  };
}

function soccerShotsSection(payload: Payload): ResearchSection | null {
  const s = payload.soccer;
  const shots = s.commentary
    .map((c, i) => ({ c, i, side: sideOfCommentary(payload, c) }))
    .filter((x): x is typeof x & { side: Side } => x.side != null && x.c.x != null && x.c.y != null && /^shot|^goal|penalty scored/i.test(x.c.type ?? ''));
  if (!shots.length) return null;
  const goal = (t: string | null) => /^goal|penalty scored/i.test(t ?? '');
  const onTarget = (t: string | null) => goal(t) || /on target|woodwork/i.test(t ?? '');
  // Commentary puts the team in possession attacking x = 100. The away side attacks the left goal here, so it is mirrored.
  const place = (side: Side, x: number, y: number): [number, number] => (side === 'home' ? [x, y] : [100 - x, 100 - y]);
  const count = (side: Side) => shots.filter((x) => x.side === side).length;
  const scatter: ResearchCard = {
    kind: 'scatter',
    key: 'shot-map',
    title: 'Where the shots came from',
    scope: `${shots.length} located shots`,
    surface: 'fullpitch',
    points: shots.map((x) => [x.side, ...place(x.side, x.c.x!, x.c.y!)] as [string, number, number]),
    emphasis: shots.map((x) => goal(x.c.type)),
    filled: shots.map((x) => onTarget(x.c.type)),
    tips: shots.map((x) => [`${x.c.minute ?? ''} ${x.c.type ?? ''}`, x.c.text ?? '']),
    ends: { left: `${payload.away.abbr} attack`, right: `${payload.home.abbr} attack` },
    groups: [
      { key: 'away', label: payload.away.abbr, count: count('away') },
      { key: 'home', label: payload.home.abbr, count: count('home') },
    ],
    defaultVisible: ['away', 'home'],
    caption: 'ESPN locates a curated set of events, not every shot. A goal is the large white dot; filled is on target or off the woodwork; a ring missed or was blocked.',
  };
  const summary = (side: Side) => {
    const mine = shots.filter((x) => x.side === side).map((x) => x.c.type);
    return { located: mine.length, on: mine.filter(onTarget).length, goals: mine.filter(goal).length };
  };
  const a = summary('away');
  const h = summary('home');
  const table: ResearchCard = {
    kind: 'table',
    key: 'shot-summary',
    title: 'Located shots',
    labelHeader: '',
    fixedOrder: true,
    compare: 'row',
    columns: [
      { key: 'away', label: payload.away.abbr, decimals: 0, imageUrl: payload.away.logoUrl, bar: true },
      { key: 'home', label: payload.home.abbr, decimals: 0, imageUrl: payload.home.logoUrl, bar: true },
    ],
    rows: [
      { key: 'located', label: 'Located shots', values: { away: a.located, home: h.located } },
      { key: 'on', label: 'On target or woodwork', values: { away: a.on, home: h.on } },
      { key: 'goals', label: 'Goals', values: { away: a.goals, home: h.goals } },
    ],
  };
  return { id: 'shots', navLabel: 'Shot map', title: 'Shot map', rows: [[scatter, table]], state: { kind: 'ready' } };
}

function soccerLineupsSection(payload: Payload): ResearchSection | null {
  const s = payload.soccer;
  const view = (side: Side) => {
    const l = s.lineups.find((x) => x.teamId === payload[side].id);
    const players = [...(l?.players ?? [])].sort((p, q) => Number(q.starter) - Number(p.starter) || (p.formationPlace ?? 99) - (q.formationPlace ?? 99));
    return {
      key: side,
      label: `${payload[side].abbr}${l?.formation ? ` · ${l.formation}` : ''}`,
      labelHeader: 'Player',
      columns: [
        { key: 'jersey', label: '#', decimals: 0 },
        { key: 'pos', label: 'Pos', decimals: 0 },
        { key: 'role', label: 'Role', decimals: 0, text: true },
      ] as ResearchColumn[],
      rows: players.map((p) => ({
        key: `${side}-${p.id}`,
        label: p.name ?? '—',
        href: p.id ? `/soccer/${s.league}/player/${p.id}` : null,
        values: { jersey: p.jersey, pos: p.position, role: p.starter ? (p.subbedOut ? 'Started, came off' : 'Started') : p.subbedIn ? 'Came on' : 'On the bench' },
      })),
    };
  };
  const views = [view('home'), view('away')];
  if (!views.some((v) => v.rows.length)) return null;
  return {
    id: 'lineups',
    navLabel: 'Lineups',
    title: 'Lineups',
    sub: 'formation as announced',
    rows: [[{ kind: 'table', key: 'lineups', title: 'Squads', scope: 'starters first, in formation order', labelHeader: 'Player', columns: views[0].columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

function soccerTeamStatsSection(payload: Payload): ResearchSection | null {
  const stats = payload.soccer.teamStats;
  if (!stats.length) return null;
  const columns: ResearchColumn[] = [
    { key: 'home', label: payload.home.abbr, decimals: 0, imageUrl: payload.home.logoUrl, bar: true },
    { key: 'away', label: payload.away.abbr, decimals: 0, imageUrl: payload.away.logoUrl, bar: true },
  ];
  const rows = stats.map((r) => ({ key: r.key, label: r.label, values: { home: r.home, away: r.away } }));
  return {
    id: 'teams',
    navLabel: 'Team stats',
    title: 'Team stats',
    rows: [[{ kind: 'table', key: 'team-stats', title: 'Team stats', labelHeader: 'Stat', compare: 'row' as const, columns, rows, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

function soccerCommentarySection(payload: Payload): ResearchSection | null {
  const c = payload.soccer.commentary.filter((e) => e.text);
  if (!c.length) return null;
  const columns: ResearchColumn[] = [{ key: 'text', label: 'Commentary', decimals: 0, text: true }];
  const row = (e: (typeof c)[number], i: number): ResearchTableRow => ({ key: `${e.sequence ?? i}`, label: e.minute ?? '', labelNote: e.type, values: { text: e.text }, ...(/^goal/i.test(e.type ?? '') ? { highlight: true } : {}) });
  const key = c.filter((e) => /goal|card|woodwork|penalty/i.test(e.type ?? ''));
  const views = [
    { key: 'all', label: `Every entry · ${c.length}`, labelHeader: 'Minute', columns, rows: c.map(row) },
    { key: 'key', label: `Goals, cards, woodwork · ${key.length}`, labelHeader: 'Minute', columns, rows: key.map(row) },
  ];
  return {
    id: 'plays',
    navLabel: 'Commentary',
    title: 'Commentary',
    rows: [[{ kind: 'table', key: 'commentary', title: 'Commentary', scope: 'goals shaded', labelHeader: 'Minute', columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

// ---------------------------------------------------------------------------
// lines & props, before the start, while live
// ---------------------------------------------------------------------------

function soccerLinesSection(payload: Payload, state: GameState): ResearchSection {
  const s = payload.soccer;
  const final = state === 'final';
  const l = s.lines;
  const priced = (line: number | null, odds: number | null) => (line == null && odds == null ? '—' : `${line != null ? `${signedLine(line)} ` : ''}${am(odds)}`);
  const lineRows: ResearchTableRow[] = l
    ? [
        { key: 'ml-home', label: `Moneyline · ${payload.home.abbr}`, values: { open: am(l.moneyline.home.open), close: am(l.moneyline.home.close) } },
        { key: 'ml-draw', label: 'Moneyline · draw', values: { open: am(l.moneyline.draw?.open), close: am(l.moneyline.draw?.close) } },
        { key: 'ml-away', label: `Moneyline · ${payload.away.abbr}`, values: { open: am(l.moneyline.away.open), close: am(l.moneyline.away.close) } },
        { key: 'sp-home', label: `Handicap · ${payload.home.abbr}`, values: { open: priced(l.spread.home.line.open, l.spread.home.odds.open), close: priced(l.spread.home.line.close, l.spread.home.odds.close) } },
        { key: 'sp-away', label: `Handicap · ${payload.away.abbr}`, values: { open: priced(l.spread.away.line.open, l.spread.away.odds.open), close: priced(l.spread.away.line.close, l.spread.away.odds.close) } },
        { key: 'to-over', label: 'Total · over', values: { open: priced(l.total.over.line.open, l.total.over.odds.open).replace(/^\+/, ''), close: priced(l.total.over.line.close, l.total.over.odds.close).replace(/^\+/, '') } },
        { key: 'to-under', label: 'Total · under', values: { open: priced(l.total.under.line.open, l.total.under.odds.open).replace(/^\+/, ''), close: priced(l.total.under.line.close, l.total.under.odds.close).replace(/^\+/, '') } },
      ].filter((r) => r.values.open !== '—' || r.values.close !== '—')
    : [];
  const stored = s.storedLines.find((x) => x.market === 'moneyline');
  if (stored?.close) {
    for (const side of stored.close.sides) {
      const o = stored.open?.sides.find((x) => x.side === side.side);
      lineRows.push({ key: `stored-${side.side}`, label: `Moneyline · ${payload[side.side as Side]?.abbr ?? side.side} · ${stored.close.books} books`, values: { open: am(o?.americanOdds), close: am(side.americanOdds) } });
    }
  }
  const lines: ResearchCard = {
    kind: 'table',
    key: 'game-lines',
    title: 'Game lines',
    scope: 'open to the last quote before kickoff',
    labelHeader: 'Market',
    fixedOrder: true,
    emptyText: 'No game lines held for this match',
    columns: [
      { key: 'open', label: 'Open', decimals: 0 },
      { key: 'close', label: 'Close', decimals: 0 },
    ],
    rows: lineRows,
    caption: `${l?.provider ?? 'DraftKings'} through ESPN for every market, the draw included${stored?.close ? '; the rows with a book count are the median across the books this app stores, which hold two-way moneylines only, no draw' : ''}.`,
  };
  const props = s.props.filter((p) => p.books >= 2 && (!final || p.result != null));
  const propsCard: ResearchCard = {
    kind: 'table',
    key: 'props',
    title: final ? 'Props against results' : 'Player props',
    scope: final ? 'main line or yes price at kickoff, against the match' : 'main lines and scorer markets',
    labelHeader: 'Player',
    emptyText: 'No player props held for this match',
    sortKey: final ? undefined : 'books',
    columns: [
      { key: 'market', label: 'Market', decimals: 0, text: true },
      { key: 'line', label: 'Line', decimals: 1 },
      { key: 'over', label: 'Best over / yes', decimals: 0 },
      { key: 'under', label: 'Best under', decimals: 0 },
      { key: 'books', label: 'Books', decimals: 0 },
      ...(final ? [{ key: 'result', label: 'Result', decimals: 0 }, { key: 'went', label: 'Went', decimals: 0 }] : []),
    ],
    rows: props.map((p) => ({
      key: `${p.athleteId}-${p.market}`,
      label: p.name,
      labelNote: p.side ? payload[p.side].abbr : null,
      href: `/soccer/${s.league}/player/${p.athleteId}`,
      // R9a-F1: ESPN holds no soccer headshot, so a player row carries his
      // club's crest rather than a grey silhouette.
      imageUrl: p.side ? payload[p.side].logoUrl : null,
      imageKind: 'logo' as const,
      values: {
        market: marketLabel(p.market, 'soccer'),
        line: p.line == null ? 'yes/no' : p.line,
        over: `${am(p.over.price)} ${p.over.book}`,
        under: p.under ? `${am(p.under.price)} ${p.under.book}` : '—',
        books: p.books,
        result: p.line == null && p.result != null ? (p.result > 0 ? 'Yes' : 'No') : p.result,
        went: p.result == null ? null : p.line == null ? (p.result > 0 ? 'Yes' : 'No') : p.result > p.line ? 'Over' : p.result < p.line ? 'Under' : 'Push',
      },
    })),
    caption: [s.propsAltOnly ? `${s.propsAltOnly} markets had only alternate lines quoted` : null, 'markets with one book are'].filter(Boolean).join(' and ').replace(/^./, (c) => c.toUpperCase()) + ' left out. First scorer counts the first goal a player scored; own goals count for nobody.',
  };
  return { id: 'lines', navLabel: final ? 'Lines & props' : 'Lines', title: final ? 'Lines & props' : 'Lines', rows: [[lines], [propsCard]], state: { kind: 'ready' } };
}

function soccerMatchupSection(payload: Payload, state: GameState): ResearchSection {
  const league = payload.soccer.league;
  return matchupSection({
    away: payload.away,
    home: payload.home,
    state,
    pre: payload.soccer.pregame,
    words: {
      attack: 'attack',
      defend: 'defense',
      unit: 'goal',
      pool: 'every club in the league',
      gameHref: (id) => `/soccer/${league}/game/${id}`,
      h2hCaption: 'Every competition, newest first.',
    },
  });
}

function soccerPlayersSection(payload: Payload, state: GameState): ResearchSection | null {
  const s = payload.soccer;
  return propHistorySection({
    away: payload.away,
    home: payload.home,
    state,
    props: s.props
      .filter((p) => p.books >= 2)
      .map((p) => ({
        key: `${p.athleteId}-${p.market}`,
        name: p.name,
        href: `/soccer/${s.league}/player/${p.athleteId}`,
        imageUrl: p.side ? payload[p.side].logoUrl : null,
        imageKind: 'logo' as const,
        side: p.side,
        marketLabel: marketLabel(p.market, 'soccer'),
        line: lineOf(p),
        books: p.books,
        history: s.pregame.propHistory[`${p.athleteId}|${p.market}`] ?? [],
      })),
  });
}

function soccerInjuriesSection(payload: Payload): ResearchSection | null {
  const report = payload.soccer.injuries;
  const view = (side: Side) => {
    const team = report.teams.find((t) => t.teamId === payload[side].id);
    return {
      key: side,
      label: `${payload[side].abbr} · ${team?.items.length ?? 0}`,
      labelHeader: 'Player',
      columns: [
        { key: 'status', label: 'Status', decimals: 0, text: true },
        { key: 'detail', label: 'Injury', decimals: 0, text: true },
      ] as ResearchColumn[],
      rows: (team?.items ?? []).map((i, n) => ({ key: i.athleteId ?? `${side}-${n}`, label: i.name ?? '—', values: { status: i.status, detail: [i.type, i.detail].filter(Boolean).join(' · ') || '—' } })),
    };
  };
  const views = [view('home'), view('away')];
  if (!views.some((v) => v.rows.length)) return null;
  return {
    id: 'injuries',
    navLabel: 'Injuries',
    title: 'Injuries',
    rows: [[{ kind: 'table', key: 'injuries', title: 'Injury report', scope: 'as ESPN reports it now', labelHeader: 'Player', columns: views[0].columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

function soccerNowSection(payload: Payload): ResearchSection {
  const s = payload.soccer;
  const rows: ResearchCard[][] = [];
  const last = [...s.keyEvents].reverse().find((k) => /goal|card|substitution/i.test(k.type));
  rows.push([
    {
      kind: 'table',
      key: 'situation',
      title: 'The match now',
      scope: s.live?.minute ?? payload.statusText,
      labelHeader: '',
      fixedOrder: true,
      columns: [{ key: 'value', label: '', decimals: 0, text: true }],
      rows: [
        { key: 'score', label: 'Score', values: { value: `${payload.home.abbr} ${payload.home.score ?? 0} · ${payload.away.abbr} ${payload.away.score ?? 0}` } },
        ...(last ? [{ key: 'last', label: 'Last event', values: { value: `${last.minute ?? ''} ${last.type}: ${last.text ?? ''}` } }] : []),
      ],
    },
  ]);
  rows.push([
    propsTrackerCard(
      s.props.map((p) => ({
        key: `${p.athleteId}-${p.market}`,
        name: p.name,
        href: `/soccer/${s.league}/player/${p.athleteId}`,
        imageUrl: p.side ? payload[p.side].logoUrl : null,
        imageKind: 'logo' as const,
        sideAbbr: p.side ? payload[p.side].abbr : null,
        marketLabel: marketLabel(p.market, 'soccer'),
        line: lineOf(p),
        books: p.books,
        result: p.result,
      })),
    ),
  ]);
  const l = s.lines;
  if (s.live) {
    rows.push(
      inGameOddsCards({
        away: payload.away,
        home: payload.home,
        inGame: s.live.inGame,
        close: (market) => (l && market === 'moneyline' ? { sides: [{ side: 'away', point: null, americanOdds: l.moneyline.away.close }, { side: 'home', point: null, americanOdds: l.moneyline.home.close }] } : null),
        spreadLabel: 'Handicap',
        startWord: 'kickoff',
        scoredSince: () => null,
      }),
    );
  }
  return { id: 'now', navLabel: 'Right now', title: 'Right now', sub: 'refreshed every 15 seconds', rows, state: { kind: 'ready' } };
}
