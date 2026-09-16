/**
 * Tennis's own player-page section, as data: "Surface & serve" (R6.4). Spec:
 * `docs/design/phase-g2/src/sports/soccer-tennis-golf.js`. Source: the
 * TennisMyLife season archive through `playerArchive.ts` — database-free here,
 * so client code may import it.
 *
 * ============ THE PAGE'S OWN HISTORY CANNOT BUILD THIS CARD ===============
 *
 * `player_game_history` stores eight keys for tennis and no more, measured
 * 2026-09-15 over 100,468 rows: games won and lost, sets won and lost,
 * tiebreaks played, match_won, is_qualifying and is_major. No surface, no
 * aces, no serve or return points, no round, no ranking, no tournament. So
 * Seasons, Trends, Splits and the game log are built from those rows, and
 * everything here comes from the archive instead — surface (Hard, Clay,
 * Grass), level (G for a slam, M, 1000, 500, 250, A, D, F), aces, the serve
 * and return columns (9,738 of 10,080 ATP matches carry them), rank and round.
 *
 * ============ AND IT SAYS HOW CURRENT IT IS ===============================
 *
 * The archive lags. Measured 2026-09-15: the ATP file ends at Winston-Salem,
 * 2026-08-30 — the US Open, which finished a week earlier, is not in it at
 * all, and Carlos Alcaraz's last row is 2026-04-14. A card that quietly
 * averaged those numbers would present a fortnight-old picture as current, so
 * the section states the last match it holds (R4-F1).
 * =========================================================================
 */

import { sectionOpeningSeason, type ResearchCard, type ResearchSection } from '@/lib/sports/shared/playerResearchShapes';

/** One archived match, trimmed to what the section draws. */
export interface TennisArchiveMatch {
  date: string;
  season: number;
  tournamentName: string;
  surface: string;
  /** Sackmann's level code: G slam, M/1000 Masters, 500, 250, A tour, D Davis Cup, F finals. */
  level: string | null;
  round: string | null;
  opponent: string;
  isWinner: boolean;
  rank: number | null;
  aces: number | null;
  /** This player's service points, first serves in and won, second won. */
  serve: { points: number | null; firstIn: number | null; firstWon: number | null; secondWon: number | null } | null;
  /** The opponent's serve — this player's return. */
  opponentServe: { points: number | null; firstWon: number | null; secondWon: number | null } | null;
}

export interface TennisArchivePayload {
  /** The archive's own spelling of the name it matched. */
  name: string;
  tour: 'atp' | 'wta';
  seasons: number[];
  matches: TennisArchiveMatch[];
  /** The newest tournament date in the whole archive, not just this player's. */
  archiveLastDate: string | null;
  asOf: string | null;
}

export interface TennisSurfaceInput {
  /** The page's scope season (`research.splits.defaultSeason`); opens here when the source holds it. Set by the adapter. */
  scopeSeason?: number | null;
  season: number | null;
  data: TennisArchivePayload | null;
  loading: boolean;
  error: string | null;
  /** Today's court, so the row a player is about to play on is marked (C7). */
  todaySurface?: string | null;
  emptyReason?: string;
}

const SURFACES = ['Hard', 'Clay', 'Grass'];

/**
 * R6-F3 — the tour level of an event, from the archive's own `level` column.
 * `player_game_history.is_major` is 0 on every tennis row, so a slam cannot be
 * told from a 250 there; the archive codes it. Measured 2026-09-15 over three
 * players' files: the ATP archive writes `M` for a Masters and the WTA one
 * writes `1000`, and both also use G, 500, 250, F (tour finals), D (Davis /
 * Billie Jean King Cup), O (Olympics) and A (other tour event).
 */
const LEVELS: Array<{ key: string; label: string; codes: string[] }> = [
  { key: 'G', label: 'Slam', codes: ['G'] },
  { key: 'M', label: 'Masters 1000', codes: ['M', '1000'] },
  { key: '500', label: '500', codes: ['500'] },
  { key: '250', label: '250', codes: ['250'] },
  { key: 'F', label: 'Tour finals', codes: ['F'] },
  { key: 'other', label: 'Olympics, cups & other', codes: ['O', 'D', 'A'] },
];
const pct = (n: number, d: number): number | null => (d ? (100 * n) / d : null);
const sum = (xs: Array<number | null | undefined>) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/** Return points won: every point the opponent served, less the ones they won on serve. */
export function returnPointsWon(matches: readonly TennisArchiveMatch[]): { won: number; of: number } {
  const of = sum(matches.map((m) => m.opponentServe?.points));
  const theirs = sum(matches.map((m) => (m.opponentServe?.firstWon ?? 0) + (m.opponentServe?.secondWon ?? 0)));
  return { won: of - theirs, of };
}

