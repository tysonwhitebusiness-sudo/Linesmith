/**
 * The NFL and CFB game page — R8.2. One builder for both leagues, exported as
 * `toGameResearchData` from each league's `gameDetailAdapter.ts` (the sport
 * adapter rule); the reader is `lib/sports/multiSport/footballGameResearch.ts`.
 * Sections follow G2 `game-football.js`: game flow (win probability, every
 * drive, one drive's plays), scoring and leaders, team stats, box score, lines
 * and props, play-by-play.
 *
 * Pure: no fetching, no JSX.
 */

import type { FootballBoxTeam, FootballGameResearchPayload } from '@/lib/sports/multiSport/footballGameResearch';
import type { Drive, FootballPlay } from '@/lib/sports/espn/summaryParsers';
import { buildGameHero, gameStates, resolveState, stateNote } from '@/lib/sports/shared/gameResearch';
import type { GameResearchData, GameState } from '@/lib/sports/shared/gameResearchShapes';
import type { ResearchCard, ResearchColumn, ResearchSection, ResearchTableRow } from '@/lib/sports/shared/playerResearchShapes';

type Payload = FootballGameResearchPayload;
type Side = 'away' | 'home';

export const FOOTBALL_MARKET_LABELS: Record<string, string> = {
  'passing-yards': 'Passing yards',
  'passing-tds': 'Passing TDs',
  completions: 'Completions',
  'pass-attempts': 'Pass attempts',
  'passing-attempts': 'Pass attempts',
  interceptions: 'Interceptions thrown',
  'rushing-yards': 'Rushing yards',
  'rushing-attempts': 'Rushing attempts',
  'receiving-yards': 'Receiving yards',
  receptions: 'Receptions',
  'longest-reception': 'Longest reception',
  'rush-rec-yards': 'Rush + rec yards',
  'pass-rush-yards': 'Pass + rush yards',
  tackles: 'Tackles',
  assists: 'Tackle assists',
  sacks: 'Sacks',
  'anytime-td': 'Anytime TD',
};

