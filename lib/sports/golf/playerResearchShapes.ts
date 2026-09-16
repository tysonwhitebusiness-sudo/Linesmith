/**
 * Golf's player research — R6.6. The hero and golf's two own sections,
 * "Scoring" and "Shot profile", as data. Spec:
 * `docs/design/phase-g2/src/sports/soccer-tennis-golf.js`. Database-free, so
 * client code may import it; the read is `playerResearch.ts`.
 *
 * ============ GOLF HAS NO PER-GAME HISTORY, SO THIS IS ITS OWN BUILD ======
 *
 * Every other sport's hero, Seasons, Trends, Splits and Game log come from
 * `player_game_history`; golf has no rows there (`historySportFor` returns
 * null). Its record is four tables instead, measured 2026-09-15:
 *
 *   golf_tournaments      4 events, `start_date` null on all four
 *   golf_round_scores   586 rounds, keyed by ESPN id — the page's own id
 *   golf_hole_scores 10,604 holes, strokes summing to the round on every row
 *   golf_shot_events 1,033,752 shots, keyed by PGA TOUR id and NAME
 *
 * The round and hole tables cover THREE events (the 2026 FedEx Cup playoffs:
 * St. Jude, BMW, TOUR Championship; the fourth, Biltmore, has no rows), at most
 * 12 rounds a golfer. So the hero says "recent events" and counts rounds, and
 * no card pretends to a season.
 *
 * ============ THE SHOT SEED IS 2020-2022, AND IT IS NOT A HISTORY =========
 *
 * `golf_shot_events` is a static seed: 2020 (234,454 shots), 2021 (694,115),
 * 2022 (105,183) — nothing since. The Shot profile section says which seasons
 * it draws on, every time, because a 2021 putting number beside a 2026 round
 * score is otherwise read as current.
 *
 * `tournament_id` IS PGA'S PERMANENT EVENT NUMBER, REUSED EVERY YEAR. Measured:
 * no (tournament, round, hole, shot, player) key repeats within a season, and
 * 137,396 repeat across seasons — Scheffler's 2020 and 2021 starts at event
 * 023 are 568 rows on 308 keys. A hole is therefore (season, tournament, round,
 * hole). G2's own grouping left the season out, which merged two years of the
 * same event into one hole and inflated his putts per hole.
 *
 * ============ WHAT A PUTT'S DISTANCE IS ===================================
 *
 * A shot's `distance_yds` is how far the BALL TRAVELLED, not how far it
 * started from the hole — for a missed putt the two differ. The distance a
 * putt was struck from is the `left_yds` of the shot before it. So both
 * "distance left before the first putt" and "make % by first-putt distance"
 * read the previous shot's `left_yds`, where G2 read the putt's own travel.
 *
 * ============ AND WHAT A HOLE SCORE IS ====================================
 *
 * `golf_hole_scores.category` holds only 'birdie', 'par' and 'bogey': 47 eagles
 * are filed as birdies and 178 doubles and triples as bogeys (R6-F12). Every
 * count here is read from `relative_to_par` instead, which matches strokes
 * minus par on every row.
 * =========================================================================
 */

import type { PlayerBio, PlayerResearchData, ResearchCard, ResearchSection } from '@/lib/sports/shared/playerResearchShapes';

// ---------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------

export interface GolfEvent {
  eventId: string;
  name: string;
  season: number | null;
}

export interface GolfRound {
  eventId: string;
  round: number;
  strokes: number;
  toPar: number;
  windMph: number | null;
  tempF: number | null;
}

export interface GolfHole {
  eventId: string;
  round: number;
  hole: number;
  par: number;
  strokes: number;
  toPar: number;
}

/** One shot as `golf_shot_events` stores it. */
export interface GolfShotEvent {
  season: number;
  tournamentId: string;
  round: number;
  hole: number;
  shot: number;
  distanceYds: number | null;
  leftYds: number | null;
  fromLie: string | null;
  isPutt: boolean;
}