/** The furthest round reached, as a number of wins from the first round. */
function deepestRound(matches: readonly TennisArchiveMatch[]): string | null {
  const ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', 'RR'];
  let best = -1;
  for (const m of matches) {
    const i = m.round ? ORDER.indexOf(m.round) : -1;
    // A round robin is not deeper than a quarter-final; it is a different draw.
    if (i >= 0 && m.round !== 'RR' && i > best) best = i;
    else if (m.round === 'RR' && best < 0) best = ORDER.indexOf('RR');
  }
  if (best < 0) return null;
  const round = ORDER[best];
  // Won the final, or reached it: the deepest a season gets at that level.
  if (round === 'F') return matches.some((m) => m.round === 'F' && m.isWinner) ? 'Won' : 'Final';
  return round === 'RR' ? 'Round robin' : round;
}

/** The smallest span of at least four that divides evenly into four ticks. */
const axisSpan = (span: number) => Math.max(4, Math.ceil(span / 4) * 4);

const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function tennisSurfaceSection(input: TennisSurfaceInput): ResearchSection {
  const seasons = input.data?.seasons ?? [];
  const base = {
    id: 'surface',
    navLabel: 'Surface & serve',
    title: 'Surface & serve',
    sub: 'TennisMyLife archive',
    ...(seasons.length
      ? { season: { value: sectionOpeningSeason(seasons, input.season, input.scopeSeason), options: [...seasons].reverse().map((s) => ({ value: s, label: String(s) })) } }
      : {}),
  };
  if (input.loading) return { ...base, rows: [], state: { kind: 'loading' } };
  if (input.error) return { ...base, rows: [], state: { kind: 'error', message: input.error } };
  if (!input.data || input.data.matches.length === 0) {
    return {
      ...base,
      rows: [],
      state: {
        kind: 'empty',
        title: 'No archived matches',
        reason: input.emptyReason ?? 'The TennisMyLife archive holds no matches under this name.',
      },
    };
  }

  const season = sectionOpeningSeason(seasons, input.season, input.scopeSeason);
  const all = input.data.matches;
  const inSeason = all.filter((m) => m.season === season);
  const today = (input.todaySurface ?? '').toLowerCase();

  const bySurface: ResearchCard = {
    kind: 'table',
    key: 'surfaces',
    title: 'By surface',
    scope: `${season} · ${inSeason.length} matches`,
    info: 'First-serve points won and return points won are the two halves of a match: how well this player holds, and how well they break.',
    caption: today ? `Today's court is marked.` : undefined,
    labelHeader: 'Surface',
    columns: [
      { key: 'w', label: 'W', decimals: 0 },
      { key: 'l', label: 'L', decimals: 0 },
      { key: 'wp', label: 'Win %', decimals: 0 },
      { key: 'ace', label: 'Aces / match', decimals: 1 },
      { key: 'fw', label: '1st won %', decimals: 1 },
      { key: 'rpw', label: 'Return pts %', decimals: 1 },
    ],
    rows: SURFACES.map((surface) => {
      const ms = inSeason.filter((m) => m.surface === surface);
      const won = ms.filter((m) => m.isWinner).length;
      const ret = returnPointsWon(ms);
      return {
        key: surface,
        // C7: the court this player is about to play on, marked rather than reordered.
        label: today && surface.toLowerCase() === today ? `${surface} · today` : surface,
        values: {
          w: won,
          l: ms.length - won,
          wp: pct(won, ms.length),
          ace: ms.length ? sum(ms.map((m) => m.aces)) / ms.length : null,
          fw: pct(sum(ms.map((m) => m.serve?.firstWon)), sum(ms.map((m) => m.serve?.firstIn))),
          rpw: pct(ret.won, ret.of),
        },
      };
    }).filter((r) => (r.values.w as number) + (r.values.l as number) > 0),
    emptyText: 'No archived matches this season.',
  };

  const byLevel: ResearchCard = {
    kind: 'table',
    key: 'levels',
    title: 'By level',
    scope: `${season} · ${inSeason.length} matches`,
    info: 'The tour level of each event, from the archive. Deepest round is the furthest this player went at that level in the season.',
    labelHeader: 'Level',
    columns: [
      { key: 'w', label: 'W', decimals: 0 },
      { key: 'l', label: 'L', decimals: 0 },
      { key: 'wp', label: 'Win %', decimals: 0 },
      { key: 'best', label: 'Deepest round', decimals: 0 },
    ],
    rows: LEVELS.map(({ key, label, codes }) => {
      const ms = inSeason.filter((m) => m.level != null && codes.includes(m.level));
      const won = ms.filter((m) => m.isWinner).length;
      return {
        key,
        label,
        values: { w: won, l: ms.length - won, wp: pct(won, ms.length), best: deepestRound(ms) },
      };
    }).filter((r) => (r.values.w as number) + (r.values.l as number) > 0),
    emptyText: 'No archived matches this season.',
  };

  const ranked = all.filter((m) => m.rank != null);
  const ranking: ResearchCard = {
    kind: 'series',
    key: 'ranking',
    title: 'Ranking',
    scope: 'at each match · higher is better',
    caption: 'The ranking carried into each match, oldest first.',
    // Negated so the chart's "up is better" reading holds for a number where
    // lower is better; `axisFormat` puts the real rank back on the axis, and
    // the bounds stop it padding past No. 1 into a rank that cannot exist.
    values: ranked.map((m) => -(m.rank as number)),
    axisFormat: { negate: true, prefix: 'No. ' },
    // Four even gaps over a whole number of ranks, so the axis never prints the
    // same rank twice (a No. 1-to-No. 3 span rounded to "No. 2, No. 2" before
    // this) and never pads past No. 1 into a rank that cannot exist.
    min: ranked.length ? -1 - axisSpan(Math.max(...ranked.map((m) => m.rank as number)) - 1) : undefined,
    max: -1,
    xLabels: ranked.map((m, i) => (i === 0 || m.season !== ranked[i - 1].season ? String(m.season) : '')),
    zeroBased: false,
    decimals: 0,
    unit: 'rank',
    tips: ranked.map((m) => [`No. ${m.rank}`, `${m.tournamentName}${m.round ? ` ${m.round}` : ''} · ${shortDate(m.date)}`]),
  };

  const rolling = (values: Array<number | null>, w: number) =>
    values.map((_, i) => {
      if (i + 1 < w) return Number.NaN;
      const window = values.slice(i + 1 - w, i + 1).filter((v): v is number => v != null);
      return window.length ? window.reduce((a, b) => a + b, 0) / window.length : Number.NaN;
    });
  const served = all.filter((m) => m.serve || m.opponentServe);
  const serveReturn: ResearchCard = {
    kind: 'series',
    key: 'serveReturn',
    title: 'Serve and return by match',
    scope: `${served.length} matches · 10-match rolling`,
    caption: 'Dark is first-serve points won when serving; grey is points won on the opponent’s serve.',
    values: rolling(served.map((m) => pct(m.serve?.firstWon ?? 0, m.serve?.firstIn ?? 0)), 10),
    context: rolling(
      served.map((m) => {
        const r = returnPointsWon([m]);
        return pct(r.won, r.of);
      }),
      10,
    ),
    xLabels: served.map((m, i) => (i === 0 || m.season !== served[i - 1].season ? String(m.season) : '')),
    zeroBased: false,
    decimals: 1,
    unit: '%',
    tips: served.map((m) => {
      const r = returnPointsWon([m]);
      return [
        `${(pct(m.serve?.firstWon ?? 0, m.serve?.firstIn ?? 0) ?? 0).toFixed(0)}% first serve won`,
        `${(pct(r.won, r.of) ?? 0).toFixed(0)}% return points won`,
        `${m.isWinner ? 'beat' : 'lost to'} ${m.opponent} · ${m.tournamentName}`,
      ];
    }),
    legend: [
      { label: 'First-serve points won', dark: true },
      { label: 'Return points won', dark: false },
    ],
  };

  const last = all[all.length - 1];
  const behind = input.data.archiveLastDate && last ? input.data.archiveLastDate.slice(0, 10) > last.date.slice(0, 10) : false;
  return {
    ...base,
    rows: [[bySurface, byLevel], [ranking], [serveReturn]],
    state: { kind: 'ready' },
    // R4-F1: the archive lags, and a page that averages it must say so.
    note: input.data.archiveLastDate
      ? `The archive runs to ${shortDate(input.data.archiveLastDate)}${behind && last ? `, and this player's last match in it is ${shortDate(last.date)}` : ''}; anything since is not in these numbers.`
      : undefined,
    source: { label: 'Surface and serve', detail: `TennisMyLife ${input.data.tour.toUpperCase()} season archive`, asOf: input.data.asOf },
  };
}
