/**
 * The tennis match page — R8.3b, `toGameResearchData`, imported by
 * `GameResearchPage.tsx`. Sections follow G2 `game-soccer-tennis.js`: the score
 * set by set, match stats (serve and return, both players), form against each
 * player's surface numbers, head to head, and lines and props; before the first
 * serve, form, surface, head to head, players and lines; live, "Right now".
 * Point-by-point is not held, and the page says so.
 *
 * Pure: no fetching, no JSX.
 */

import { marketLabel } from '@/lib/odds/props/marketLabels';
import type { TennisFormRow, TennisGameResearchPayload, TennisPropResult } from '@/lib/sports/tennis/gameResearch';
import { buildGameHero, gameStates, resolveState, stateNote } from '@/lib/sports/shared/gameResearch';
import type { GameResearchData, GameState } from '@/lib/sports/shared/gameResearchShapes';
import type { ResearchCard, ResearchColumn, ResearchSection, ResearchTableRow } from '@/lib/sports/shared/playerResearchShapes';
import { inGameOddsCards, propHistorySection, propsTrackerCard } from '@/lib/sports/shared/gameResearchSections';
import { espnHeadshot } from '@/lib/sports/shared/identity';

type Payload = TennisGameResearchPayload;
type Side = 'away' | 'home';

const am = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));
/** A yes/no market's value is 1 or 0, so it settles over 0.5. */
const lineOf = (p: TennisPropResult) => p.line ?? 0.5;
const pct = (x: number | null | undefined, y: number | null | undefined) => (x == null || !y ? null : (100 * x) / y);

export function toGameResearchData(input: { payload: Payload; requestedState?: string | null }): GameResearchData {
  const { payload } = input;
  const state = resolveState(payload, input.requestedState);
  const sections: ResearchSection[] = (
    state === 'live'
      ? [tennisNowSection(payload), tennisScoreSection(payload), tennisFormSection(payload, state), tennisH2hSection(payload)]
      : state === 'pre' || state === 'postponed'
        ? [tennisFormSection(payload, state), tennisH2hSection(payload), tennisPlayersSection(payload, state), tennisLinesSection(payload, state)]
        : [tennisScoreSection(payload), tennisStatsSection(payload), tennisFormSection(payload, state), tennisH2hSection(payload), tennisLinesSection(payload, state)]
  ).filter((s): s is ResearchSection => s !== null);
  return {
    state,
    states: gameStates(payload.state),
    hero: buildGameHero(payload, state, tennisChips(payload, state)),
    // The shared note promises research kept below a final; a tennis final shows form and head to head in place instead.
    stateNote: state === 'final' ? 'The full match, with each player’s form and their earlier meetings.' : stateNote(state, payload.state),
    sections,
    sources: payload.sources,
  };
}

function closingMoneyline(payload: Payload) {
  return payload.tennis.storedLines.find((l) => l.market === 'moneyline')?.close ?? null;
}

export function tennisChips(payload: Payload, state: GameState): GameResearchData['hero']['chips'] {
  const out: GameResearchData['hero']['chips'] = [];
  const ml = closingMoneyline(payload);
  if (ml) {
    const price = (side: Side) => ml.sides.find((s) => s.side === side)?.americanOdds;
    out.push({ label: `${payload.away.abbr} ${am(price('away'))} · ${payload.home.abbr} ${am(price('home'))}` });
  }
  const a = payload.tennis.archive;
  if (a?.surface) out.push({ label: `${a.surface}${a.bestOf ? ` · best of ${a.bestOf}` : ''}` });
  if (state === 'final' && payload.tennis.resultNote && /ret|w\/o|walkover|def/i.test(payload.tennis.resultNote)) out.push({ label: payload.tennis.resultNote });
  return out;
}