export interface GolfShotSummary {
  shots: number;
  holes: number;
  events: number;
  seasons: number[];
  drives: { n: number; avg: number | null; longest: number | null; bins: Array<{ lo: number; count: number }> };
  /** Feet left before the first putt, on holes that had one. */
  firstPuttFt: { n: number; median: number | null; bands: Array<{ key: string; label: string; count: number }> };
  putting: { holes: number; puttsPerHole: number | null; onePutt: number | null; threePutt: number | null };
  makeByDistance: Array<{ key: string; label: string; putts: number; made: number }>;
  byLie: Array<{ key: string; label: string; shots: number; medianLeftYds: number | null }>;
}

export interface GolfResearchPayload {
  espnId: string;
  /** The name the shot seed was searched under. */
  name: string | null;
  events: GolfEvent[];
  rounds: GolfRound[];
  holes: GolfHole[];
  shots: GolfShotSummary | null;
  asOf: string | null;
}

export interface GolfResearchInput {
  data: GolfResearchPayload | null;
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// The shot summary (server-side: a golfer holds ~4,000 shot rows)
// ---------------------------------------------------------------------------

/**
 * PGA's lie codes, in the order a hole is played. An unfamiliar code is folded
 * into "Other" rather than dropped. Carried over from the deleted 6.13 grid,
 * which measured that the source's own `lie` column is "NA" on every row and
 * the vocabulary lives in `from`/`to`.
 */
const LIES: Array<[string, string]> = [
  ['OTB', 'Tee'],
  ['OFW', 'Fairway'],
  ['OIR', 'Light rough'],
  ['ORO', 'Rough'],
  ['OGS', 'Greenside sand'],
  ['OST', 'Fairway sand'],
  ['ONA', 'Native area'],
  ['OCO', 'Collar'],
  ['OGR', 'Green'],
];

const FIRST_PUTT_BANDS: Array<[string, string, number, number]> = [
  ['0-5', '0–5 ft', 0, 5],
  ['5-10', '5–10 ft', 5, 10],
  ['10-20', '10–20 ft', 10, 20],
  ['20-30', '20–30 ft', 20, 30],
  ['30-50', '30–50 ft', 30, 50],
  ['50+', '50+ ft', 50, Number.POSITIVE_INFINITY],
];
const MAKE_BANDS: Array<[string, string, number, number]> = [
  ['0-5', '0–5 ft', 0, 5],
  ['5-10', '5–10 ft', 5, 10],
  ['10-15', '10–15 ft', 10, 15],
  ['15-25', '15–25 ft', 15, 25],
  ['25+', '25+ ft', 25, Number.POSITIVE_INFINITY],
];

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n: number, d: number): number | null => (d ? (100 * n) / d : null);