export const quarterName = (p: number | null) => (p == null ? '' : p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`);
const am = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));
const signedLine = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));

export function toGameResearchData(input: { payload: Payload; requestedState?: string | null }): GameResearchData {
  const { payload } = input;
  const state = resolveState(payload, input.requestedState);
  const chips = footballLineChips(payload, state);
  const wpNow = payload.football.winProbability[payload.football.winProbability.length - 1];
  if (state === 'live' && wpNow) chips.unshift({ label: `Win probability ${payload.home.abbr} ${Math.round(wpNow.home * 100)}%` });
  const sections: ResearchSection[] =
    state === 'pre' || state === 'postponed'
      ? [footballLinesSection(payload, state)]
      : [
          footballFlowSection(payload),
          footballScoringSection(payload),
          footballTeamStatsSection(payload),
          footballBoxSection(payload),
          footballLinesSection(payload, state),
          footballPlaysSection(payload),
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

const sideOfTeam = (payload: Payload, teamId: string | null): Side => (teamId === payload.home.id ? 'home' : 'away');
const abbrOf = (payload: Payload, teamId: string | null) => (teamId === payload.home.id ? payload.home.abbr : teamId === payload.away.id ? payload.away.abbr : '');

/** Closing lines from pickcenter, and once final what the game did against them: "DAL -3 did not cover", "Total 47.5 · over (48)". */
export function footballLineChips(payload: Payload, state: GameState): GameResearchData['hero']['chips'] {
  const l = payload.football.lines;
  if (!l) return [];
  const out: GameResearchData['hero']['chips'] = [];
  const final = state === 'final' && payload.away.score != null && payload.home.score != null;
  const a = payload.away.score ?? 0;
  const h = payload.home.score ?? 0;
  if (l.moneyline.away.close != null || l.moneyline.home.close != null) out.push({ label: `ML ${payload.away.abbr} ${am(l.moneyline.away.close)} · ${payload.home.abbr} ${am(l.moneyline.home.close)}` });
  const awaySpread = l.spread.away.line.close;
  if (awaySpread != null) {
    const margin = a - h + awaySpread;
    const who = `${payload.away.abbr} ${signedLine(awaySpread)}`;
    out.push({ label: final ? `${who} ${margin > 0 ? 'covered' : margin < 0 ? 'did not cover' : 'push'}` : who });
  }
  const total = l.total.over.line.close;
  if (total != null) out.push({ label: final ? `Total ${total} · ${a + h > total ? 'over' : a + h < total ? 'under' : 'push'} (${a + h})` : `Total ${total}` });
  return out;
}

// ---------------------------------------------------------------------------
// flow: win probability, every drive, one drive's plays
// ---------------------------------------------------------------------------

/** Yards from the LEFT goal line. A drive's `yardLine` counts from the HOME goal line (DAL 28 is 72 on DAL @ NYG). */
export const driveX = (yardLine: number | null) => (yardLine == null ? null : 100 - yardLine);
/** A play's `yardsToEndzone` is the offense's: the away team attacks the right end zone. */
export const playX = (side: Side, yardsToEndzone: number | null) => (yardsToEndzone == null ? null : side === 'away' ? 100 - yardsToEndzone : yardsToEndzone);

const NOT_MOVEMENT = /kickoff|punt|timeout|end of|extra point|two-point|coin toss/i;

function driveResult(d: Drive) {
  return d.shortResult ?? d.result ?? '';
}

function footballFlowSection(payload: Payload): ResearchSection | null {
  const f = payload.football;
  const base = { id: 'flow', navLabel: 'Game flow', title: 'Game flow', sub: 'win probability and every drive' };
  const rows: ResearchCard[][] = [];
  const wp = f.winProbability;
  if (wp.length >= 2) {
    rows.push([
      {
        kind: 'series',
        key: 'wp',
        title: `${payload.home.abbr} win probability`,
        scope: `${wp.length} plays · x-axis is quarters`,
        values: wp.map((p) => Math.round(p.home * 1000) / 10),
        xLabels: wp.map((p, i) => (i === 0 || p.period !== wp[i - 1].period ? quarterName(p.period) : '')),
        reference: { value: 50, label: 'even' },
        zeroBased: true,
        min: 0,
        max: 100,
        decimals: 0,
        unit: '%',
        tips: wp.map((p) => [`${payload.home.abbr} ${(p.home * 100).toFixed(0)}%`, `${quarterName(p.period)} ${p.clock ?? ''} · ${payload.away.abbr} ${p.awayScore ?? '—'}–${p.homeScore ?? '—'} ${payload.home.abbr}`, p.text ?? '']),
        caption: `Above 50 favours ${payload.home.name}, below it ${payload.away.name}. ESPN win probability${f.league === 'cfb' ? ', college model' : ''}.`,
      },
    ]);
  }
  const drives = f.drives.filter((d) => driveX(d.startYardLine) != null);
  if (drives.length) {
    const legend = [
      { label: `${payload.away.abbr} drives →`, side: 'away' as const },
      { label: `← ${payload.home.abbr} drives`, side: 'home' as const },
    ];
    rows.push([
      {
        kind: 'field',
        key: 'drives',
        title: 'Drive chart',
        scope: `${drives.length} drives · a bold lane scored`,
        ends: { left: payload.away.abbr, right: payload.home.abbr },
        rows: drives.map((d) => {
          const side = sideOfTeam(payload, d.teamId);
          const from = driveX(d.startYardLine)!;
          return {
            key: d.id,
            side,
            from,
            to: driveX(d.endYardLine) ?? from,
            label: driveResult(d) || null,
            strong: d.isScore,
            tip: [`${abbrOf(payload, d.teamId)} · ${d.result ?? ''}`, `${quarterName(d.period)} ${d.clock ?? ''} · ${d.offensivePlays ?? 0} plays, ${d.yards ?? 0} yds, ${d.timeElapsed ?? ''}`, `${d.startText ?? ''} → ${d.endText ?? '—'}`],
          };
        }),
        legend,
      },
    ]);
    const opening = drives.find((d) => d.isScore) ?? drives[0];
    rows.push([
      {
        kind: 'drilldown',
        key: 'drive-explorer',
        title: 'Drives',
        scope: `${drives.length} · pick one`,
        defaultKey: opening.id,
        items: drives.map((d) => {
          const side = sideOfTeam(payload, d.teamId);
          const moving = d.plays.filter((p) => p.startYardsToEndzone != null && p.endYardsToEndzone != null && !NOT_MOVEMENT.test(`${p.type ?? ''} ${p.text ?? ''}`));
          const last = d.plays[d.plays.length - 1];
          const cards: ResearchCard[] = [];
          if (moving.length) {
            cards.push({
              kind: 'field',
              key: 'drive-field',
              title: `${abbrOf(payload, d.teamId)} drive · ${d.result ?? ''}`,
              scope: `${quarterName(d.period)} ${d.clock ?? ''} · ${d.offensivePlays ?? 0} plays, ${d.yards ?? 0} yds, ${d.timeElapsed ?? ''}`,
              ends: { left: payload.away.abbr, right: payload.home.abbr },
              rows: moving.map((p) => playLane(side, p)),
              legend: [{ label: 'Run', side }, { label: 'Pass (dashed)', side }, { label: 'Turnover', mark: 'turnover' }, { label: 'Penalty', mark: 'penalty' }],
            });
          }
          cards.push({
            kind: 'table',
            key: 'drive-plays',
            title: 'Plays',
            labelHeader: 'Down',
            fixedOrder: true,
            columns: [
              { key: 'play', label: 'Play', decimals: 0, text: true },
              { key: 'yds', label: 'Yds', decimals: 0 },
            ],
            rows: d.plays.map((p) => ({ key: p.id, label: p.downText ?? `${quarterName(p.period)} ${p.clock ?? ''}`, values: { play: p.text, yds: p.yards } })),
          });
          return {
            key: d.id,
            group: quarterName(d.period),
            label: `${abbrOf(payload, d.teamId)} · ${d.result ?? ''}`,
            sub: `${d.offensivePlays ?? 0} plays, ${d.yards ?? 0} yds · from ${d.startText ?? '—'}`,
            badge: d.isScore && last ? `${last.awayScore ?? ''}–${last.homeScore ?? ''}` : null,
            imageUrl: null,
            cards,
          };
        }),
      },
    ]);
  }
  if (!rows.length) return { ...base, rows: [], state: { kind: 'empty', title: 'No plays yet', reason: 'ESPN lists drives and win probability as the game is played.' } };
  return { ...base, rows, state: { kind: 'ready' } };
}

function playLane(side: Side, p: FootballPlay) {
  const from = playX(side, p.startYardsToEndzone)!;
  const to = playX(side, p.endYardsToEndzone)!;
  return {
    key: p.id,
    side,
    from,
    to,
    label: p.yards != null ? `${p.yards > 0 ? '+' : ''}${p.yards}` : null,
    strong: p.scoring,
    dashed: /pass|sack|interception/i.test(p.type ?? ''),
    mark: p.turnover ? ('turnover' as const) : p.penalty ? ('penalty' as const) : null,
    tip: [`${p.downText ?? p.type ?? ''} · ${quarterName(p.period)} ${p.clock ?? ''}`, p.text ?? ''],
  };
}

// ---------------------------------------------------------------------------
// scoring & leaders, team stats, box
// ---------------------------------------------------------------------------

function athletesIn(box: FootballBoxTeam[], teamId: string, group: string) {
  const g = box.find((t) => t.teamId === teamId)?.groups.find((x) => x.name === group);
  return g ? g.athletes.map((a) => ({ a, stat: (key: string) => { const i = g.keys.indexOf(key); if (i >= 0) return a.stats[i]; const j = g.keys.findIndex((k) => k.split(/[/-]/).includes(key)); return j >= 0 ? String(a.stats[j]).split(/[/-]/)[g.keys[j].split(/[/-]/).indexOf(key)] : undefined; } })) : [];
}

function footballScoringSection(payload: Payload): ResearchSection | null {
  const f = payload.football;
  if (!f.scoring.length && !f.box.length) return null;
  const scoring: ResearchCard = {
    kind: 'table',
    key: 'scoring',
    title: 'Scoring summary',
    scope: `${f.scoring.length} scores`,
    labelHeader: 'When',
    fixedOrder: true,
    emptyText: 'No scores yet',
    columns: [
      { key: 'team', label: 'Team', decimals: 0 },
      { key: 'play', label: 'Play', decimals: 0, text: true },
      { key: 'score', label: `${payload.away.abbr}–${payload.home.abbr}`, decimals: 0 },
    ],
    rows: f.scoring.map((p) => ({ key: p.id, label: `${quarterName(p.period)} ${p.clock ?? ''}`, values: { team: abbrOf(payload, p.teamId), play: p.text, score: `${p.awayScore ?? '—'}–${p.homeScore ?? '—'}` } })),
  };
  const n = (v: string | undefined) => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));
  const leaders: ResearchTableRow[] = [];
  const player = (league: string, id: string) => `/${league}/player/${id}`;
  for (const [cat, group, yardsKey, line] of [
    ['Passing', 'passing', 'passingYards', (s: (k: string) => string | undefined) => `${s('completions')}/${s('passingAttempts')}, ${s('passingYards')} yds, ${s('passingTouchdowns')} TD, ${s('interceptions')} INT`],
    ['Rushing', 'rushing', 'rushingYards', (s: (k: string) => string | undefined) => `${s('rushingAttempts')} car, ${s('rushingYards')} yds, ${s('rushingTouchdowns')} TD`],
    ['Receiving', 'receiving', 'receivingYards', (s: (k: string) => string | undefined) => `${s('receptions')} rec, ${s('receivingYards')} yds, ${s('receivingTouchdowns')} TD`],
  ] as const) {
    for (const side of ['away', 'home'] as const) {
      const top = athletesIn(f.box, payload[side].id, group).sort((x, y) => n(y.stat(yardsKey)) - n(x.stat(yardsKey)))[0];
      if (!top) continue;
      leaders.push({ key: `${cat}-${side}`, label: top.a.name, labelNote: payload[side].abbr, href: player(f.league, top.a.id), values: { cat, line: line(top.stat) } });
    }
  }
  const leadersCard: ResearchCard = {
    kind: 'table',
    key: 'leaders',
    title: 'Leaders',
    scope: 'most yards on each side',
    labelHeader: 'Player',
    fixedOrder: true,
    emptyText: 'No box score yet',
    columns: [
      { key: 'cat', label: '', decimals: 0 },
      { key: 'line', label: 'Line', decimals: 0, text: true },
    ],
    rows: leaders,
  };
  return { id: 'scoring', navLabel: 'Scoring', title: 'Scoring & leaders', rows: [[scoring, leadersCard]], state: { kind: 'ready' } };
}

function footballTeamStatsSection(payload: Payload): ResearchSection | null {
  const stats = payload.football.teamStats;
  if (!stats.length) return null;
  const eff = stats.filter((r) => /Eff|redZone|possession/i.test(r.key));
  const volume = stats.filter((r) => !eff.includes(r));
  const columns: ResearchColumn[] = [
    { key: 'away', label: payload.away.abbr, decimals: 0 },
    { key: 'home', label: payload.home.abbr, decimals: 0 },
  ];
  const rowsOf = (rs: typeof stats) => rs.map((r) => ({ key: r.key, label: r.label, values: { away: r.away, home: r.home } }));
  const views = [
    { key: 'volume', label: 'Volume & yardage', labelHeader: 'Stat', columns, rows: rowsOf(volume) },
    ...(eff.length ? [{ key: 'situational', label: 'Situational', labelHeader: 'Stat', columns, rows: rowsOf(eff) }] : []),
  ];
  return {
    id: 'teams',
    navLabel: 'Team stats',
    title: 'Team stats',
    rows: [[{ kind: 'table', key: 'team-stats', title: 'Team stats', scope: 'third and fourth down, red zone and possession under Situational', labelHeader: 'Stat', columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

const BOX_GROUPS: Array<[string, string]> = [
  ['passing', 'Passing'],
  ['rushing', 'Rushing'],
  ['receiving', 'Receiving'],
  ['defensive', 'Defense'],
  ['interceptions', 'Interceptions'],
  ['fumbles', 'Fumbles'],
  ['kicking', 'Kicking'],
  ['punting', 'Punting'],
];

function footballBoxSection(payload: Payload): ResearchSection | null {
  const f = payload.football;
  if (!f.box.length) return null;
  const views = BOX_GROUPS.flatMap(([name, label]) => {
    const teams = (['away', 'home'] as const).map((side) => ({ side, g: f.box.find((t) => t.teamId === payload[side].id)?.groups.find((x) => x.name === name) }));
    const first = teams.find((t) => t.g)?.g;
    if (!first) return [];
    const columns: ResearchColumn[] = first.labels.map((l, i) => ({ key: `c${i}`, label: l, decimals: 0 }));
    const rows: ResearchTableRow[] = teams.flatMap(({ side, g }) =>
      (g?.athletes ?? []).map((a) => ({
        key: `${side}-${a.id}`,
        label: a.name,
        labelNote: payload[side].abbr,
        href: `/${f.league}/player/${a.id}`,
        values: Object.fromEntries(a.stats.map((v, i) => [`c${i}`, v])),
      })),
    );
    return rows.length ? [{ key: name, label, labelHeader: 'Player', columns, rows }] : [];
  });
  if (!views.length) return null;
  return {
    id: 'box',
    navLabel: 'Box score',
    title: 'Box score',
    rows: [[{ kind: 'table', key: 'box', title: 'Box score', scope: `${payload.away.abbr} first, then ${payload.home.abbr}`, labelHeader: 'Player', columns: views[0].columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}

// ---------------------------------------------------------------------------
// lines & props, play-by-play
// ---------------------------------------------------------------------------

function footballLinesSection(payload: Payload, state: GameState): ResearchSection {
  const f = payload.football;
  const final = state === 'final';
  const l = f.lines;
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
  const stored = f.storedLines.find((x) => x.market === 'moneyline');
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
    scope: 'open to the last quote before kickoff',
    labelHeader: 'Market',
    fixedOrder: true,
    emptyText: 'No game lines held for this game',
    columns: [
      { key: 'open', label: 'Open', decimals: 0 },
      { key: 'close', label: 'Close', decimals: 0 },
    ],
    rows: lineRows,
    caption: `${l?.provider ?? 'DraftKings'} through ESPN for every market${stored?.close ? '; the rows marked with a book count are the median across the books this app stores, which hold football moneylines only' : ''}.`,
  };
  const props = f.props.filter((p) => p.books >= 2 && (!final || p.result != null));
  const propsCard: ResearchCard = {
    kind: 'table',
    key: 'props',
    title: final ? 'Props against results' : 'Player props',
    scope: final ? 'main line at kickoff against the box score' : 'main line, both sides quoted',
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
      key: `${p.athleteId}-${p.market}`,
      label: p.name,
      labelNote: p.side ? payload[p.side].abbr : null,
      href: `/${f.league}/player/${p.athleteId}`,
      values: {
        market: FOOTBALL_MARKET_LABELS[p.market] ?? p.market,
        line: p.line,
        over: `${am(p.over.price)} ${p.over.book}`,
        under: p.under ? `${am(p.under.price)} ${p.under.book}` : '—',
        books: p.books,
        result: p.result,
        side: p.result == null ? null : p.result > p.line ? 'Over' : p.result < p.line ? 'Under' : 'Push',
      },
    })),
    caption: [f.propsAltOnly ? `${f.propsAltOnly} markets had only alternate lines quoted` : null, 'markets with one book quoting both sides'].filter(Boolean).join(' and ').replace(/^./, (c) => c.toUpperCase()) + ' are left out.',
  };
  return { id: 'lines', navLabel: final ? 'Lines & props' : 'Lines', title: final ? 'Lines & props' : 'Lines', sub: final ? 'what the market expected, and what happened' : undefined, rows: [[lines], [propsCard]], state: { kind: 'ready' } };
}

function footballPlaysSection(payload: Payload): ResearchSection | null {
  const plays = payload.football.drives.flatMap((d) => d.plays);
  if (!plays.length) return null;
  const columns: ResearchColumn[] = [
    { key: 'team', label: 'Team', decimals: 0 },
    { key: 'play', label: 'Play', decimals: 0, text: true },
    { key: 'score', label: `${payload.away.abbr}–${payload.home.abbr}`, decimals: 0 },
  ];
  const row = (p: FootballPlay): ResearchTableRow => ({
    key: p.id,
    label: `${quarterName(p.period)} ${p.clock ?? ''}`,
    labelNote: p.downText,
    values: { team: abbrOf(payload, p.teamId), play: p.text, score: `${p.awayScore ?? '—'}–${p.homeScore ?? '—'}` },
    ...(p.scoring ? { highlight: true } : {}),
  });
  const key = plays.filter((p) => p.scoring || p.turnover);
  const views = [
    { key: 'all', label: `Every play · ${plays.length}`, labelHeader: 'When', columns, rows: plays.map(row) },
    { key: 'key', label: `Scores & turnovers · ${key.length}`, labelHeader: 'When', columns, rows: key.map(row) },
  ];
  return {
    id: 'plays',
    navLabel: 'Play-by-play',
    title: 'Play-by-play',
    rows: [[{ kind: 'table', key: 'plays', title: 'Plays', scope: 'scoring plays shaded', labelHeader: 'When', columns, rows: views[0].rows, views, fixedOrder: true }]],
    state: { kind: 'ready' },
  };
}