function tennisScoreSection(payload: Payload): ResearchSection | null {
  const t = payload.tennis;
  if (!t.sets.length) return null;
  const cell = (games: number | null, tb: number | null, lost: boolean) => (games == null ? null : tb != null && lost ? `${games} (${tb})` : String(games));
  const sets: ResearchCard = {
    kind: 'table',
    key: 'sets',
    title: 'Set by set',
    scope: t.resultNote ?? undefined,
    labelHeader: 'Set',
    fixedOrder: true,
    columns: [
      { key: 'away', label: payload.away.abbr, decimals: 0, imageUrl: payload.away.logoUrl },
      { key: 'home', label: payload.home.abbr, decimals: 0, imageUrl: payload.home.logoUrl },
    ],
    rows: t.sets.map((s, i) => {
      const awayWon = s.winner === 'away';
      const homeWon = s.winner === 'home';
      const row: ResearchTableRow = { key: String(i), label: `Set ${i + 1}`, values: { away: cell(s.away, s.awayTiebreak, homeWon), home: cell(s.home, s.homeTiebreak, awayWon) } };
      if (awayWon || homeWon) row.tones = awayWon ? { away: 'good' } : { home: 'good' };
      return row;
    }),
    caption: 'A tiebreak shows the loser’s points in brackets. Point-by-point is not held.',
  };
  const a = t.archive;
  const facts: ResearchCard = {
    kind: 'table',
    key: 'facts',
    title: 'The match',
    labelHeader: '',
    fixedOrder: true,
    columns: [{ key: 'value', label: '', decimals: 0, text: true }],
    rows: [
      { key: 'event', label: 'Event', values: { value: [t.tournament, t.round].filter(Boolean).join(' · ') } },
      ...(a?.surface ? [{ key: 'surface', label: 'Surface', values: { value: a.surface } }] : []),
      ...(a?.bestOf ? [{ key: 'format', label: 'Format', values: { value: `Best of ${a.bestOf}` } }] : []),
      ...(a?.minutes ? [{ key: 'time', label: 'Duration', values: { value: `${Math.floor(a.minutes / 60)}h ${a.minutes % 60}m` } }] : []),
      ...(a ? [{ key: 'rank', label: 'Ranks', values: { value: `${payload.away.abbr} ${a.away.rank ? `No. ${a.away.rank}` : '—'}${a.away.seed ? ` (seed ${a.away.seed})` : ''} · ${payload.home.abbr} ${a.home.rank ? `No. ${a.home.rank}` : '—'}${a.home.seed ? ` (seed ${a.home.seed})` : ''}` } }] : []),
    ],
  };
  return { id: 'score', navLabel: 'Score', title: 'Score', rows: [[sets, facts]], state: { kind: 'ready' } };
}

