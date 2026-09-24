/**
 * The MLB game page — R8.1. Moved out of `gameDetailAdapter.ts` in R11a, when
 * the old `GameDetail` component and that file's transforms for it were
 * deleted; every other sport already kept its game page in its own
 * `*GameResearch.ts`. Sections follow G2: before the first pitch, the shared
 * Matchup, the starters, Players and injuries; live, "Right now" first; final,
 * the flow, contact, at-bats, pitching, box score, lines and plays.
 *
 * Pure: no fetching, no JSX.
 */

import { marketLabel } from '@/lib/odds/props/marketLabels';
import type { MlbGameResearchPayload } from '@/lib/sports/mlb/gameResearch';
import { pitchMix, type AtBat, type MlbWinProbabilityPoint } from '@/lib/sports/mlb/liveFeedParsers';
import { buildGameHero, gameStates, resolveState, stateNote } from '@/lib/sports/shared/gameResearch';
import type { GameResearchData, GameState } from '@/lib/sports/shared/gameResearchShapes';
import { mlbHeadshot } from '@/lib/sports/shared/identity';
import type { ResearchCard, ResearchColumn, ResearchSection, ResearchTableRow } from '@/lib/sports/shared/playerResearchShapes';
import type { PregameStarter } from '@/lib/sports/mlb/statcastRollupShapes';
import { pitchTypeLabel } from '@/lib/sports/mlb/pitchProfileShapes';
import { TEAM_ABBR_BY_ID } from '@/lib/sports/mlb/teamAliases';
import { inGameOddsCards, matchupSection, propHistorySection, propsTrackerCard } from '@/lib/sports/shared/gameResearchSections';

const HIT_EVENTS = new Set(['single', 'double', 'triple', 'home_run']);
const am = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));
const halfLabel = (ab: AtBat) => `${ab.half === 'top' ? 'Top' : 'Bot'} ${ab.inning ?? ''}`.trim();

/**
 * MLB's game page for one state — R8.1. `requestedState` is the `?state=`
 * review override; the payload's own state is used unless the game can show
 * the one asked for (`resolveState`).
 */
export function toGameResearchData(input: { payload: MlbGameResearchPayload; requestedState?: string | null }): GameResearchData {
  const { payload } = input;
  const state = resolveState(payload, input.requestedState);
  const chips = mlbLineChips(payload, state);
  const wpNow = payload.mlb.winProbability[payload.mlb.winProbability.length - 1];
  if (state === 'live' && wpNow) chips.unshift({ label: `Win probability ${payload.home.abbr} ${Math.round(wpNow.home * 100)}%` });
  const sections: ResearchSection[] =
    state === 'pre' || state === 'postponed'
      ? mlbPreSections(payload, state)
      : state === 'live'
        ? [
            mlbNowSection(payload),
            mlbFlowSection(payload),
            mlbContactSection(payload),
            mlbAtBatSection(payload),
            mlbPitchingSection(payload),
            mlbBoxSection(payload),
            mlbPlaysSection(payload),
            // Lines & props waits for the final: in play, the props tracker and in-game odds say it.
            ...mlbComingInSections(payload, state),
          ].filter((s): s is ResearchSection => s !== null)
      : [
          mlbFlowSection(payload),
          mlbContactSection(payload),
          mlbAtBatSection(payload),
          mlbPitchingSection(payload),
          mlbBoxSection(payload),
          mlbLinesSection(payload, state),
          mlbPlaysSection(payload),
          // The research as it read at the start stays below the recap.
          ...mlbComingInSections(payload, state),
        ].filter((s): s is ResearchSection => s !== null);
  return {
    state,
    states: gameStates(payload.state),
    hero: buildGameHero(payload, state, chips),
    stateNote: stateNote(state, payload.state),
    sections,
    sources: payload.sources,
  };
}

function closeOf(payload: MlbGameResearchPayload, market: 'moneyline' | 'spread' | 'total') {
  return payload.mlb.lines.find((l) => l.market === market)?.close ?? null;
}

/** Closing lines, and once final what the game did against them: "KC +1.5 covered", "Total 8.5 · under". */
export function mlbLineChips(payload: MlbGameResearchPayload, state: GameState): GameResearchData['hero']['chips'] {
  const out: GameResearchData['hero']['chips'] = [];
  const final = state === 'final' && payload.away.score != null && payload.home.score != null;
  const a = payload.away.score ?? 0;
  const h = payload.home.score ?? 0;
  const ml = closeOf(payload, 'moneyline');
  if (ml) {
    const pa = ml.sides.find((s) => s.side === 'away')?.americanOdds;
    const ph = ml.sides.find((s) => s.side === 'home')?.americanOdds;
    out.push({ label: `ML ${payload.away.abbr} ${am(pa)} · ${payload.home.abbr} ${am(ph)}` });
  }
  const rl = closeOf(payload, 'spread');
  const awayRl = rl?.sides.find((s) => s.side === 'away');
  if (awayRl?.point != null) {
    const margin = a - h + awayRl.point;
    const who = `${payload.away.abbr} ${awayRl.point > 0 ? '+' : ''}${awayRl.point}`;
    out.push({ label: final ? `${who} ${margin > 0 ? 'covered' : margin < 0 ? 'did not cover' : 'push'}` : who });
  }
  const tot = closeOf(payload, 'total');
  const point = tot?.sides[0]?.point;
  if (point != null) {
    const sum = a + h;
    out.push({ label: final ? `Total ${point} · ${sum > point ? 'over' : sum < point ? 'under' : 'push'} (${sum})` : `Total ${point}` });
  }
  return out;
}

function mlbFlowSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const m = payload.mlb;
  const byIndex = new Map(m.atBats.map((ab) => [ab.index, ab]));
  const points = m.winProbability.map((w) => ({ w, ab: byIndex.get(w.atBatIndex) })).filter((x): x is { w: MlbWinProbabilityPoint; ab: AtBat } => x.ab != null);
  const base = { id: 'flow', navLabel: 'Game flow', title: 'Game flow', sub: 'win probability after every plate appearance' };
  if (points.length < 2) {
    return { ...base, rows: [], state: { kind: 'empty', title: 'No win probability for this game', reason: 'MLB Stats API publishes it once the game has plate appearances.' } };
  }
  const xLabels = points.map(({ ab }, i) => (i === 0 || ab.inning !== points[i - 1].ab.inning ? String(ab.inning ?? '') : ''));
  const card: ResearchCard = {
    kind: 'series',
    key: 'wp',
    title: `${payload.home.abbr} win probability`,
    scope: `${points.length} plate appearances · x-axis is innings`,
    values: points.map(({ w }) => Math.round(w.home * 1000) / 10),
    xLabels,
    reference: { value: 50, label: 'even' },
    zeroBased: true,
    min: 0,
    max: 100,
    decimals: 0,
    unit: '%',
    tips: points.map(({ w, ab }) => [
      `${payload.home.abbr} ${(w.home * 100).toFixed(0)}%`,
      `${halfLabel(ab)} · ${payload.away.abbr} ${ab.awayScore ?? '—'}–${ab.homeScore ?? '—'} ${payload.home.abbr}`,
      `${ab.batter ?? ''}: ${ab.description ?? ab.event ?? ''}`,
    ]),
    caption: `Above 50 favours ${payload.home.name}, below it ${payload.away.name}. MLB Stats API win probability.`,
  };
  return { ...base, rows: [[card]], state: { kind: 'ready' } };
}

function battedBalls(payload: MlbGameResearchPayload) {
  return payload.mlb.atBats
    .filter((ab) => ab.battedBall?.coordX != null && ab.battedBall?.coordY != null)
    .map((ab) => ({
      ab,
      team: ab.half === 'top' ? payload.away.abbr : payload.home.abbr,
      x: (ab.battedBall!.coordX! - 125.42) * 2.5,
      y: (198.27 - ab.battedBall!.coordY!) * 2.5,
      hit: HIT_EVENTS.has(ab.eventType ?? ''),
    }));
}

function mlbContactSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const balls = battedBalls(payload);
  const base = { id: 'contact', navLabel: 'Batted balls', title: 'Batted balls', sub: 'every ball in play, with exit velocity and distance' };
  if (!balls.length) return { ...base, rows: [], state: { kind: 'empty', title: 'No batted balls located yet', reason: 'The live feed places a ball in play once it is recorded.' } };
  const spray: ResearchCard = {
    kind: 'scatter',
    key: 'spray',
    title: 'Spray chart',
    scope: 'filled = hit · ring = out · size = exit velocity',
    surface: 'spray',
    points: balls.map((b) => [b.team, b.x, b.y]),
    weights: balls.map((b) => b.ab.battedBall?.exitVelocity ?? 70),
    emphasis: balls.map((b) => b.hit),
    tips: balls.map((b) => [
      `${b.ab.event ?? ''} · ${b.ab.batter ?? ''}`,
      halfLabel(b.ab),
      `${b.ab.battedBall?.exitVelocity ?? '—'} mph · ${b.ab.battedBall?.launchAngle ?? '—'}° · ${b.ab.battedBall?.distance ?? '—'} ft`,
      `off ${b.ab.pitcher ?? ''}`,
    ]),
    groups: [payload.away.abbr, payload.home.abbr].map((t) => ({ key: t, label: t, count: balls.filter((b) => b.team === t).length })),
    defaultVisible: [payload.away.abbr, payload.home.abbr],
    caption: 'A generic park outline, not this park’s walls.',
  };
  const longest: ResearchCard = {
    kind: 'table',
    key: 'longest',
    title: 'Longest batted balls',
    scope: 'projected distance',
    labelHeader: 'Batter',
    sortKey: 'dist',
    columns: [
      { key: 'result', label: 'Result', decimals: 0 },
      { key: 'dist', label: 'Ft', decimals: 0 },
      { key: 'ev', label: 'EV', decimals: 1 },
      { key: 'la', label: 'LA', decimals: 0 },
    ],
    rows: balls
      .filter((b) => b.ab.battedBall?.distance != null)
      .sort((x, y) => (y.ab.battedBall!.distance ?? 0) - (x.ab.battedBall!.distance ?? 0))
      .slice(0, 12)
      .map((b) => ({
        key: String(b.ab.index),
        label: b.ab.batter ?? '',
        labelNote: b.team,
        href: b.ab.batterId ? `/mlb/player/${b.ab.batterId}` : null,
        imageUrl: mlbHeadshot(b.ab.batterId),
        imageKind: 'player' as const,
        values: { result: b.ab.event, dist: b.ab.battedBall!.distance, ev: b.ab.battedBall!.exitVelocity, la: b.ab.battedBall!.launchAngle },
      })),
  };
  return { ...base, rows: [[spray, longest]], state: { kind: 'ready' } };
}

function mlbAtBatSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const abs = payload.mlb.atBats.filter((ab) => ab.batter);
  const base = { id: 'atbats', navLabel: 'At-bats', title: 'At-bat explorer', sub: 'every pitch, located' };
  if (!abs.length) return { ...base, rows: [], state: { kind: 'empty', title: 'No plate appearances yet', reason: 'The feed lists each plate appearance as it happens.' } };
  const opening = abs.find((ab) => ab.eventType === 'home_run') ?? abs.find((ab) => ab.scoring) ?? abs[0];
  const drill: ResearchCard = {
    kind: 'drilldown',
    key: 'explorer',
    title: 'Plate appearances',
    scope: `${abs.length} · pick one`,
    defaultKey: String(opening.index),
    items: abs.map((ab) => {
      const types = [...new Set(ab.pitches.map((p) => p.type ?? 'unknown'))];
      const bb = ab.battedBall;
      const located = ab.pitches.map((p, i) => ({ p, i })).filter(({ p }) => p.pX != null && p.pZ != null);
      const plot: ResearchCard = {
        kind: 'scatter',
        key: 'zone',
        title: `${ab.batter} vs ${ab.pitcher}`,
        scope: `${halfLabel(ab)} · ${ab.outs ?? 0} out · bats ${ab.bats ?? '—'} / throws ${ab.throws ?? '—'}`,
        surface: 'zone',
        points: located.map(({ p }) => [p.type ?? 'unknown', p.pX!, p.pZ!]),
        labels: located.map(({ i }) => String(i + 1)),
        tips: located.map(({ p, i }) => [`${i + 1}. ${p.typeName ?? p.type ?? 'Pitch'} ${p.speed ?? '—'} mph`, `${p.call ?? ''} · count ${p.balls ?? 0}-${p.strikes ?? 0}`]),
        groups: types.map((t) => ({ key: t, label: ab.pitches.find((p) => (p.type ?? 'unknown') === t)?.typeName ?? t, count: ab.pitches.filter((p) => (p.type ?? 'unknown') === t).length })),
        defaultVisible: types,
        caption: `${ab.event ?? ''} — ${ab.description ?? ''}`,
      };
      const table: ResearchCard = {
        kind: 'table',
        key: 'pitches',
        title: 'Pitches',
        scope: bb ? `${bb.exitVelocity ?? '—'} mph · ${bb.launchAngle ?? '—'}° · ${bb.distance ?? '—'} ft` : undefined,
        labelHeader: '#',
        fixedOrder: true,
        columns: [
          { key: 'type', label: 'Pitch', decimals: 0 },
          { key: 'mph', label: 'mph', decimals: 1 },
          { key: 'call', label: 'Result', decimals: 0 },
          { key: 'count', label: 'Count', decimals: 0 },
        ],
        rows: ab.pitches.map((p, i) => ({ key: String(i), label: String(i + 1), values: { type: p.typeName ?? p.type, mph: p.speed, call: p.call, count: `${p.balls ?? 0}-${p.strikes ?? 0}` } })),
      };
      return {
        key: String(ab.index),
        group: halfLabel(ab),
        label: ab.batter ?? '',
        sub: `${ab.event ?? '…'} · vs ${ab.pitcher ?? ''}`,
        badge: ab.scoring ? `${ab.awayScore}–${ab.homeScore}` : `${ab.pitches.length}p`,
        imageUrl: mlbHeadshot(ab.batterId),
        cards: [plot, table],
      };
    }),
  };
  return { ...base, rows: [[drill]], state: { kind: 'ready' } };
}

function mlbPitchingSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const box = payload.mlb.box;
  const base = { id: 'pitching', navLabel: 'Pitching', title: 'Pitching' };
  if (!box) return null;
  const all = [
    ...box.away.pitching.map((p) => ({ p, team: payload.away.abbr })),
    ...box.home.pitching.map((p) => ({ p, team: payload.home.abbr })),
  ];
  const lines: ResearchCard = {
    kind: 'table',
    key: 'lines',
    title: 'Pitching lines',
    scope: 'in the order they pitched',
    labelHeader: 'Pitcher',
    fixedOrder: true,
    columns: [
      { key: 'ip', label: 'IP', decimals: 0 },
      { key: 'h', label: 'H', decimals: 0 },
      { key: 'er', label: 'ER', decimals: 0 },
      { key: 'bb', label: 'BB', decimals: 0 },
      { key: 'k', label: 'K', decimals: 0 },
      { key: 'hr', label: 'HR', decimals: 0 },
      { key: 'ps', label: 'P-S', decimals: 0 },
      { key: 'era', label: 'ERA', decimals: 0, info: 'Season ERA through this game' },
    ],
    rows: all.map(({ p, team }) => ({
      key: `${team}-${p.id}`,
      label: p.name,
      labelNote: [team, p.note].filter(Boolean).join(' '),
      href: `/mlb/player/${p.id}`,
      imageUrl: mlbHeadshot(p.id),
      imageKind: 'player' as const,
      values: { ip: p.s.ip, h: p.s.h, er: p.s.er, bb: p.s.bb, k: p.s.k, hr: p.s.hr, ps: `${p.s.pitches}-${p.s.strikes}`, era: p.season.era },
    })),
  };
  const mixViews = all
    .map(({ p, team }) => ({ p, team, mix: pitchMix(payload.mlb.atBats, p.id) }))
    .filter((v) => v.mix.length)
    .map(({ p, team, mix }) => ({
      key: String(p.id),
      label: `${team} · ${p.name.split(' ').slice(-1)[0]}`,
      labelHeader: 'Pitch',
      columns: [
        { key: 'n', label: 'Thrown', decimals: 0 },
        { key: 'share', label: 'Share', decimals: 0, format: 'percent' as const },
        { key: 'mph', label: 'Avg mph', decimals: 1 },
        { key: 'strike', label: 'Strike %', decimals: 0, format: 'percent' as const, info: 'Called, swinging and foul strikes and balls in play, over pitches' },
      ],
      rows: mix.map((r) => ({ key: r.type, label: r.typeName ?? r.type, values: { n: r.count, share: r.share, mph: r.avgSpeed, strike: 100 * r.strikeRate } })),
    }));
  const rows: ResearchCard[][] = [[lines]];
  if (mixViews.length) {
    rows.push([
      {
        kind: 'table',
        key: 'mix',
        title: 'Pitch mix',
        scope: 'this game, from the pitch feed',
        labelHeader: mixViews[0].labelHeader,
        columns: mixViews[0].columns,
        rows: mixViews[0].rows,
        views: mixViews,
        fixedOrder: true,
      },
    ]);
  }
  return { ...base, rows, state: { kind: 'ready' } };
}

function mlbBoxSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const box = payload.mlb.box;
  if (!box) return null;
  const maxEv = new Map<number, number>();
  for (const ab of payload.mlb.atBats) {
    const ev = ab.battedBall?.exitVelocity;
    if (ab.batterId != null && ev != null) maxEv.set(ab.batterId, Math.max(maxEv.get(ab.batterId) ?? 0, ev));
  }
  const view = (team: typeof box.away, abbr: string) => ({
    key: abbr,
    label: abbr,
    labelHeader: 'Batter',
    columns: [
      { key: 'ab', label: 'AB', decimals: 0 },
      { key: 'r', label: 'R', decimals: 0 },
      { key: 'h', label: 'H', decimals: 0, bar: true, leader: 'high' as const },
      { key: 'rbi', label: 'RBI', decimals: 0 },
      { key: 'hr', label: 'HR', decimals: 0 },
      { key: 'bb', label: 'BB', decimals: 0 },
      { key: 'k', label: 'K', decimals: 0 },
      { key: 'lob', label: 'LOB', decimals: 0 },
      { key: 'avg', label: 'AVG', decimals: 0, info: 'Season, through this game' },
      { key: 'ops', label: 'OPS', decimals: 0, info: 'Season, through this game' },
      { key: 'ev', label: 'Max EV', decimals: 1 },
    ],
    rows: team.batting.map((b) => ({
      key: String(b.id),
      label: b.name,
      labelNote: `${b.sub ? '↳ ' : ''}${b.pos ?? ''}`,
      href: `/mlb/player/${b.id}`,
      imageUrl: mlbHeadshot(b.id),
      imageKind: 'player' as const,
      values: { ab: b.s.ab, r: b.s.r, h: b.s.h, rbi: b.s.rbi, hr: b.s.hr, bb: b.s.bb, k: b.s.k, lob: b.s.lob, avg: b.season.avg, ops: b.season.ops, ev: maxEv.get(b.id) ?? null },
    })),
  });
  const views = [view(box.away, payload.away.abbr), view(box.home, payload.home.abbr)];
  return {
    id: 'box',
    navLabel: 'Box score',
    title: 'Box score',
    rows: [[{ kind: 'table', key: 'batting', title: 'Batting', scope: '↳ entered as a substitute', labelHeader: 'Batter', columns: views[0].columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

function mlbLinesSection(payload: MlbGameResearchPayload, state: GameState): ResearchSection {
  const final = state === 'final';
  const quote = (market: string, s: { point: number | null; americanOdds: number | null } | undefined) =>
    s ? `${s.point != null ? `${market === 'spread' && s.point > 0 ? '+' : ''}${s.point} ` : ''}${am(s.americanOdds)}` : '—';
  const label = (market: string, side: string) =>
    market === 'moneyline' ? `Moneyline · ${side === 'away' ? payload.away.abbr : payload.home.abbr}` : market === 'spread' ? `Run line · ${side === 'away' ? payload.away.abbr : payload.home.abbr}` : `Total · ${side}`;
  const lineRows = payload.mlb.lines.flatMap((l) =>
    (l.close ?? l.open)!.sides.map((s) => ({
      key: `${l.market}-${s.side}`,
      label: label(l.market, s.side),
      values: { open: quote(l.market, l.open?.sides.find((x) => x.side === s.side)), close: quote(l.market, l.close?.sides.find((x) => x.side === s.side)), books: l.close?.books ?? l.open?.books ?? null },
    })),
  );
  const lines: ResearchCard = {
    kind: 'table',
    key: 'game-lines',
    title: 'Game lines',
    scope: 'open to the last quote before the start',
    labelHeader: 'Market',
    fixedOrder: true,
    emptyText: 'No game lines held for this game',
    columns: [
      { key: 'open', label: 'Open', decimals: 0 },
      { key: 'close', label: 'Close', decimals: 0 },
      { key: 'books', label: 'Books', decimals: 0 },
    ],
    rows: lineRows,
    caption: 'The main line: nearest even for a total, the most books for the run line, the median price across books.',
  };
  // One book quoting both sides is a price, not a market (+4000 / -20000 on a triple).
  const props = payload.mlb.props.filter((p) => p.books >= 2 && (!final || p.result != null));
  const propsCard: ResearchCard = {
    kind: 'table',
    key: 'props',
    title: final ? 'Props against results' : 'Player props',
    scope: final ? 'main line at the start against the box score' : 'main line, both sides quoted',
    labelHeader: 'Player',
    emptyText: 'No player props held for this game',
    sortKey: final ? undefined : 'books',
    columns: [
      { key: 'market', label: 'Market', decimals: 0, text: true },
      { key: 'line', label: 'Line', decimals: 1 },
      { key: 'over', label: 'Best over', decimals: 0 },
      { key: 'under', label: 'Best under', decimals: 0 },
      { key: 'books', label: 'Books', decimals: 0 },
      ...(final ? [{ key: 'result', label: 'Result', decimals: 0 }, { key: 'side', label: 'Went', decimals: 0 }] : []),
    ],
    rows: props.map((p) => ({
      key: `${p.playerId}-${p.market}`,
      label: p.name,
      labelNote: p.side === 'away' ? payload.away.abbr : p.side === 'home' ? payload.home.abbr : null,
      href: `/mlb/player/${p.playerId}`,
      imageUrl: mlbHeadshot(p.playerId),
      imageKind: 'player' as const,
      values: {
        market: marketLabel(p.market, 'mlb'),
        line: p.line,
        over: p.over ? `${am(p.over.price)} ${p.over.book}` : '—',
        under: p.under ? `${am(p.under.price)} ${p.under.book}` : '—',
        books: p.books,
        result: p.result,
        side: p.result == null ? null : p.result > p.line ? 'Over' : p.result < p.line ? 'Under' : 'Push',
      },
    })),
    caption: [
      payload.mlb.propsAltOnly ? `${payload.mlb.propsAltOnly} markets had only alternate lines quoted` : null,
      'markets with one book quoting both sides',
    ]
      .filter(Boolean)
      .join(' and ')
      .replace(/^./, (c) => c.toUpperCase()) + ' are left out.',
  };
  return { id: 'lines', navLabel: final ? 'Lines & props' : 'Lines', title: final ? 'Lines & props' : 'Lines', rows: [[lines], [propsCard]], state: { kind: 'ready' } };
}

function mlbPlaysSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const abs = payload.mlb.atBats.filter((ab) => ab.event);
  if (!abs.length) return null;
  const row = (ab: AtBat) => ({
    key: String(ab.index),
    label: ab.batter ?? '',
    labelNote: halfLabel(ab),
    imageUrl: mlbHeadshot(ab.batterId),
    imageKind: 'player' as const,
    values: { event: ab.event, detail: ab.description, score: `${ab.awayScore ?? '—'}–${ab.homeScore ?? '—'}` },
  });
  const columns = [
    { key: 'event', label: 'Result', decimals: 0, text: true },
    { key: 'detail', label: 'Play', decimals: 0, text: true },
    { key: 'score', label: `${payload.away.abbr}–${payload.home.abbr}`, decimals: 0 },
  ];
  const views = [
    { key: 'all', label: `Every plate appearance · ${abs.length}`, labelHeader: 'Batter', columns, rows: abs.map(row) },
    { key: 'scoring', label: `Scoring · ${abs.filter((a) => a.scoring).length}`, labelHeader: 'Batter', columns, rows: abs.filter((a) => a.scoring).map(row) },
  ];
  return {
    id: 'plays',
    navLabel: 'Play-by-play',
    title: 'Play-by-play',
    rows: [[{ kind: 'table', key: 'plays', title: 'Plays', labelHeader: 'Batter', columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

// ---------------------------------------------------------------------------
// R8.1b — the research as of the start
// ---------------------------------------------------------------------------

// StatsAPI has called the Athletics ATH since 2025; the shared alias map keeps OAK for older odds feeds.
const teamAbbr = (id: string | number) => (Number(id) === 133 ? 'ATH' : TEAM_ABBR_BY_ID[Number(id)] ?? String(id));
const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const lastName = (name: string | null, id: number) => (name ?? '').split(' ').slice(-1)[0] || String(id);

/** Before the start: the matchup, the starters, the players, injuries, the lines. */
function mlbPreSections(payload: MlbGameResearchPayload, state: GameState): ResearchSection[] {
  return [mlbMatchupSection(payload, state), mlbStartersSection(payload), mlbPlayersSection(payload, state), payload.state === 'pre' || payload.state === 'postponed' ? mlbInjuriesSection(payload) : null, mlbLinesSection(payload, state)].filter(
    (s): s is ResearchSection => s !== null,
  );
}

/** Below a live or final game: the same research as it read at the start, under its own ids. Injuries read as rosters stand now, so they stay off. */
function mlbComingInSections(payload: MlbGameResearchPayload, state: GameState): ResearchSection[] {
  return [mlbMatchupSection(payload, state), mlbStartersSection(payload), mlbPlayersSection(payload, state)]
    .filter((s): s is ResearchSection => s !== null)
    .map((s) => ({ ...s, id: `pre-${s.id}`, title: `${s.title} · at the start` }));
}

type Side = MlbGameResearchPayload['away'];

function mlbMatchupSection(payload: MlbGameResearchPayload, state: GameState): ResearchSection {
  return matchupSection({
    away: payload.away,
    home: payload.home,
    state,
    pre: payload.mlb.pregame,
    words: { attack: 'bats', defend: 'arms', unit: 'run', pool: 'all 30 teams', gameHref: (pk) => `/mlb/game/${pk}`, h2hCaption: 'Regular season, newest first.' },
  });
}

function mlbStartersSection(payload: MlbGameResearchPayload): ResearchSection {
  const base = { id: 'starters', navLabel: 'Starters', title: 'Starters & lineups' };
  const held = payload.mlb.pregame.starters;
  if (!held) {
    return {
      ...base,
      rows: [],
      state: {
        kind: 'empty',
        title: 'No starter research kept for this game',
        reason: 'The Statcast starters card is kept on the morning of a game. It began with games on 2026-09-11 and some days since are missing; this game has none, so its starters and their matchups are not shown.',
      },
    };
  }
  const sides = (['away', 'home'] as const).flatMap((side) => {
    const sp = held.payload.starters[side];
    return sp ? [{ team: payload[side], opp: payload[side === 'away' ? 'home' : 'away'], sp }] : [];
  });
  if (!sides.length) {
    return { ...base, rows: [], state: { kind: 'empty', title: 'No probable starters listed', reason: `Neither team had named a starter when the research was kept (Statcast through ${shortDay(held.asOf)}).` } };
  }
  const asOf = `Statcast through ${shortDay(held.asOf)}`;
  const who = (team: Side, sp: PregameStarter) => `${team.abbr} · ${lastName(sp.name, sp.id)}`;
  const withViews = (card: { key: string; title: string; scope: string; emptyText: string }, views: Array<{ key: string; label: string; labelHeader: string; columns: ResearchColumn[]; rows: ResearchTableRow[]; sortKey?: string }>, fixedOrder = true): ResearchCard => ({
    kind: 'table',
    ...card,
    labelHeader: views[0].labelHeader,
    columns: views[0].columns,
    rows: views[0].rows,
    sortKey: views[0].sortKey,
    views,
    fixedOrder,
  });

  const lineCard: ResearchCard = {
    kind: 'table',
    key: 'starters',
    title: 'Probable starters',
    scope: `${held.season} season · ${asOf}`,
    labelHeader: 'Pitcher',
    fixedOrder: true,
    columns: [
      { key: 'gs', label: 'GS', decimals: 0 },
      { key: 'ip', label: 'IP', decimals: 0 },
      { key: 'era', label: 'ERA', decimals: 2 },
      { key: 'whip', label: 'WHIP', decimals: 2 },
      { key: 'k', label: 'K', decimals: 0 },
      { key: 'bb', label: 'BB', decimals: 0 },
      { key: 'hr', label: 'HR', decimals: 0 },
      { key: 'kbb', label: 'K/BB', decimals: 2 },
    ],
    rows: sides.map(({ team, sp }) => ({
      key: String(sp.id),
      label: sp.name ?? String(sp.id),
      labelNote: [team.abbr, sp.hand ? `${sp.hand}HP` : null].filter(Boolean).join(' · '),
      href: `/mlb/player/${sp.id}`,
      imageUrl: mlbHeadshot(sp.id),
      imageKind: 'player' as const,
      values: { gs: sp.season.gs, ip: sp.season.ip, era: sp.season.era, whip: sp.season.whip, k: sp.season.k, bb: sp.season.bb, hr: sp.season.hr, kbb: sp.season.bb ? sp.season.k / sp.season.bb : null },
    })),
  };

  const logViews = sides.map(({ team, sp }) => ({
    key: String(sp.id),
    label: who(team, sp),
    labelHeader: 'Date',
    columns: [
      { key: 'opp', label: 'Opp', decimals: 0 },
      { key: 'ip', label: 'IP', decimals: 0 },
      { key: 'h', label: 'H', decimals: 0 },
      { key: 'er', label: 'ER', decimals: 0 },
      { key: 'bb', label: 'BB', decimals: 0 },
      { key: 'k', label: 'K', decimals: 0 },
    ],
    rows: [...sp.log].reverse().map(([date, opp, ip, hits, er, bb, k]) => ({ key: date, label: shortDay(date), values: { opp: teamAbbr(opp), ip: ip.toFixed(1), h: hits, er, bb, k } })),
  }));
  const mixViews = sides.map(({ team, sp }) => ({
    key: String(sp.id),
    label: who(team, sp),
    labelHeader: 'Pitch',
    columns: [
      { key: 'share', label: 'Share', decimals: 1, format: 'percent' as const },
      { key: 'velo', label: 'Avg mph', decimals: 1 },
      { key: 'whiff', label: 'Whiff', decimals: 1, format: 'percent' as const, info: 'Swinging strikes over swings' },
      { key: 'n', label: 'Thrown', decimals: 0 },
    ],
    // A pitch the feed left unclassified has no type code; it is not a pitch in the mix.
    rows: sp.mix.filter((x) => x.type && x.type !== '?').map((x) => ({ key: x.type, label: pitchTypeLabel(x.type), values: { share: x.share, velo: x.velo, whiff: x.whiff, n: x.n } })),
  }));
  const vsViews = sides.map(({ opp, sp }) => {
    const hand = sp.hand === 'L' ? 'left' : 'right';
    return {
      key: String(sp.id),
      label: `${opp.abbr} hitters vs ${lastName(sp.name, sp.id)}`,
      labelHeader: 'Hitter',
      sortKey: 'pa',
      columns: [
        { key: 'pa', label: 'PA', decimals: 0, info: 'Season plate appearances' },
        { key: 'avg', label: 'AVG', decimals: 3, format: 'rate3' as const },
        { key: 'obp', label: 'OBP', decimals: 3, format: 'rate3' as const },
        { key: 'slg', label: 'SLG', decimals: 3, format: 'rate3' as const },
        { key: 'hr', label: 'HR', decimals: 0 },
        { key: 'handAvg', label: `AVG v ${sp.hand ?? ''}HP`, decimals: 3, format: 'rate3' as const, info: `Season, against ${hand}-handed pitching` },
        { key: 'handK', label: `K% v ${sp.hand ?? ''}HP`, decimals: 1, format: 'percent' as const, info: `Season strikeout rate against ${hand}-handed pitching` },
        { key: 'xwobacon', label: 'xwOBAcon', decimals: 3, format: 'rate3' as const, info: `Expected wOBA on contact against ${hand}-handers` },
        { key: 'vsSp', label: 'vs him', decimals: 0, info: 'Against this pitcher in the Statcast corpus: hits-at-bats, then home runs and strikeouts' },
      ],
      rows: sp.vsLineup.map((x) => ({
        key: String(x.id),
        label: x.name ?? String(x.id),
        labelNote: [x.pos, x.bats ? `bats ${x.bats}` : null].filter(Boolean).join(' · '),
        href: `/mlb/player/${x.id}`,
        imageUrl: mlbHeadshot(x.id),
        imageKind: 'player' as const,
        values: {
          pa: x.season.pa,
          avg: x.season.avg,
          obp: x.season.obp,
          slg: x.season.slg,
          hr: x.season.hr,
          handAvg: x.vsHand.pa ? x.vsHand.avg : null,
          handK: x.vsHand.pa ? x.vsHand.k : null,
          xwobacon: x.vsHand.xwobacon,
          vsSp: x.vsPitcher.pa ? [`${x.vsPitcher.h}-${x.vsPitcher.ab}`, x.vsPitcher.hr ? `${x.vsPitcher.hr} HR` : null, x.vsPitcher.k ? `${x.vsPitcher.k} K` : null].filter(Boolean).join(', ') : '—',
        },
      })),
    };
  });

  return {
    ...base,
    rows: [
      [lineCard],
      [
        withViews({ key: 'log', title: 'Recent starts', scope: 'last six appearances, newest first', emptyText: 'No appearances this season' }, logViews),
        withViews({ key: 'mix', title: 'Pitch mix', scope: `season · ${asOf}`, emptyText: 'No pitches in the Statcast corpus' }, mixViews),
      ],
      [withViews({ key: 'vs', title: 'Hitters against the starter', scope: 'the active roster, not the posted lineup', emptyText: 'No hitters on record' }, vsViews, false)],
    ],
    note: sides.length < 2 ? `Only ${sides[0].team.abbr} had named a starter when the research was kept.` : undefined,
    state: { kind: 'ready' },
  };
}

function mlbPlayersSection(payload: MlbGameResearchPayload, state: GameState): ResearchSection | null {
  const m = payload.mlb;
  // A player's team: the box once there is one, else the starters card's rosters.
  const sideById = new Map<string, 'away' | 'home'>();
  const probable = m.pregame.starters?.payload.starters;
  for (const side of ['away', 'home'] as const) {
    const sp = probable?.[side];
    if (!sp) continue;
    sideById.set(String(sp.id), side);
    for (const x of sp.vsLineup) sideById.set(String(x.id), side === 'away' ? 'home' : 'away');
  }
  return propHistorySection({
    away: payload.away,
    home: payload.home,
    state,
    // One book quoting both sides is a price, not a market (as in Lines & props).
    props: m.props
      .filter((p) => p.books >= 2)
      .map((p) => ({
        key: `${p.playerId}-${p.market}`,
        name: p.name,
        href: `/mlb/player/${p.playerId}`,
        imageUrl: mlbHeadshot(p.playerId),
        side: p.side ?? sideById.get(p.playerId) ?? null,
        marketLabel: marketLabel(p.market, 'mlb'),
        line: p.line,
        books: p.books,
        history: m.pregame.propHistory[`${p.playerId}|${p.market}`] ?? [],
      })),
  });
}

/** Injuries read as the rosters stand now, so they show only while the game is still to come — not on a finished game reviewed as ?state=pre. */
function mlbInjuriesSection(payload: MlbGameResearchPayload): ResearchSection | null {
  const inj = payload.mlb.pregame.injuries;
  // StatsAPI's rosters name the list, rarely the injury; the column shows only when one does.
  const described = Object.values(inj).some((list) => list.some((e) => e.injury));
  const view = (team: Side) => ({
    key: team.abbr,
    label: `${team.abbr} · ${(inj[team.id] ?? []).length}`,
    labelHeader: 'Player',
    columns: [
      { key: 'pos', label: 'Pos', decimals: 0 },
      { key: 'status', label: 'Status', decimals: 0, text: true },
      ...(described ? [{ key: 'injury', label: 'Injury', decimals: 0, text: true }] : []),
    ],
    rows: (inj[team.id] ?? []).map((e) => ({
      key: String(e.playerId),
      label: e.playerName,
      href: `/mlb/player/${e.playerId}`,
      imageUrl: mlbHeadshot(e.playerId),
      imageKind: 'player' as const,
      values: { pos: e.position, status: e.status, injury: e.injury ?? '—' },
    })),
  });
  const views = [view(payload.away), view(payload.home)];
  if (!views.some((v) => v.rows.length)) return null;
  return {
    id: 'injuries',
    navLabel: 'Injuries',
    title: 'Injuries',
    rows: [[{ kind: 'table', key: 'injuries', title: 'Injured list and day-to-day', scope: 'as the rosters read now', labelHeader: 'Player', columns: views[0].columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

// ---------------------------------------------------------------------------
// R8.1c — while the game is on
// ---------------------------------------------------------------------------


function runners(b: { first: boolean; second: boolean; third: boolean }): string {
  const on = [b.first && '1st', b.second && '2nd', b.third && '3rd'].filter(Boolean) as string[];
  if (!on.length) return 'Bases empty';
  if (on.length === 3) return 'Bases loaded';
  return `${on.length === 1 ? 'Runner' : 'Runners'} on ${on.join(' and ')}`;
}

/** Where the game stands, the at-bat under way, each prop so far, and the books now. */
function mlbNowSection(payload: MlbGameResearchPayload): ResearchSection {
  const m = payload.mlb;
  const live = m.live;
  const rows: ResearchCard[][] = [];

  if (live) {
    const wp = m.winProbability[m.winProbability.length - 1];
    const text = (key: string, label: string, value: string, href?: string | null) => ({ key, label, href: href ?? null, values: { value } });
    const situation: ResearchCard = {
      kind: 'table',
      key: 'situation',
      title: 'The game now',
      scope: `${live.inning.half === 'top' ? 'Top' : 'Bottom'} of the ${live.inning.ordinal}`,
      labelHeader: '',
      fixedOrder: true,
      columns: [{ key: 'value', label: '', decimals: 0, text: true }],
      rows: [
        text('outs', 'Outs', String(live.outs)),
        text('count', 'Count', `${live.count.balls}-${live.count.strikes}`),
        text('bases', 'On base', runners(live.bases)),
        ...(live.batter ? [text('batter', 'At bat', `${live.batter.name} · ${live.batter.todayLine}`, `/mlb/player/${live.batter.id}`)] : []),
        ...(live.pitcher
          ? [text('pitcher', 'Pitching', `${live.pitcher.name} · ${live.pitcher.ip} IP, ${live.pitcher.h} H, ${live.pitcher.r} R, ${live.pitcher.k} K, ${live.pitcher.pitches} pitches`, `/mlb/player/${live.pitcher.id}`)]
          : []),
        ...(live.onDeck ? [text('deck', 'On deck', `${live.onDeck.name} · ${live.onDeck.todayLine}`, `/mlb/player/${live.onDeck.id}`)] : []),
        ...(wp ? [text('wp', 'Win probability', `${payload.home.abbr} ${(wp.home * 100).toFixed(1)}% · ${payload.away.abbr} ${(100 - wp.home * 100).toFixed(1)}%`)] : []),
      ],
    };
    // The plate appearance under way is the feed's last; between batters it is the one just finished.
    const ab = m.atBats[m.atBats.length - 1];
    const located = ab ? ab.pitches.map((p, i) => ({ p, i })).filter(({ p }) => p.pX != null && p.pZ != null) : [];
    const types = ab ? [...new Set(ab.pitches.map((p) => p.type ?? 'unknown'))] : [];
    const last = ab?.pitches[ab.pitches.length - 1];
    const atBat: ResearchCard | null =
      ab && located.length
        ? {
            kind: 'scatter',
            key: 'at-bat',
            title: `${ab.event ? 'Last' : 'Now'}: ${ab.batter} vs ${ab.pitcher}`,
            scope: last ? `last pitch ${last.typeName ?? last.type ?? ''} ${last.speed ?? '—'} mph, ${(last.call ?? '').toLowerCase()}` : undefined,
            surface: 'zone',
            points: located.map(({ p }) => [p.type ?? 'unknown', p.pX!, p.pZ!]),
            labels: located.map(({ i }) => String(i + 1)),
            tips: located.map(({ p, i }) => [`${i + 1}. ${p.typeName ?? p.type ?? 'Pitch'} ${p.speed ?? '—'} mph`, `${p.call ?? ''} · count ${p.balls ?? 0}-${p.strikes ?? 0}`]),
            groups: types.map((t) => ({ key: t, label: ab.pitches.find((p) => (p.type ?? 'unknown') === t)?.typeName ?? t, count: ab.pitches.filter((p) => (p.type ?? 'unknown') === t).length })),
            defaultVisible: types,
            caption: ab.event ? `${ab.event}: ${ab.description ?? ''}` : 'Catcher’s view. Numbers are the pitch order.',
          }
        : null;
    rows.push(atBat ? [situation, atBat] : [situation]);
  }

  rows.push([
    propsTrackerCard(
      m.props.map((p) => ({
        key: `${p.playerId}-${p.market}`,
        name: p.name,
        href: `/mlb/player/${p.playerId}`,
        imageUrl: mlbHeadshot(p.playerId),
        sideAbbr: p.side ? payload[p.side].abbr : null,
        marketLabel: marketLabel(p.market, 'mlb'),
        line: p.line,
        books: p.books,
        result: p.result,
      })),
    ),
  ]);

  const inGame = live?.inGame;
  if (inGame) {
    rows.push(
      inGameOddsCards({
        away: payload.away,
        home: payload.home,
        inGame,
        close: (market) => m.lines.find((l) => l.market === market)?.close ?? null,
        spreadLabel: 'Run line',
        startWord: 'the first pitch',
        // A plate appearance's score counts once the next one has begun: the feed stamps starts, not ends, and
        // 822763's run at 4:21 came in an at-bat that began before the 4:20 capture.
        scoredSince: (asOf) => {
          let scoreThen = 0;
          m.atBats.forEach((ab, i) => {
            const ended = m.atBats[i + 1]?.startTime;
            if (ended && ended <= asOf && ab.awayScore != null && ab.homeScore != null) scoreThen = ab.awayScore + ab.homeScore;
          });
          return { count: (payload.away.score ?? 0) + (payload.home.score ?? 0) - scoreThen, unit: 'run' };
        },
      }),
    );
  }

  return { id: 'now', navLabel: 'Right now', title: 'Right now', sub: 'refreshed every 15 seconds', rows, state: { kind: 'ready' } };
}
