/**
 * The NHL game page — R8.4b, exported as `toGameResearchData` from
 * `gameDetailAdapter.ts`. Sections follow G2 `game-hoops-hockey.js`: game flow
 * (cumulative shot attempts, since the NHL publishes no win probability, with
 * scoring and shots by period), the shot map, team stats, the box score with
 * goaltending and penalties, lines with the season series and props,
 * play-by-play; before the faceoff, the shared Matchup and Players sections,
 * injuries and lines; live, "Right now".
 *
 * Pure: no fetching, no JSX.
 */

import type { NhlGameResearchPayload, NhlPropResult } from '@/lib/sports/nhl/gameResearch';
import type { NhlEvent } from '@/lib/sports/nhl/apiWebParsers';
import { buildGameHero, gameStates, resolveState, stateNote } from '@/lib/sports/shared/gameResearch';
import type { GameResearchData, GameState } from '@/lib/sports/shared/gameResearchShapes';
import type { ResearchCard, ResearchColumn, ResearchSection, ResearchTableRow } from '@/lib/sports/shared/playerResearchShapes';
import { inGameOddsCards, matchupSection, propHistorySection, propsTrackerCard } from '@/lib/sports/shared/gameResearchSections';
import { nhlHeadshot } from '@/lib/sports/shared/identity';

type Payload = NhlGameResearchPayload;
type Side = 'away' | 'home';

export const NHL_MARKET_LABELS: Record<string, string> = {
  goals: 'Goals',
  assists: 'Assists',
  points: 'Points',
  'shots-on-goal': 'Shots on goal',
  hits: 'Hits',
  'blocked-shots': 'Blocked shots',
  saves: 'Saves',
  'goals-against': 'Goals against',
  'anytime-goalscorer': 'Anytime scorer',
};

const SHOT_TYPES = ['goal', 'shot-on-goal', 'missed-shot', 'blocked-shot'];
const SHOT_LABEL: Record<string, string> = { goal: 'Goal', 'shot-on-goal': 'Shot on goal', 'missed-shot': 'Missed', 'blocked-shot': 'Blocked' };
const am = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));
const signedLine = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));
const lineOf = (p: NhlPropResult) => p.line ?? 0.5;
export const periodLabel = (e: Pick<NhlEvent, 'period' | 'periodType'>) => (e.periodType === 'SO' ? 'SO' : e.periodType === 'OT' || (e.period ?? 0) > 3 ? ((e.period ?? 4) === 4 ? 'OT' : `${(e.period ?? 4) - 3}OT`) : `P${e.period ?? ''}`);
const sideOf = (e: NhlEvent): Side | null => (e.isHome == null ? null : e.isHome ? 'home' : 'away');

/**
 * The NHL mugshot, which is keyed by season AND team as well as the player
 * (R9a). The season is the game id's first four digits — 2025021270 is a
 * 2025-26 game — and the team comes from the side the player dressed for.
 */
const faceOf = (gameId: string, teamAbbr: string | null | undefined, playerId: number | string | null | undefined) =>
  nhlHeadshot(Number(gameId.slice(0, 4)) || null, teamAbbr, playerId);
/** Seconds into the game, 20-minute periods (a regular-season overtime is shorter, but only ordering matters here). */
export const gameSeconds = (e: Pick<NhlEvent, 'period' | 'timeInPeriod'>) => {
  const [m, s] = String(e.timeInPeriod ?? '0:00').split(':').map(Number);
  return ((e.period ?? 1) - 1) * 1200 + (m || 0) * 60 + (s || 0);
};

/**
 * A goal's strength from api-web's situation code: four digits, away goalie,
 * away skaters, home skaters, home goalie ("1551" is five on five with both
 * goalies in). `null` at even strength with both nets guarded.
 */