function tennisStatsSection(payload: Payload): ResearchSection {
  const t = payload.tennis;
  const a = t.archive;
  const base = { id: 'stats', navLabel: 'Match stats', title: 'Match stats', sub: 'serve and return, both players' };
  if (!a || !a.away.serve || !a.home.serve) {
    return {
      ...base,
      rows: [],
      state: {
        kind: 'empty',
        title: 'Not in the archive yet',
        reason: `Serve and return stats come from the TennisMyLife archive, which runs through ${t.archiveThrough ?? 'an unknown date'}. ESPN publishes no tennis match stats.`,
      },
    };
  }
  const S = { away: a.away.serve, home: a.home.serve };
  const opp = (side: Side) => (side === 'away' ? 'home' : 'away');
  const returnWon = (side: Side) => {
    const o = S[opp(side)];
    return o.servePoints ? o.servePoints - (o.firstWon ?? 0) - (o.secondWon ?? 0) : null;
  };
  const f1 = (v: number | null) => (v == null ? null : `${v.toFixed(0)}%`);
  const row = (key: string, label: string, v: (side: Side) => string | number | null, better?: 'high' | 'low'): ResearchTableRow => {
    const va = v('away');
    const vh = v('home');
    const r: ResearchTableRow = { key, label, values: { away: va, home: vh } };
    const na = typeof va === 'string' ? Number.parseFloat(va) : va;
    const nh = typeof vh === 'string' ? Number.parseFloat(vh) : vh;
    if (better && na != null && nh != null && Number.isFinite(na) && Number.isFinite(nh) && na !== nh) {
      const awayBetter = better === 'high' ? na > nh : na < nh;
      r.tones = awayBetter ? { away: 'good' } : { home: 'good' };
    }
    return r;
  };
  const rows = [
    row('aces', 'Aces', (s) => S[s].aces, 'high'),
    row('df', 'Double faults', (s) => S[s].doubleFaults, 'low'),
    row('first-in', '1st serve in', (s) => f1(pct(S[s].firstIn, S[s].servePoints)), 'high'),
    row('first-won', '1st serve points won', (s) => f1(pct(S[s].firstWon, S[s].firstIn)), 'high'),
    row('second-won', '2nd serve points won', (s) => f1(pct(S[s].secondWon, (S[s].servePoints ?? 0) - (S[s].firstIn ?? 0))), 'high'),
    row('serve-won', 'Service points won', (s) => f1(pct((S[s].firstWon ?? 0) + (S[s].secondWon ?? 0), S[s].servePoints)), 'high'),
    row('return-won', 'Return points won', (s) => f1(pct(returnWon(s), S[opp(s)].servePoints)), 'high'),
    row('bp-saved', 'Break points saved', (s) => `${S[s].breakPointsSaved ?? 0}/${S[s].breakPointsFaced ?? 0}`),
    row('bp-won', 'Break points won', (s) => `${(S[opp(s)].breakPointsFaced ?? 0) - (S[opp(s)].breakPointsSaved ?? 0)}/${S[opp(s)].breakPointsFaced ?? 0}`),
    row('points', 'Total points won', (s) => (S[s].firstWon ?? 0) + (S[s].secondWon ?? 0) + (returnWon(s) ?? 0), 'high'),
    row('games', 'Service games', (s) => S[s].serviceGames),
  ];
  return {
    ...base,
    rows: [
      [
        {
          kind: 'table',
          key: 'match-stats',
          title: 'Head to head in this match',
          labelHeader: 'Stat',
          fixedOrder: true,
          columns: [
            { key: 'away', label: payload.away.abbr, decimals: 0, imageUrl: payload.away.logoUrl },
            { key: 'home', label: payload.home.abbr, decimals: 0, imageUrl: payload.home.logoUrl },
          ],
          rows,
          caption: 'The better side of each stat is marked. From the TennisMyLife archive.',
        },
      ],
    ],
    state: { kind: 'ready' },
  };
}

function formTable(payload: Payload, side: Side): ResearchCard {
  const t = payload.tennis;
  const rows = [...(t.form[payload[side].id] ?? [])].reverse();
  const w = rows.filter((r) => r.won).length;
  return {
    kind: 'table',
    key: `form-${side}`,
    title: `${payload[side].name} coming in`,
    scope: rows.length ? `last ${rows.length}: ${w}-${rows.length - w}` : 'no matches held before this one',
    labelHeader: 'Date',
    fixedOrder: true,
    emptyText: 'No earlier matches held',
    columns: [
      { key: 'opp', label: 'Opponent', decimals: 0, text: true },
      { key: 'result', label: 'Result', decimals: 0 },
      { key: 'games', label: 'Games', decimals: 0 },
    ],
    rows: rows.map((r: TennisFormRow) => ({
      key: r.eventId,
      label: new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      href: `/tennis/${t.tour}/game/${r.eventId}`,
      imageUrl: espnHeadshot('tennis', r.opponentId),
      imageKind: 'player' as const,
      values: { opp: r.opponentName ?? '—', result: `${r.won ? 'W' : 'L'} ${r.setsWon}-${r.setsLost}`, games: `${r.gamesWon}-${r.gamesLost}` },
      tones: { result: r.won ? 'good' : 'bad' },
    })),
  };
}