export function summariseGolfShots(rows: readonly GolfShotEvent[]): GolfShotSummary | null {
  if (!rows.length) return null;

  // A hole is (season, tournament, round, hole): tournament ids repeat by year.
  const holes = new Map<string, GolfShotEvent[]>();
  for (const r of rows) {
    const key = `${r.season}|${r.tournamentId}|${r.round}|${r.hole}`;
    const at = holes.get(key);
    if (at) at.push(r);
    else holes.set(key, [r]);
  }

  const drives = rows.filter((r) => r.shot === 1 && r.distanceYds != null && r.distanceYds >= 200).map((r) => r.distanceYds as number);
  const firstPuttFt: number[] = [];
  const puttCounts: number[] = [];
  const makes: Array<{ ft: number; made: boolean }> = [];
  for (const shots of holes.values()) {
    const ordered = [...shots].sort((a, b) => a.shot - b.shot);
    const putts = ordered.filter((s) => s.isPutt).length;
    puttCounts.push(putts);
    const i = ordered.findIndex((s) => s.isPutt);
    if (i > 0 && ordered[i - 1].leftYds != null) {
      const ft = (ordered[i - 1].leftYds as number) * 3;
      firstPuttFt.push(ft);
      makes.push({ ft, made: putts === 1 });
    }
  }
  const reached = puttCounts.filter((n) => n > 0);

  const lieShots = new Map<string, { shots: number; left: number[] }>();
  for (const r of rows) {
    const known = LIES.find(([code]) => code === r.fromLie);
    const key = r.fromLie == null ? 'none' : known ? known[0] : 'other';
    const at = lieShots.get(key) ?? { shots: 0, left: [] };
    at.shots += 1;
    if (!r.isPutt && r.leftYds != null) at.left.push(r.leftYds);
    lieShots.set(key, at);
  }
  const lieRows = [
    ...LIES.map(([code, label]) => ({ key: code, label })),
    { key: 'other', label: 'Other' },
    { key: 'none', label: 'Not given' },
  ]
    .filter((l) => lieShots.has(l.key))
    .map((l) => {
      const at = lieShots.get(l.key) as { shots: number; left: number[] };
      return { key: l.key, label: l.label, shots: at.shots, medianLeftYds: median(at.left) };
    });

  const lo = drives.length ? Math.floor(Math.min(...drives) / 10) * 10 : 0;
  const hi = drives.length ? Math.floor(Math.max(...drives) / 10) * 10 : 0;
  return {
    shots: rows.length,
    holes: holes.size,
    events: new Set(rows.map((r) => `${r.season}|${r.tournamentId}`)).size,
    seasons: [...new Set(rows.map((r) => r.season))].sort((a, b) => a - b),
    drives: {
      n: drives.length,
      avg: drives.length ? drives.reduce((a, b) => a + b, 0) / drives.length : null,
      longest: drives.length ? Math.max(...drives) : null,
      bins: drives.length
        ? Array.from({ length: (hi - lo) / 10 + 1 }, (_, k) => lo + k * 10).map((b) => ({ lo: b, count: drives.filter((d) => d >= b && d < b + 10).length }))
        : [],
    },
    firstPuttFt: {
      n: firstPuttFt.length,
      median: median(firstPuttFt),
      bands: FIRST_PUTT_BANDS.map(([key, label, a, b]) => ({ key, label, count: firstPuttFt.filter((f) => f >= a && f < b).length })),
    },
    putting: {
      holes: holes.size,
      puttsPerHole: holes.size ? puttCounts.reduce((a, b) => a + b, 0) / holes.size : null,
      onePutt: pct(reached.filter((n) => n === 1).length, reached.length),
      threePutt: pct(reached.filter((n) => n >= 3).length, reached.length),
    },
    makeByDistance: MAKE_BANDS.map(([key, label, a, b]) => {
      const inBand = makes.filter((m) => m.ft >= a && m.ft < b);
      return { key, label, putts: inBand.length, made: inBand.filter((m) => m.made).length };
    }),
    byLie: lieRows,
  };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const toParText = (v: number | null | undefined): string => (v == null ? '—' : v === 0 ? 'E' : v > 0 ? `+${v}` : String(v));
const signed = (v: number | null, dp: number): string => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(dp)}`);

/** Rounds oldest first: the event ids rise with the calendar, and `start_date` is null on every event. */
function orderedRounds(data: GolfResearchPayload): GolfRound[] {
  return [...data.rounds].sort((a, b) => (a.eventId === b.eventId ? a.round - b.round : Number(a.eventId) - Number(b.eventId)));
}

function scoringSection(data: GolfResearchPayload): ResearchSection {
  const names = new Map(data.events.map((e) => [e.eventId, e.name]));
  const rounds = orderedRounds(data);
  const eventsPlayed = new Set(rounds.map((r) => r.eventId)).size;
  const base = { id: 'scoring', navLabel: 'Scoring', title: 'Scoring', sub: `${eventsPlayed} recent ${eventsPlayed === 1 ? 'event' : 'events'}` };
  if (!rounds.length) {
    return {
      ...base,
      rows: [],
      state: { kind: 'empty', title: 'No rounds held', reason: 'The round tables hold only the most recent events ingested, and this golfer played in none of them.' },
    };
  }

  const roundsCard: ResearchCard = {
    kind: 'table',
    key: 'rounds',
    title: 'Rounds',
    scope: `${rounds.length} rounds`,
    caption: 'Wind and temperature are the forecast for the round, where one was recorded.',
    labelHeader: 'Event',
    columns: [
      { key: 'rd', label: 'Rd', decimals: 0 },
      { key: 'score', label: 'Score', decimals: 0 },
      { key: 'toPar', label: 'To par', decimals: 0 },
      { key: 'wind', label: 'Wind', decimals: 0 },
      { key: 'temp', label: 'Temp', decimals: 0 },
    ],
    // Newest first, as every other game log reads.
    rows: [...rounds].reverse().map((r) => ({
      key: `${r.eventId}-${r.round}`,
      label: names.get(r.eventId) ?? `Event ${r.eventId}`,
      values: {
        rd: r.round,
        score: r.strokes,
        toPar: toParText(r.toPar),
        wind: r.windMph == null ? null : `${Math.round(r.windMph)} mph`,
        temp: r.tempF == null ? null : `${Math.round(r.tempF)}°F`,
      },
    })),
  };

  const byPar: ResearchCard = {
    kind: 'table',
    key: 'byPar',
    title: 'Scoring by par',
    scope: `${data.holes.length} holes`,
    caption: 'Counted from each hole’s score against par. The source’s own label files an eagle as a birdie and a double bogey as a bogey, so it is not used.',
    labelHeader: 'Hole',
    columns: [
      { key: 'holes', label: 'Holes', decimals: 0 },
      { key: 'avg', label: 'Avg', decimals: 2 },
      { key: 'toPar', label: 'To par', decimals: 2 },
      { key: 'eagle', label: 'Eagle-', decimals: 0 },
      { key: 'birdie', label: 'Birdie', decimals: 0 },
      { key: 'par', label: 'Par', decimals: 0 },
      { key: 'bogey', label: 'Bogey', decimals: 0 },
      { key: 'double', label: 'Dbl+', decimals: 0 },
    ],
    rows: [3, 4, 5]
      .map((p) => {
        const hs = data.holes.filter((h) => h.par === p);
        return {
          key: `par${p}`,
          label: `Par ${p}`,
          values: {
            holes: hs.length,
            avg: hs.length ? hs.reduce((a, h) => a + h.strokes, 0) / hs.length : null,
            toPar: hs.length ? signed(hs.reduce((a, h) => a + h.toPar, 0) / hs.length, 2) : null,
            eagle: hs.filter((h) => h.toPar <= -2).length,
            birdie: hs.filter((h) => h.toPar === -1).length,
            par: hs.filter((h) => h.toPar === 0).length,
            bogey: hs.filter((h) => h.toPar === 1).length,
            double: hs.filter((h) => h.toPar >= 2).length,
          },
        };
      })
      .filter((r) => (r.values.holes as number) > 0),
    emptyText: 'No holes held.',
  };

  return {
    ...base,
    rows: [[roundsCard, byPar]],
    state: { kind: 'ready' },
    source: { label: 'Scoring', detail: 'golf_round_scores and golf_hole_scores (ESPN), event names from golf_tournaments', asOf: data.asOf },
  };
}

function shotSection(data: GolfResearchPayload): ResearchSection {
  const s = data.shots;
  const span = s ? (s.seasons.length > 1 ? `${s.seasons[0]}–${s.seasons[s.seasons.length - 1]}` : String(s.seasons[0])) : '';
  const base = { id: 'shots', navLabel: 'Shot profile', title: 'Shot profile', sub: s ? `every tracked shot, ${span}` : 'every tracked shot' };
  if (!s) {
    return {
      ...base,
      rows: [],
      state: {
        kind: 'empty',
        title: 'No tracked shots',
        reason:
          'The shot-level seed covers the 2020–2022 PGA TOUR seasons and matches golfers by name; this one is not in it, which is true of anyone who reached the Tour since.',
      },
    };
  }

  const drives: ResearchCard = {
    kind: 'histogram',
    key: 'drives',
    title: 'Driving distance',
    scope: `${s.drives.n} tee shots of 200+ yards`,
    caption:
      s.drives.avg != null ? `Average ${Math.round(s.drives.avg)} yds · longest ${Math.round(s.drives.longest as number)} yds.` : undefined,
    bars: s.drives.bins.map((b) => ({
      key: String(b.lo),
      axisLabel: b.lo % 40 === 0 ? String(b.lo) : '',
      value: b.count,
      highlight: false,
      tip: `${b.count} drives · ${b.lo}–${b.lo + 10} yds`,
    })),
  };

  const proximity: ResearchCard = {
    kind: 'histogram',
    key: 'proximity',
    title: 'Approach proximity',
    scope: `${s.firstPuttFt.n} holes · distance left before the first putt`,
    caption: s.firstPuttFt.median != null ? `Median ${Math.round(s.firstPuttFt.median)} ft.` : undefined,
    bars: s.firstPuttFt.bands.map((b) => ({ key: b.key, axisLabel: b.label.replace(' ft', ''), value: b.count, highlight: false, tip: `${b.count} holes · ${b.label}` })),
  };

  const putting: ResearchCard = {
    kind: 'table',
    key: 'putting',
    title: 'Putting',
    scope: `${s.putting.holes} holes`,
    caption: 'One- and three-putt rates are over holes that reached the green; putts per hole is over every hole.',
    labelHeader: 'Measure',
    columns: [{ key: 'v', label: 'Value', decimals: 1 }],
    rows: [
      { key: 'pph', label: 'Putts per hole', values: { v: s.putting.puttsPerHole == null ? null : s.putting.puttsPerHole.toFixed(2) } },
      { key: 'one', label: 'One-putt %', values: { v: s.putting.onePutt } },
      { key: 'three', label: 'Three-putt %', values: { v: s.putting.threePutt } },
    ],
  };

  const make: ResearchCard = {
    kind: 'table',
    key: 'make',
    title: 'Make % by first-putt distance',
    scope: `${s.firstPuttFt.n} first putts`,
    caption: 'The distance is where the putt was struck from — the previous shot’s distance left — not how far the ball rolled.',
    labelHeader: 'Distance',
    columns: [
      { key: 'n', label: 'Putts', decimals: 0 },
      { key: 'made', label: 'Made', decimals: 0 },
      { key: 'pct', label: 'Made %', decimals: 1 },
    ],
    rows: s.makeByDistance.map((b) => ({ key: b.key, label: b.label, values: { n: b.putts, made: b.made, pct: pct(b.made, b.putts) } })),
  };

  const byLie: ResearchCard = {
    kind: 'table',
    key: 'lies',
    title: 'Where the strokes are played from',
    scope: `${s.shots} shots`,
    caption: 'Median distance left is after the shot, and leaves putts out: a putt is measured in feet against an approach’s tens of yards.',
    labelHeader: 'Lie',
    columns: [
      { key: 'shots', label: 'Shots', decimals: 0 },
      { key: 'share', label: 'Share', decimals: 0, format: 'percent' },
      { key: 'left', label: 'Median left (yd)', decimals: 1 },
    ],
    rows: s.byLie.map((l) => ({ key: l.key, label: l.label, values: { shots: l.shots, share: pct(l.shots, s.shots), left: l.key === 'OGR' ? null : l.medianLeftYds } })),
  };

  return {
    ...base,
    rows: [[drives, proximity], [putting, make], [byLie]],
    state: { kind: 'ready' },
    // The seed is years older than the rounds above it, and a reader must know.
    note: `From the ${span} PGA TOUR shot seed: ${s.shots.toLocaleString('en-US')} shots over ${s.events} ${s.events === 1 ? 'event' : 'events'}. Nothing more recent is held at shot level, so these describe that golfer, not this season’s.`,
    source: { label: 'Shot profile', detail: `golf_shot_events, ${span} seed, matched by name`, asOf: null },
  };
}

/**
 * Golf's `PlayerResearchData`. Seasons, Trends, Splits and the game log stay
 * empty — there is no per-game history for them to read, and the page gates
 * them on one — so the research is the hero and the two sections.
 */
export function toGolfResearch(input: { bio: PlayerBio | null; golf: GolfResearchInput }): PlayerResearchData | null {
  const { golf } = input;
  if (golf.loading && !golf.data) return null;

  const empty = {
    seasons: { columns: [], rows: [], caption: null },
    trends: { stats: [], rollingWindow: 5 },
    splits: { columns: [], seasons: [], defaultSeason: 0, rowsBySeason: {} },
    gameLog: { columns: [], rows: [] },
    seasonLabels: [],
  };

  if (!golf.data) {
    const errorSection = (id: string, title: string): ResearchSection => ({
      id,
      navLabel: title,
      title,
      rows: [],
      state: golf.error ? { kind: 'error', message: golf.error } : { kind: 'empty', title: 'Nothing held', reason: 'No rounds or tracked shots are held for this golfer.' },
    });
    return {
      kind: 'golfer',
      hero: { scopeLabel: 'Recent events', scopeReason: null, record: null, games: 0, unit: { one: 'round', many: 'rounds' }, lastFive: [], tiles: [] },
      ...empty,
      sections: [errorSection('scoring', 'Scoring'), errorSection('shots', 'Shot profile')],
    };
  }

  const data = golf.data;
  const rounds = orderedRounds(data);
  const names = new Map(data.events.map((e) => [e.eventId, e.name]));
  const holes = data.holes;
  const n = rounds.length;
  const perRound = (count: number) => (n ? (count / n).toFixed(1) : '—');
  const best = n ? Math.min(...rounds.map((r) => r.toPar)) : null;
  const eventsPlayed = [...new Set(rounds.map((r) => r.eventId))];

  return {
    kind: 'golfer',
    hero: {
      scopeLabel: 'Recent events',
      scopeReason: eventsPlayed.length ? eventsPlayed.map((e) => names.get(e) ?? `Event ${e}`).join(' · ') : 'No rounds in the events held',
      record: null,
      games: n,
      unit: { one: 'round', many: 'rounds' },
      lastFive: rounds.slice(-5).map((r) => ({
        date: null,
        opponent: `${names.get(r.eventId) ?? `Event ${r.eventId}`} R${r.round}`,
        result: null,
        mark: toParText(r.toPar),
        tone: r.toPar < 0 ? 'good' : r.toPar > 0 ? 'bad' : null,
      })),
      tiles: n
        ? [
            { label: 'Rounds', value: String(n) },
            { label: 'Scoring avg', value: (rounds.reduce((a, r) => a + r.strokes, 0) / n).toFixed(2) },
            { label: 'To par / rd', value: signed(rounds.reduce((a, r) => a + r.toPar, 0) / n, 2) },
            { label: 'Birdies / rd', value: perRound(holes.filter((h) => h.toPar < 0).length), info: 'Birdies or better per round, eagles included' },
            { label: 'Bogeys / rd', value: perRound(holes.filter((h) => h.toPar > 0).length), info: 'Bogeys or worse per round, doubles included' },
            { label: 'Best round', value: toParText(best) },
          ]
        : [],
    },
    ...empty,
    sections: [scoringSection(data), shotSection(data)],
  };
}