export function goalStrength(e: Pick<NhlEvent, 'situation' | 'isHome'>): string | null {
  const code = e.situation;
  if (!code || !/^\d{4}$/.test(code) || e.isHome == null) return null;
  const [awayGoalie, awaySkaters, homeSkaters, homeGoalie] = code.split('').map(Number);
  const [us, them, ourGoalie, theirGoalie] = e.isHome ? [homeSkaters, awaySkaters, homeGoalie, awayGoalie] : [awaySkaters, homeSkaters, awayGoalie, homeGoalie];
  // A pulled goalie's extra skater is not a penalty: FLA's late goals on TOR (code 1560) were 5 on 5 into an
  // empty net, which counting skaters alone called short-handed. Strength compares skaters with the goalie's
  // replacement taken out on either side.
  const ourSkaters = us - (ourGoalie === 0 ? 1 : 0);
  const theirSkaters = them - (theirGoalie === 0 ? 1 : 0);
  const parts = [
    ourSkaters > theirSkaters ? 'power play' : ourSkaters < theirSkaters ? 'short-handed' : null,
    ourGoalie === 0 ? 'extra attacker' : null,
    theirGoalie === 0 ? 'empty net' : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function toGameResearchData(input: { payload: Payload; requestedState?: string | null }): GameResearchData {
  const { payload } = input;
  const state = resolveState(payload, input.requestedState);
  const atFaceoff = () =>
    [nhlMatchupSection(payload, state), nhlPlayersSection(payload, state)]
      .filter((s): s is ResearchSection => s !== null)
      .map((s) => ({ ...s, id: `pre-${s.id}`, title: `${s.title} · at puck drop` }));
  const sections = (
    state === 'live'
      ? [nhlNowSection(payload), nhlFlowSection(payload), nhlRinkSection(payload), nhlTeamStatsSection(payload), nhlBoxSection(payload), nhlPlaysSection(payload), ...atFaceoff()]
      : state === 'pre' || state === 'postponed'
        ? [nhlMatchupSection(payload, state), nhlPlayersSection(payload, state), payload.state === 'pre' || payload.state === 'postponed' ? nhlInjuriesSection(payload) : null, nhlLinesSection(payload, state)]
        : [nhlFlowSection(payload), nhlRinkSection(payload), nhlTeamStatsSection(payload), nhlBoxSection(payload), nhlLinesSection(payload, state), nhlPlaysSection(payload), ...atFaceoff()]
  ).filter((s): s is ResearchSection => s !== null);
  return { state, states: gameStates(payload.state), hero: buildGameHero(payload, state, nhlLineChips(payload, state)), stateNote: stateNote(state, payload.state), sections, sources: payload.sources };
}

export function nhlLineChips(payload: Payload, state: GameState): GameResearchData['hero']['chips'] {
  const l = payload.nhl.lines;
  if (!l) return [];
  const out: GameResearchData['hero']['chips'] = [];
  const final = state === 'final' && payload.away.score != null && payload.home.score != null;
  const a = payload.away.score ?? 0;
  const h = payload.home.score ?? 0;
  if (l.moneyline.away.close != null || l.moneyline.home.close != null) out.push({ label: `ML ${payload.away.abbr} ${am(l.moneyline.away.close)} · ${payload.home.abbr} ${am(l.moneyline.home.close)}` });
  const puck = l.spread.away.line.close;
  if (puck != null) {
    const margin = a - h + puck;
    const who = `${payload.away.abbr} ${signedLine(puck)}`;
    out.push({ label: final ? `${who} ${margin > 0 ? 'covered' : margin < 0 ? 'did not cover' : 'push'}` : who });
  }
  const total = l.total.over.line.close;
  if (total != null) out.push({ label: final ? `Total ${total} · ${a + h > total ? 'over' : a + h < total ? 'under' : 'push'} (${a + h})` : `Total ${total}` });
  return out;
}

function nhlFlowSection(payload: Payload): ResearchSection | null {
  const n = payload.nhl;
  const shots = n.events.filter((e) => SHOT_TYPES.includes(e.type) && e.periodType !== 'SO');
  if (!shots.length) return null;
  const lastMinute = Math.max(60, Math.ceil(Math.max(...shots.map(gameSeconds)) / 60));
  const cumulative = (side: Side) => {
    const out: number[] = [];
    let count = 0;
    for (let m = 0; m <= lastMinute; m++) {
      count = shots.filter((e) => sideOf(e) === side && gameSeconds(e) <= m * 60).length;
      out.push(count);
    }
    return out;
  };
  const home = cumulative('home');
  const away = cumulative('away');
  const flow: ResearchCard = {
    kind: 'series',
    key: 'attempts',
    title: 'Shot attempts',
    scope: `cumulative by minute · ${payload.away.abbr} ${away.at(-1)}, ${payload.home.abbr} ${home.at(-1)}`,
    values: home,
    context: away,
    xLabels: home.map((_, m) => (m % 20 === 0 ? (m === 0 ? 'P1' : m <= 40 ? `P${m / 20 + 1}` : m === 60 && lastMinute > 60 ? 'OT' : '') : '')),
    zeroBased: true,
    decimals: 0,
    unit: '',
    tips: home.map((h, m) => [`${m}′`, `${payload.home.abbr} ${h} · ${payload.away.abbr} ${away[m]}`]),
    legend: [
      { label: payload.home.abbr, dark: true },
      { label: payload.away.abbr, dark: false },
    ],
    caption: 'Attempts are goals, shots on goal, misses and blocked shots (Corsi). The NHL publishes no win probability.',
  };
  const goals = n.events.filter((e) => e.type === 'goal');
  const name = (id: number | null) => (id == null ? null : n.roster[String(id)]?.name ?? null);
  const scoring: ResearchCard = {
    kind: 'table',
    key: 'scoring',
    title: 'Scoring',
    scope: `${goals.length} goals`,
    labelHeader: 'When',
    fixedOrder: true,
    emptyText: 'No goals',
    columns: [
      { key: 'team', label: 'Team', decimals: 0 },
      { key: 'goal', label: 'Goal', decimals: 0, text: true },
      { key: 'score', label: `${payload.away.abbr}–${payload.home.abbr}`, decimals: 0 },
    ],
    rows: goals.map((e, i) => ({
      key: `g${i}`,
      label: `${periodLabel(e)} ${e.timeInPeriod ?? ''}`,
      values: {
        team: sideOf(e) ? payload[sideOf(e)!].abbr : '',
        goal: [name(e.shooterId), [name(e.assist1Id), name(e.assist2Id)].filter(Boolean).join(', ')].filter(Boolean).join(' · assisted by ') + (goalStrength(e) ? ` (${goalStrength(e)})` : ''),
        score: `${e.awayScore ?? '—'}–${e.homeScore ?? '—'}`,
      },
    })),
  };
  const periods = n.shotsByPeriod;
  const attemptsIn = (label: string, side: Side) => shots.filter((e) => periodLabel(e) === label && sideOf(e) === side).length;
  const byPeriod: ResearchCard = {
    kind: 'table',
    key: 'by-period',
    title: 'By period',
    labelHeader: 'Period',
    fixedOrder: true,
    columns: [
      { key: 'awaySog', label: `${payload.away.abbr} SOG`, decimals: 0 },
      { key: 'awayAtt', label: `${payload.away.abbr} attempts`, decimals: 0 },
      { key: 'homeSog', label: `${payload.home.abbr} SOG`, decimals: 0 },
      { key: 'homeAtt', label: `${payload.home.abbr} attempts`, decimals: 0 },
    ],
    rows: periods.map((p) => ({ key: p.period, label: p.period, values: { awaySog: p.away, awayAtt: attemptsIn(p.period, 'away'), homeSog: p.home, homeAtt: attemptsIn(p.period, 'home') } })),
  };
  return { id: 'flow', navLabel: 'Game flow', title: 'Game flow', sub: 'no win probability is published for hockey, so the flow is shot attempts', rows: [[flow], [scoring, byPeriod]], state: { kind: 'ready' } };
}

function nhlRinkSection(payload: Payload): ResearchSection | null {
  const n = payload.nhl;
  const shots = n.events.filter((e): e is NhlEvent & { x: number; y: number } => SHOT_TYPES.includes(e.type) && e.periodType !== 'SO' && e.x != null && e.y != null && sideOf(e) != null);
  if (!shots.length) return null;
  const name = (id: number | null) => (id == null ? '' : n.roster[String(id)]?.name ?? '');
  // Teams switch ends each period: a half turn puts every attempt at the positive end, both axes (R6.5).
  const at = (e: { x: number; y: number }) => (e.x < 0 ? { x: -e.x, y: -e.y } : { x: e.x, y: e.y });
  const count = (side: Side) => shots.filter((e) => sideOf(e) === side).length;
  const scatter: ResearchCard = {
    kind: 'scatter',
    key: 'rink',
    title: 'Where the attempts came from',
    scope: `${shots.length} attempts with a location`,
    surface: 'rink',
    points: shots.map((e) => {
      const p = at(e);
      return [sideOf(e)!, p.y, p.x] as [string, number, number];
    }),
    emphasis: shots.map((e) => e.type === 'goal'),
    tips: shots.map((e) => [`${periodLabel(e)} ${e.timeInPeriod ?? ''} · ${payload[sideOf(e)!].abbr} · ${SHOT_LABEL[e.type]}`, [name(e.shooterId), e.shotType].filter(Boolean).join(' · ')]),
    groups: [
      { key: 'away', label: payload.away.abbr, count: count('away') },
      { key: 'home', label: payload.home.abbr, count: count('home') },
    ],
    defaultVisible: ['away', 'home'],
    caption: 'Every attempt turned to attack the same net. A filled dot is a goal.',
  };
  const tally = (type: string, side: Side) => shots.filter((e) => e.type === type && sideOf(e) === side).length;
  const table: ResearchCard = {
    kind: 'table',
    key: 'attempt-types',
    title: 'Attempts by result',
    labelHeader: '',
    fixedOrder: true,
    compare: 'row',
    columns: [
      { key: 'away', label: payload.away.abbr, decimals: 0, imageUrl: payload.away.logoUrl, bar: true },
      { key: 'home', label: payload.home.abbr, decimals: 0, imageUrl: payload.home.logoUrl, bar: true },
    ],
    rows: SHOT_TYPES.map((t) => ({ key: t, label: SHOT_LABEL[t], values: { away: tally(t, 'away'), home: tally(t, 'home') } })),
    caption: 'Blocked shots are credited to the shooting team here, where the box score credits the blocker.',
  };
  return { id: 'rink', navLabel: 'Shot map', title: 'Shot map', sub: 'NHL coordinates, every attempt', rows: [[scatter, table]], state: { kind: 'ready' } };
}

const TEAM_STAT_LABEL: Record<string, string> = {
  sog: 'Shots on goal',
  faceoffWinningPctg: 'Faceoff win %',
  faceoffWins: 'Faceoffs won',
  powerPlay: 'Power play',
  powerPlayPctg: 'Power play %',
  pim: 'Penalty minutes',
  hits: 'Hits',
  blockedShots: 'Blocked shots',
  giveaways: 'Giveaways',
  takeaways: 'Takeaways',
};

function nhlTeamStatsSection(payload: Payload): ResearchSection | null {
  const stats = payload.nhl.teamStats;
  if (!stats.length) return null;
  const show = (key: string, v: string) => (/Pctg$/.test(key) && Number.isFinite(Number(v)) ? `${(100 * Number(v)).toFixed(1)}%` : v);
  return {
    id: 'teams',
    navLabel: 'Team stats',
    title: 'Team stats',
    rows: [
      [
        {
          kind: 'table',
          key: 'team-stats',
          title: 'Team stats',
          labelHeader: 'Stat',
          fixedOrder: true,
          compare: 'row',
          columns: [
            { key: 'away', label: payload.away.abbr, decimals: 0, imageUrl: payload.away.logoUrl, bar: true },
            { key: 'home', label: payload.home.abbr, decimals: 0, imageUrl: payload.home.logoUrl, bar: true },
          ],
          rows: stats.map((s) => ({ key: s.key, label: TEAM_STAT_LABEL[s.key] ?? s.key, values: { away: show(s.key, s.away), home: show(s.key, s.home) } })),
        },
      ],
    ],
    state: { kind: 'ready' },
  };
}

function nhlBoxSection(payload: Payload): ResearchSection | null {
  const n = payload.nhl;
  const box = n.box;
  if (!box) return null;
  const abbrFor = (side: Side) => (side === 'home' ? box.homeAbbr : box.awayAbbr);
  const skaterColumns: ResearchColumn[] = [
    { key: 'pos', label: 'Pos', decimals: 0 },
    { key: 'g', label: 'G', decimals: 0 },
    { key: 'a', label: 'A', decimals: 0 },
    { key: 'p', label: 'P', decimals: 0, bar: true, leader: 'high' },
    { key: 'sog', label: 'SOG', decimals: 0 },
    { key: 'hit', label: 'HIT', decimals: 0 },
    { key: 'blk', label: 'BLK', decimals: 0 },
  ];
  const views = (['away', 'home'] as const).map((side) => ({
    key: side,
    label: payload[side].abbr,
    labelHeader: 'Skater',
    columns: skaterColumns,
    sortKey: 'p',
    rows: (box.skatersByTeam[abbrFor(side)] ?? []).map((s) => ({ key: `${side}-${s.playerId}`, label: n.roster[String(s.playerId)]?.name ?? s.name, href: `/nhl/player/${s.playerId}`, imageUrl: faceOf(payload.gameId, abbrFor(side), s.playerId), imageKind: 'player' as const, values: { pos: s.position, g: s.goals, a: s.assists, p: s.points, sog: s.shots, hit: s.hits, blk: s.blockedShots } })),
  }));
  const skaters: ResearchCard = { kind: 'table', key: 'skaters', title: 'Skaters', labelHeader: 'Skater', columns: skaterColumns, rows: views[0].rows, views, sortKey: 'p' };
  const goalies: ResearchCard = {
    kind: 'table',
    key: 'goalies',
    title: 'Goaltending',
    labelHeader: 'Goalie',
    fixedOrder: true,
    columns: [
      { key: 'team', label: 'Team', decimals: 0 },
      { key: 'sa', label: 'Shots against', decimals: 0 },
      { key: 'sv', label: 'Saves', decimals: 0 },
      { key: 'ga', label: 'GA', decimals: 0 },
      { key: 'pct', label: 'Save %', decimals: 3, format: 'rate3' },
    ],
    rows: (['away', 'home'] as const).flatMap((side) =>
      (box.goaliesByTeam[abbrFor(side)] ?? [])
        .filter((g) => g.saves + g.goalsAgainst > 0)
        .map((g) => ({ key: `${side}-${g.playerId}`, label: n.roster[String(g.playerId)]?.name ?? g.name, href: `/nhl/player/${g.playerId}`, imageUrl: faceOf(payload.gameId, abbrFor(side), g.playerId), imageKind: 'player' as const, values: { team: payload[side].abbr, sa: g.saves + g.goalsAgainst, sv: g.saves, ga: g.goalsAgainst, pct: g.saves + g.goalsAgainst ? g.saves / (g.saves + g.goalsAgainst) : null } })),
    ),
    caption: 'Goalies who faced a shot. Empty-net goals count against no goalie.',
  };
  const pens = n.events.filter((e) => e.type === 'penalty');
  const penalties: ResearchCard = {
    kind: 'table',
    key: 'penalties',
    title: 'Penalties',
    scope: `${pens.length} called`,
    labelHeader: 'When',
    fixedOrder: true,
    emptyText: 'No penalties',
    columns: [
      { key: 'team', label: 'Team', decimals: 0 },
      { key: 'what', label: 'Infraction', decimals: 0, text: true },
      { key: 'min', label: 'Min', decimals: 0 },
    ],
    rows: pens.map((e, i) => ({ key: `p${i}`, label: `${periodLabel(e)} ${e.timeInPeriod ?? ''}`, values: { team: sideOf(e) ? payload[sideOf(e)!].abbr : '', what: (e.penalty ?? '').replace(/-/g, ' '), min: e.penaltyMinutes } })),
  };
  return { id: 'box', navLabel: 'Box score', title: 'Box score', rows: [[skaters], [goalies, penalties]], state: { kind: 'ready' } };
}

function nhlLinesSection(payload: Payload, state: GameState): ResearchSection {
  const n = payload.nhl;
  const final = state === 'final';
  const l = n.lines;
  const priced = (line: number | null, odds: number | null) => (line == null && odds == null ? '—' : `${line != null ? `${signedLine(line)} ` : ''}${am(odds)}`);
  const lineRows: ResearchTableRow[] = l
    ? [
        { key: 'ml-away', label: `Moneyline · ${payload.away.abbr}`, values: { open: am(l.moneyline.away.open), close: am(l.moneyline.away.close) } },
        { key: 'ml-home', label: `Moneyline · ${payload.home.abbr}`, values: { open: am(l.moneyline.home.open), close: am(l.moneyline.home.close) } },
        { key: 'pl-away', label: `Puck line · ${payload.away.abbr}`, values: { open: priced(l.spread.away.line.open, l.spread.away.odds.open), close: priced(l.spread.away.line.close, l.spread.away.odds.close) } },
        { key: 'pl-home', label: `Puck line · ${payload.home.abbr}`, values: { open: priced(l.spread.home.line.open, l.spread.home.odds.open), close: priced(l.spread.home.line.close, l.spread.home.odds.close) } },
        { key: 'to-over', label: 'Total · over', values: { open: priced(l.total.over.line.open, l.total.over.odds.open).replace(/^\+/, ''), close: priced(l.total.over.line.close, l.total.over.odds.close).replace(/^\+/, '') } },
        { key: 'to-under', label: 'Total · under', values: { open: priced(l.total.under.line.open, l.total.under.odds.open).replace(/^\+/, ''), close: priced(l.total.under.line.close, l.total.under.odds.close).replace(/^\+/, '') } },
      ].filter((r) => r.values.open !== '—' || r.values.close !== '—')
    : [];
  const stored = n.storedLines.find((x) => x.market === 'moneyline');
  if (stored?.close) {
    for (const s of stored.close.sides) {
      const o = stored.open?.sides.find((x) => x.side === s.side);
      lineRows.push({ key: `stored-${s.side}`, label: `Moneyline · ${payload[s.side as Side]?.abbr ?? s.side} · ${stored.close.books} books`, values: { open: am(o?.americanOdds), close: am(s.americanOdds) } });
    }
  }
  const lines: ResearchCard = {
    kind: 'table',
    key: 'game-lines',
    title: 'Game lines',
    scope: 'open to the last quote before puck drop',
    labelHeader: 'Market',
    fixedOrder: true,
    emptyText: 'No game lines held for this game',
    columns: [
      { key: 'open', label: 'Open', decimals: 0 },
      { key: 'close', label: 'Close', decimals: 0 },
    ],
    rows: lineRows,
    caption: `${l?.provider ?? 'DraftKings'} through ESPN${stored?.close ? '; rows with a book count are the median across stored books' : ''}.`,
  };
  const ss = n.seasonSeries;
  const series: ResearchCard = {
    kind: 'table',
    key: 'season-series',
    title: 'Season series',
    scope: ss.awayWins != null && ss.homeWins != null ? `${payload.away.abbr} ${ss.awayWins} · ${payload.home.abbr} ${ss.homeWins}` : undefined,
    labelHeader: 'Date',
    fixedOrder: true,
    emptyText: 'No season series for these teams',
    columns: [
      { key: 'at', label: 'At', decimals: 0 },
      { key: 'score', label: 'Score', decimals: 0 },
    ],
    rows: ss.games.map((g) => ({
      key: g.id,
      label: new Date(`${g.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
      href: g.id !== payload.gameId ? `/nhl/game/${g.id}` : null,
      highlight: g.id === payload.gameId,
      values: { at: g.home.abbr, score: g.away.score != null && g.home.score != null ? `${g.away.abbr} ${g.away.score} · ${g.home.abbr} ${g.home.score}` : 'To play' },
    })),
  };
  const props = n.props.filter((p) => p.books >= 2 && (!final || p.result != null));
  const propsCard: ResearchCard = {
    kind: 'table',
    key: 'props',
    title: final ? 'Props against results' : 'Player props',
    scope: final ? 'main line at puck drop against the box score' : 'main line, both sides quoted',
    labelHeader: 'Player',
    emptyText: 'No player props held for this game',
    sortKey: final ? undefined : 'books',
    columns: [
      { key: 'market', label: 'Market', decimals: 0, text: true },
      { key: 'line', label: 'Line', decimals: 1 },
      { key: 'over', label: 'Best over', decimals: 0 },
      { key: 'books', label: 'Books', decimals: 0 },
      ...(final ? [{ key: 'result', label: 'Result', decimals: 0 }, { key: 'went', label: 'Went', decimals: 0 }] : []),
    ],
    rows: props.map((p) => ({
      key: `${p.playerId}-${p.market}`,
      label: p.name,
      imageUrl: faceOf(payload.gameId, p.side ? payload[p.side].abbr : null, p.playerId),
      imageKind: 'player' as const,
      labelNote: p.side ? payload[p.side].abbr : null,
      href: `/nhl/player/${p.playerId}`,
      values: { market: NHL_MARKET_LABELS[p.market] ?? p.market, line: p.line == null ? 'yes/no' : p.line, over: `${am(p.over.price)} ${p.over.book}`, books: p.books, result: p.result, went: p.result == null ? null : p.result > lineOf(p) ? 'Over' : p.result < lineOf(p) ? 'Under' : 'Push' },
    })),
    caption: 'Markets with one book quoting both sides are left out.',
  };
  return { id: 'lines', navLabel: final ? 'Lines & props' : 'Lines', title: final ? 'Lines & props' : 'Lines', rows: [[lines, series], [propsCard]], state: { kind: 'ready' } };
}

function nhlPlaysSection(payload: Payload): ResearchSection | null {
  const n = payload.nhl;
  const events = n.events.filter((e) => SHOT_TYPES.includes(e.type) || e.type === 'penalty');
  if (!events.length) return null;
  const name = (id: number | null) => (id == null ? '' : n.roster[String(id)]?.name ?? '');
  const columns: ResearchColumn[] = [
    { key: 'team', label: 'Team', decimals: 0 },
    { key: 'what', label: 'Event', decimals: 0, text: true },
    { key: 'score', label: `${payload.away.abbr}–${payload.home.abbr}`, decimals: 0 },
  ];
  const row = (e: NhlEvent, i: number): ResearchTableRow => ({
    key: `e${i}`,
    label: `${periodLabel(e)} ${e.timeInPeriod ?? ''}`,
    imageUrl: sideOf(e) ? payload[sideOf(e)!].logoUrl : null,
    values: { team: sideOf(e) ? payload[sideOf(e)!].abbr : '', what: e.type === 'penalty' ? `Penalty: ${(e.penalty ?? '').replace(/-/g, ' ')} (${e.penaltyMinutes ?? '?'} min)` : `${SHOT_LABEL[e.type]}${name(e.shooterId) ? ` · ${name(e.shooterId)}` : ''}${e.shotType ? ` (${e.shotType})` : ''}`, score: e.type === 'goal' ? `${e.awayScore ?? '—'}–${e.homeScore ?? '—'}` : '' },
    ...(e.type === 'goal' ? { highlight: true } : {}),
  });
  const goalsAndPens = events.filter((e) => e.type === 'goal' || e.type === 'penalty');
  const views = [
    { key: 'all', label: `Shots and penalties · ${events.length}`, labelHeader: 'When', columns, rows: events.map(row) },
    { key: 'key', label: `Goals and penalties · ${goalsAndPens.length}`, labelHeader: 'When', columns, rows: goalsAndPens.map(row) },
  ];
  return { id: 'plays', navLabel: 'Play-by-play', title: 'Play-by-play', sub: 'goals, shots and penalties', rows: [[{ kind: 'table', key: 'plays', title: 'Events', scope: 'goals shaded', labelHeader: 'When', columns, rows: views[0].rows, views, fixedOrder: true }]], state: { kind: 'ready' } };
}

function nhlMatchupSection(payload: Payload, state: GameState): ResearchSection {
  return matchupSection({
    away: payload.away,
    home: payload.home,
    state,
    pre: payload.nhl.pregame,
    words: { attack: 'offense', defend: 'defense', unit: 'goal', pool: 'all 32 teams', gameHref: (id) => `/nhl/game/${id}`, h2hCaption: 'Regular season and playoffs, newest first. A shootout decides a winner without adding a goal.' },
  });
}

function nhlPlayersSection(payload: Payload, state: GameState): ResearchSection | null {
  const n = payload.nhl;
  return propHistorySection({
    away: payload.away,
    home: payload.home,
    state,
    props: n.props.filter((p) => p.books >= 2).map((p) => ({ key: `${p.playerId}-${p.market}`, name: p.name, href: `/nhl/player/${p.playerId}`, imageUrl: faceOf(payload.gameId, p.side ? payload[p.side].abbr : null, p.playerId), side: p.side, marketLabel: NHL_MARKET_LABELS[p.market] ?? p.market, line: lineOf(p), books: p.books, history: n.pregame.propHistory[`${p.playerId}|${p.market}`] ?? [] })),
  });
}

function nhlInjuriesSection(payload: Payload): ResearchSection | null {
  const report = payload.nhl.injuries;
  if (!report) return null;
  // ESPN's injury report names ESPN teams; the page's teams are NHL ids, so sides are matched on abbreviation.
  const view = (side: Side) => {
    const team = report.teams.find((t) => (t.abbr ?? '').toUpperCase() === payload[side].abbr.toUpperCase());
    return {
      key: side,
      label: `${payload[side].abbr} · ${team?.items.length ?? 0}`,
      labelHeader: 'Player',
      columns: [
        { key: 'pos', label: 'Pos', decimals: 0 },
        { key: 'status', label: 'Status', decimals: 0, text: true },
        { key: 'detail', label: 'Injury', decimals: 0, text: true },
      ] as ResearchColumn[],
      rows: (team?.items ?? []).map((i, k) => ({ key: i.athleteId ?? `${side}-${k}`, label: i.name ?? '—', values: { pos: i.position, status: i.status, detail: [i.type, i.detail].filter(Boolean).join(' · ') || '—' } })),
    };
  };
  const views = [view('away'), view('home')];
  if (!views.some((v) => v.rows.length)) return null;
  return { id: 'injuries', navLabel: 'Injuries', title: 'Injuries', rows: [[{ kind: 'table', key: 'injuries', title: 'Injury report', scope: 'as ESPN reports it now', labelHeader: 'Player', columns: views[0].columns, rows: views[0].rows, views, fixedOrder: true }]], state: { kind: 'ready' } };
}

function nhlNowSection(payload: Payload): ResearchSection {
  const n = payload.nhl;
  const last = [...n.events].reverse().find((e) => SHOT_TYPES.includes(e.type) || e.type === 'penalty');
  const sog = n.teamStats.find((s) => s.key === 'sog');
  const rows: ResearchCard[][] = [
    [
      {
        kind: 'table',
        key: 'situation',
        title: 'The game now',
        scope: payload.statusText,
        labelHeader: '',
        fixedOrder: true,
        columns: [{ key: 'value', label: '', decimals: 0, text: true }],
        rows: [
          { key: 'score', label: 'Score', values: { value: `${payload.away.abbr} ${payload.away.score ?? 0} · ${payload.home.abbr} ${payload.home.score ?? 0}` } },
          ...(sog ? [{ key: 'sog', label: 'Shots on goal', values: { value: `${payload.away.abbr} ${sog.away} · ${payload.home.abbr} ${sog.home}` } }] : []),
          ...(last ? [{ key: 'last', label: 'Last event', values: { value: `${periodLabel(last)} ${last.timeInPeriod ?? ''} · ${last.type === 'penalty' ? `penalty, ${(last.penalty ?? '').replace(/-/g, ' ')}` : SHOT_LABEL[last.type]}` } }] : []),
        ],
      },
    ],
    [propsTrackerCard(n.props.map((p) => ({ key: `${p.playerId}-${p.market}`, name: p.name, href: `/nhl/player/${p.playerId}`, imageUrl: faceOf(payload.gameId, p.side ? payload[p.side].abbr : null, p.playerId), sideAbbr: p.side ? payload[p.side].abbr : null, marketLabel: NHL_MARKET_LABELS[p.market] ?? p.market, line: lineOf(p), books: p.books, result: p.result })))],
  ];
  if (n.live) {
    const l = n.lines;
    rows.push(
      inGameOddsCards({
        away: payload.away,
        home: payload.home,
        inGame: n.live.inGame,
        close: (market) => (l && market === 'moneyline' ? { sides: [{ side: 'away', point: null, americanOdds: l.moneyline.away.close }, { side: 'home', point: null, americanOdds: l.moneyline.home.close }] } : null),
        spreadLabel: 'Puck line',
        startWord: 'puck drop',
        scoredSince: () => null,
      }),
    );
  }
  return { id: 'now', navLabel: 'Right now', title: 'Right now', sub: 'refreshed every 15 seconds', rows, state: { kind: 'ready' } };
}