function tennisFormSection(payload: Payload, state: GameState): ResearchSection {
  const t = payload.tennis;
  const rows: ResearchCard[][] = [[formTable(payload, 'away'), formTable(payload, 'home')]];
  const surf = t.surface;
  if (surf.away || surf.home) {
    const name = (surf.away ?? surf.home)!.surface;
    const S = t.archive && state === 'final' ? { away: t.archive.away.serve, home: t.archive.home.serve } : null;
    const f = (v: number | null | undefined) => (v == null ? null : Number(v.toFixed(1)));
    const col = (side: Side): ResearchColumn[] => [
      { key: `${side}Season`, label: `${payload[side].abbr} ${name.toLowerCase()} avg`, decimals: 1, imageUrl: payload[side].logoUrl },
      ...(S ? [{ key: `${side}Match`, label: `${payload[side].abbr} here`, decimals: 1, imageUrl: payload[side].logoUrl }] : []),
    ];
    const here = (side: Side, v: (s: NonNullable<typeof S>['away']) => number | null) => (S && S[side] ? f(v(S[side])) : null);
    rows.push([
      {
        kind: 'table',
        key: 'surface',
        title: `On ${name.toLowerCase()} courts`,
        scope: 'this season and last, before this match',
        labelHeader: '',
        fixedOrder: true,
        columns: [...col('away'), ...col('home')],
        rows: [
          { key: 'record', label: 'Record', values: { awaySeason: surf.away ? `${surf.away.won}-${surf.away.lost}` : null, homeSeason: surf.home ? `${surf.home.won}-${surf.home.lost}` : null, awayMatch: null, homeMatch: null } },
          { key: 'aces', label: 'Aces / match', values: { awaySeason: f(surf.away?.aces), homeSeason: f(surf.home?.aces), awayMatch: here('away', (s) => s?.aces ?? null), homeMatch: here('home', (s) => s?.aces ?? null) } },
          { key: 'first-in', label: '1st serve in %', values: { awaySeason: f(surf.away?.firstInPct), homeSeason: f(surf.home?.firstInPct), awayMatch: here('away', (s) => pct(s?.firstIn, s?.servePoints)), homeMatch: here('home', (s) => pct(s?.firstIn, s?.servePoints)) } },
          { key: 'first-won', label: '1st serve won %', values: { awaySeason: f(surf.away?.firstWonPct), homeSeason: f(surf.home?.firstWonPct), awayMatch: here('away', (s) => pct(s?.firstWon, s?.firstIn)), homeMatch: here('home', (s) => pct(s?.firstWon, s?.firstIn)) } },
          { key: 'return-won', label: 'Return points won %', values: { awaySeason: f(surf.away?.returnWonPct), homeSeason: f(surf.home?.returnWonPct), awayMatch: null, homeMatch: null } },
        ],
        caption: `From the TennisMyLife archive, which runs through ${t.archiveThrough ?? 'an unknown date'}.`,
      },
    ]);
  }
  return { id: 'form', navLabel: 'Form', title: 'Form', sub: 'recent matches and surface numbers', rows, state: { kind: 'ready' } };
}

function tennisH2hSection(payload: Payload): ResearchSection {
  const t = payload.tennis;
  const rows = [...t.h2h].reverse();
  const w = rows.filter((r) => r.won).length;
  const columns: ResearchColumn[] = [
    { key: 'won', label: 'Won', decimals: 0 },
    { key: 'sets', label: `Sets ${payload.away.abbr}–${payload.home.abbr}`, decimals: 0 },
    { key: 'games', label: 'Games', decimals: 0 },
  ];
  const recentRows: ResearchTableRow[] = rows.map((r) => ({
    key: r.eventId,
    label: shortDay(r.date),
    href: `/tennis/${t.tour}/game/${r.eventId}`,
    values: { won: r.won ? payload.away.abbr : payload.home.abbr, sets: `${r.setsWon}–${r.setsLost}`, games: `${r.gamesWon}–${r.gamesLost}` },
  }));
  // R12e: meetings before 2024, from the archive by verified name (`deepHeadToHead.ts`).
  const deep = t.deepH2h;
  const older: ResearchTableRow[] = (deep?.status === 'ok' ? deep.meetings : []).map((m, i) => {
    // The source lists the winner first, so the sets read from the away side flip on a loss.
    const [hi, lo] = m.sets.split('–');
    return {
      key: `deep-${m.date}-${i}`,
      label: shortDay(m.date),
      labelNote: [m.tournament, m.round].filter(Boolean).join(' · ') || null,
      values: { won: m.awayWon ? payload.away.abbr : payload.home.abbr, sets: m.awayWon ? `${hi}–${lo}` : `${lo}–${hi}`, games: '—' },
    };
  });
  const olderWins = (deep?.status === 'ok' ? deep.meetings : []).filter((m) => m.awayWon).length;
  const allW = w + olderWins;
  const allN = rows.length + older.length;
  const first = older.length ? older[older.length - 1].label.slice(-4) : null;
  const scope = older.length
    ? `${payload.away.abbr} ${allW}-${allN - allW} against ${payload.home.abbr} since ${first}${rows.length ? ` · ${w}-${rows.length - w} since 2024` : ''}`
    : rows.length
      ? `${payload.away.abbr} ${w}-${rows.length - w} against ${payload.home.abbr}`
      : undefined;
  const caption = [
    older.length ? 'Meetings before 2024 come from the results archive, matched by name and confirmed against each player’s own match dates. They are tour-level matches only (no Davis Cup or ATP/United Cup), leave out retirements with the sets level, carry sets but not games, and are not linked.' : null,
    deep?.status === 'unverified' && deep.reason ? deep.reason : null,
  ].filter(Boolean).join(' ') || undefined;
  return {
    id: 'h2h',
    navLabel: 'Head to head',
    title: 'Head to head',
    rows: [
      [
        {
          kind: 'table',
          key: 'h2h',
          title: 'Earlier meetings',
          scope,
          labelHeader: 'Date',
          fixedOrder: true,
          emptyText: `${payload.away.name} and ${payload.home.name} have not met in the matches held (from ${older.length || deep?.status === 'ok' ? '2015' : '2024'})`,
          columns,
          rows: recentRows.length ? recentRows : older,
          ...(older.length
            ? {
                views: [
                  ...(recentRows.length ? [{ key: 'recent', label: 'Since 2024', labelHeader: 'Date', columns, rows: recentRows }] : []),
                  { key: 'all', label: `All ${allN} meetings`, labelHeader: 'Date', columns, rows: [...recentRows, ...older] },
                ],
              }
            : {}),
          ...(caption ? { caption } : {}),
        },
      ],
    ],
    state: { kind: 'ready' },
  };
}

const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function tennisLinesSection(payload: Payload, state: GameState): ResearchSection {
  const t = payload.tennis;
  const final = state === 'final';
  const ml = t.storedLines.find((l) => l.market === 'moneyline');
  const lineRows: ResearchTableRow[] = (['away', 'home'] as const).flatMap((side) => {
    const o = ml?.open?.sides.find((s) => s.side === side);
    const c = ml?.close?.sides.find((s) => s.side === side);
    return o || c ? [{ key: side, label: `To win · ${payload[side].name}`, values: { open: am(o?.americanOdds), close: am(c?.americanOdds), books: ml?.close?.books ?? ml?.open?.books ?? null } }] : [];
  });
  const lines: ResearchCard = {
    kind: 'table',
    key: 'match-lines',
    title: 'Match odds',
    scope: 'open to the last quote before the first serve',
    labelHeader: 'Market',
    fixedOrder: true,
    emptyText: 'No match odds held for this match',
    columns: [
      { key: 'open', label: 'Open', decimals: 0 },
      { key: 'close', label: 'Close', decimals: 0 },
      { key: 'books', label: 'Books', decimals: 0 },
    ],
    rows: lineRows,
    caption: 'Median across the books this app stores. Tennis has no ESPN pickcenter, and point-by-point is not held.',
  };
  const props = t.props.filter((p) => p.books >= 2 && (!final || p.result != null));
  const propsCard: ResearchCard = {
    kind: 'table',
    key: 'props',
    title: final ? 'Props against results' : 'Player props',
    scope: final ? 'main line or yes price at the start, against the match' : 'main lines and yes/no markets',
    labelHeader: 'Player',
    emptyText: final ? 'No player props held for this match, or none the score and archive can settle' : 'No player props held for this match',
    sortKey: final ? undefined : 'books',
    columns: [
      { key: 'market', label: 'Market', decimals: 0, text: true },
      { key: 'line', label: 'Line', decimals: 1 },
      { key: 'over', label: 'Best over / yes', decimals: 0 },
      { key: 'books', label: 'Books', decimals: 0 },
      ...(final ? [{ key: 'result', label: 'Result', decimals: 0 }, { key: 'went', label: 'Went', decimals: 0 }] : []),
    ],
    rows: props.map((p) => ({
      key: `${p.athleteId}-${p.market}`,
      label: p.name,
      imageUrl: espnHeadshot('tennis', p.athleteId),
      imageKind: 'player' as const,
      href: `/tennis/${t.tour}/player/${encodeURIComponent(`espn:tennis:${p.athleteId}`)}`,
      values: {
        market: marketLabel(p.market, 'tennis'),
        line: p.line == null ? 'yes/no' : p.line,
        over: `${am(p.over.price)} ${p.over.book}`,
        books: p.books,
        result: p.line == null && p.result != null ? (p.result > 0 ? 'Yes' : 'No') : p.result,
        went: p.result == null ? null : p.line == null ? (p.result > 0 ? 'Yes' : 'No') : p.result > p.line ? 'Over' : p.result < p.line ? 'Under' : 'Push',
      },
    })),
    caption: 'Aces settle only once the match reaches the archive; games won and to win a set settle from the score.',
  };
  return { id: 'lines', navLabel: final ? 'Lines & props' : 'Lines', title: final ? 'Lines & props' : 'Lines', rows: [[lines], [propsCard]], state: { kind: 'ready' } };
}

function tennisPlayersSection(payload: Payload, state: GameState): ResearchSection | null {
  const t = payload.tennis;
  return propHistorySection({
    away: payload.away,
    home: payload.home,
    state,
    // The game logs hold scores, not serve stats, so an aces market has no history to show.
    props: t.props
      .filter((p) => p.books >= 2 && p.market !== 'aces')
      .map((p) => ({
        key: `${p.athleteId}-${p.market}`,
        name: p.name,
        href: `/tennis/${t.tour}/player/${encodeURIComponent(`espn:tennis:${p.athleteId}`)}`,
        imageUrl: espnHeadshot('tennis', p.athleteId),
        side: p.side,
        marketLabel: marketLabel(p.market, 'tennis'),
        line: lineOf(p),
        books: p.books,
        history: t.propHistory[`${p.athleteId}|${p.market}`] ?? [],
      })),
  });
}

function tennisNowSection(payload: Payload): ResearchSection {
  const t = payload.tennis;
  const rows: ResearchCard[][] = [
    [
      {
        kind: 'table',
        key: 'situation',
        title: 'The match now',
        scope: payload.statusText,
        labelHeader: '',
        fixedOrder: true,
        columns: [{ key: 'value', label: '', decimals: 0, text: true }],
        rows: [
          { key: 'sets', label: 'Sets', values: { value: `${payload.away.abbr} ${payload.away.score ?? 0} · ${payload.home.abbr} ${payload.home.score ?? 0}` } },
          ...t.sets.map((s, i) => ({ key: `set${i}`, label: `Set ${i + 1}`, values: { value: `${s.away ?? 0}–${s.home ?? 0}` } })),
        ],
        caption: 'Games within the current set and point scores are not held.',
      },
    ],
    [
      propsTrackerCard(
        t.props.map((p) => ({
          key: `${p.athleteId}-${p.market}`,
          name: p.name,
          href: `/tennis/${t.tour}/player/${encodeURIComponent(`espn:tennis:${p.athleteId}`)}`,
          imageUrl: espnHeadshot('tennis', p.athleteId),
          sideAbbr: p.side ? payload[p.side].abbr : null,
          marketLabel: marketLabel(p.market, 'tennis'),
          line: lineOf(p),
          books: p.books,
          result: p.result,
        })),
      ),
    ],
  ];
  if (t.live) {
    const ml = closingMoneyline(payload);
    rows.push(
      inGameOddsCards({
        away: payload.away,
        home: payload.home,
        inGame: t.live.inGame,
        close: (market) => (market === 'moneyline' ? ml : null),
        spreadLabel: 'Games handicap',
        startWord: 'the first serve',
        scoredSince: () => null,
      }),
    );
  }
  return { id: 'now', navLabel: 'Right now', title: 'Right now', sub: 'refreshed every 15 seconds', rows, state: { kind: 'ready' } };
}
