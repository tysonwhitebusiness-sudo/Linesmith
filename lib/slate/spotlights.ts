/**
 * The Slate's Spotlights (S3).
 *
 * THE PHASE'S OWN PREMISE WAS WRONG, and the correction is the reason this file
 * reads candidates rather than a table. S3 says "read `slate_rankings` (M3)".
 * Measured 2026-09-20: that table holds four rankings across three sports —
 * `mlb-hr-of-the-day`, `mlb-most-strikeouts`, `nfl-anytime-td` and
 * `soccer-anytime-goalscorer`. Those are the SPECIALS pilot set (S4), not the
 * Spotlights. The two spotlights the spec asks every sport for — Hit-rate
 * leaders and Active streaks — have no rows there at all, and never did.
 *
 * They do not need any. Both are readings of the same candidate history the
 * props board is already holding, through the same `readForm` the table's own
 * L5/L10/Strk columns use. Deriving them here rather than from a second source
 * means a spotlight can never disagree with the table underneath it, which is
 * a stronger guarantee than a nightly job could give.
 *
 * NOTHING HERE IS A PREDICTION. A hit rate is a count of what happened. A
 * streak is a count of what happened in a row. Neither is compared to a price,
 * and neither is a claim about what happens next.
 */

import type { PickCandidate } from '../core/types';
import { readForm } from '../core/pickEngine';
import { isOk } from '../core/windowedStat';
import { groupFlags, type ResearchFlag } from './flags';
import { formatFactor, SOURCE_CREDIT } from './specialsFormat';
import { headshotFor, teamLogoFor } from '../sports/shared/identity';
import type { SlateGameCard } from '../sports/shared/slateShapes';

/** One cell on a spotlight row: a number and how it should print. */
export interface SpotlightValue {
  text: string;
  /** 0..1, for the magnitude bar. Omitted where the number has no scale. */
  bar?: number;
  /** A factor's percentile across today's pool (0-100): drawn as the heat bar and ordinal. */
  percentile?: number | null;
  /** A second, grey line under the value ("9 of 10", "Over 0.5"). */
  sub?: string | null;
  /** Colour for a value that is a verdict on its own (a hit rate of 90%, a run of misses). */
  tone?: 'good' | 'bad' | null;
  /** The value against a baseline: "▲ 12" in good ink, "▼ 8" in bad. */
  delta?: { text: string; up: boolean } | null;
}

/** A team on a row: its abbreviation and logo. */
export interface SpotlightTeam {
  abbr: string;
  logoUrl?: string | null;
}

/** One game in a row's form strip (the shape `FormBars` draws). */
export interface SpotlightGame {
  value: number | null;
  hit: boolean | null;
  label: string;
  detail?: string | null;
}

/** A game's forecast, for the weather card's icons. */
export interface SpotlightWeather {
  windMph: number | null;
  windDir: string | null;
  rainPct: number | null;
  tempF: number | null;
}

export interface SpotlightRow {
  key: string;
  subjectId: string;
  subjectName: string;
  /** "Hits · Over 0.5" — what the rate is a rate OF. */
  market: string;
  /** "TB vs BOS" where the sport gives one. */
  context?: string | null;
  values: Record<string, SpotlightValue>;
  /**
   * The one-line "why", in the reader's words. It opens from the row rather
   * than sitting in a column: at half a 1440 screen, beside five factor
   * columns, a wrapping sentence was simply clipped.
   */
  why: string;
  href?: string | null;
  /** C4: the player's headshot, and the team mark (or golf flag) to fall back to. */
  headshotUrl?: string | null;
  logoUrl?: string | null;
  /** C4: the team mark only (golf has none), for the small badge on the row. */
  teamLogoUrl?: string | null;
  /** v4: team vs opponent, drawn with their logos under the name. */
  team?: SpotlightTeam | null;
  opp?: SpotlightTeam | null;
  /** v4: a GAME subject's two teams and its detail line, for the logo pair. */
  game?: { away: SpotlightTeam; home: SpotlightTeam; sub?: string | null } | null;
  /** v4: the sentence under the name (fixed width, two lines). Set where it says more than the columns. */
  read?: string | null;
  /** v3: the last games against the line, for a `form` column. */
  games?: SpotlightGame[];
  line?: number | null;
  /** v4: the forecast, for a `weather` column. */
  weather?: SpotlightWeather | null;
}

/** The images the candidate's own meta already carries. */
function subjectImages(c: PickCandidate): { headshotUrl: string | null; logoUrl: string | null; teamLogoUrl: string | null } {
  const m = (c.subjectMeta ?? {}) as Record<string, unknown>;
  const teamLogoUrl = typeof m.teamLogoUrl === 'string' ? m.teamLogoUrl : null;
  return {
    headshotUrl: typeof m.headshotUrl === 'string' ? m.headshotUrl : null,
    logoUrl: teamLogoUrl ?? (typeof m.flagUrl === 'string' ? m.flagUrl : null),
    teamLogoUrl,
  };
}

export interface SpotlightColumn {
  key: string;
  label: string;
  /** Names the SOURCE, per the spec: every factor says where it came from. */
  info: string;
  numeric?: boolean;
  /**
   * How the cell draws (slate-polish v4). The DATA names it, never the sport:
   * `market` two lines (market, then side and line); `form` the row's last
   * games as bars against the line; `rate` a bold value with its `sub`,
   * `tone` and `delta`; `factor` the value with its percentile; `weather` the
   * forecast as icons. Unset is plain text.
   */
  kind?: 'market' | 'form' | 'rate' | 'factor' | 'weather';
}

export interface SpotlightCard {
  id: string;
  title: string;
  /**
   * What the first column is a column OF. "Player" unless the card's subjects
   * are not people: MLB's HR parks and N5's weather rank GAMES, and a column
   * headed "Player" over "AZ @ COL" is simply wrong.
   */
  subjectLabel?: string;
  /** What the card is scoped to: "Last 10 games". */
  scope: string;
  columns: SpotlightColumn[];
  rows: SpotlightRow[];
  /** Under the table. Says what the numbers are, and what they are not. */
  caption: string;
  /** Shown instead of rows. Always says WHY, never just "nothing". */
  empty?: string;
}

/* -------------------------------------------------------------------------- */

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

function marketOf(c: PickCandidate): string {
  const line = c.line != null ? ` ${c.line}` : '';
  return `${c.dimensionLabel} · ${c.categoryLabel}${line}`;
}

function contextOf(c: PickCandidate): string | null {
  const meta = c.subjectMeta as Record<string, unknown> | undefined;
  const team = typeof meta?.teamAbbrev === 'string' ? meta.teamAbbrev : typeof meta?.team === 'string' ? meta.team : null;
  const opp = typeof meta?.opponent === 'string' ? meta.opponent : typeof meta?.opponentName === 'string' ? meta.opponentName : null;
  if (team && opp) return `${team} vs ${opp}`;
  return team ?? opp ?? null;
}

/** The row's team and opponent, with their logos, from the candidate's own meta. */
function teamsOf(c: PickCandidate, sport: string): { team: SpotlightTeam | null; opp: SpotlightTeam | null } {
  const m = (c.subjectMeta ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  // Ids arrive as numbers for MLB (StatsAPI's), strings elsewhere.
  const id = (v: unknown) => (typeof v === 'number' ? String(v) : str(v));
  const team = str(m.teamAbbrev) ?? str(m.team);
  const opp = str(m.opponent);
  return {
    team: team ? { abbr: team, logoUrl: str(m.teamLogoUrl) ?? teamLogoFor(sport, id(m.teamId), team) } : null,
    opp: opp ? { abbr: opp, logoUrl: str(m.opponentLogoUrl) ?? teamLogoFor(sport, id(m.opponentId), opp) } : null,
  };
}

/**
 * The last `n` periods as a form strip (v3). A result token is a number, or
 * "H-AB" for a hit-in-game row, so the leading number is the value; a token
 * with none ("E", "hit") draws a stub rather than a guessed height. The label
 * is the period's own ("Aug 4 @ WSH") where the history holds one.
 */
function formOf(c: PickCandidate, sport: string, n = 10): SpotlightGame[] {
  const recent = (c.history ?? []).slice(-n);
  const one = periodNounSingular(sport);
  return recent.map((e, i) => {
    const v = Number.parseFloat(String(e.result));
    const ago = recent.length - i;
    return {
      value: Number.isFinite(v) ? v : null,
      hit: e.category === c.category,
      label: e.periodLabel ?? `${ago} ${ago === 1 ? one : periodNoun(sport)} ago`,
      detail: String(e.result),
    };
  });
}

function hrefOf(c: PickCandidate, sport: string, league?: string | null): string | null {
  if (!c.subjectId) return null;
  if (sport === 'soccer' || sport === 'tennis') return league ? `/${sport}/${league}/player/${c.subjectId}` : null;
  return `/${sport}/player/${c.subjectId}`;
}

export interface SpotlightOptions {
  sport: string;
  league?: string | null;
  /** How many rows a card shows. The spec's range is 5-10. */
  limit?: number;
  /** A rate needs a real window behind it; below this it is not a rate. */
  minSample?: number;
}

/**
 * What a "period" IS, per sport. `readForm` counts periods; for a team sport
 * that is a game, for golf a round and for tennis a match. Golf has 2,489
 * candidates today and no spotlight rows, because a golfer rarely has ten
 * rounds of the same hole held — and an empty state that says "games" would
 * be explaining the wrong thing.
 */
const PERIOD_NOUN: Record<string, { one: string; many: string }> = {
  golf: { one: 'round', many: 'rounds' },
  tennis: { one: 'match', many: 'matches' },
};

function periodNoun(sport: string): string {
  return (PERIOD_NOUN[sport] ?? { many: 'games' }).many;
}

/** Stripping an "s" gives "matche". Sports are not regular nouns. */
function periodNounSingular(sport: string): string {
  return (PERIOD_NOUN[sport] ?? { one: 'game' }).one;
}

/* -------------------------------------------------------------------------- */

/** One row per player. Ranked lists are read as a list of PEOPLE. */
function onePerSubject<T extends { subjectId: string }>(rows: T[], limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.subjectId)) continue;
    seen.add(r.subjectId);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Hit-rate leaders — the best recent over-rate at today's line.
 *
 * WHY A MINIMUM SAMPLE IS THE WHOLE CARD. "100% in 2 of 2" outranks "80% in 8
 * of 10" on rate alone and says far less, so the sample is a column of its own
 * and a candidate under the minimum is not a leader at all.
 *
 * TWO THINGS RUNNING IT ON REAL DATA CHANGED. Three of the first five rows
 * were the same relief pitcher on three of his own markets, so it is one row
 * per player now. And a run of ties at 100% was being broken arbitrarily, so
 * they break on FORM — how far the recent window is above that player's own
 * rate across every game held. A player at 100% who is always at 100% is true
 * and dull; a player at 100% who is usually at 60% is the one worth the row.
 */
export function hitRateLeaders(candidates: PickCandidate[], opts: SpotlightOptions): SpotlightCard {
  const { sport, league, limit = 8, minSample = 8 } = opts;
  const window = 10;
  const seen = new Set<string>();
  const onePerSubjectGuard = (id: string) => (seen.has(id) ? false : (seen.add(id), true));
  const noun = periodNoun(sport);
  const one = periodNounSingular(sport);

  const rows: SpotlightRow[] = candidates
    .map((c) => ({ c, form: readForm(c, { window }) }))
    .filter((r) => isOk(r.form.recent) && r.form.recent.total >= minSample)
    .map((r) => {
      const recent = r.form.recent as Extract<typeof r.form.recent, { status: 'ok' }>;
      const baseline = r.form.baseline;
      return {
        c: r.c,
        recent,
        baselineRate: isOk(baseline) ? baseline.rate : null,
        streak: r.form.streak,
      };
    })
    .sort(
      (a, b) =>
        b.recent.rate - a.recent.rate ||
        (b.recent.rate - (b.baselineRate ?? b.recent.rate)) - (a.recent.rate - (a.baselineRate ?? a.recent.rate)) ||
        b.recent.total - a.recent.total,
    )
    .filter((r) => onePerSubjectGuard(r.c.subjectId))
    .slice(0, limit)
    .map((r) => ({
      key: `${r.c.subjectId}:${r.c.dimension}:${r.c.category}`,
      subjectId: r.c.subjectId,
      subjectName: r.c.subjectName,
      market: marketOf(r.c),
      context: contextOf(r.c),
      values: {
        market: { text: r.c.dimensionLabel, sub: `${r.c.categoryLabel}${r.c.line != null ? ` ${r.c.line}` : ''}` },
        rate: {
          text: pct(r.recent.rate),
          bar: r.recent.rate,
          sub: `${r.recent.hits} of ${r.recent.total}`,
          tone: r.recent.rate >= 0.8 ? 'good' : r.recent.rate <= 0.3 ? 'bad' : null,
        },
        sample: { text: `${r.recent.hits} of ${r.recent.total}` },
        season: {
          text: r.baselineRate == null ? '—' : pct(r.baselineRate),
          delta: r.baselineRate == null ? null : { text: `${Math.abs(Math.round((r.recent.rate - r.baselineRate) * 100))}`, up: r.recent.rate >= r.baselineRate },
        },
        streak: { text: r.streak === 0 ? '—' : r.streak > 0 ? `+${r.streak}` : String(r.streak) },
      },
      ...teamsOf(r.c, sport),
      games: formOf(r.c, sport, window),
      line: r.c.line ?? null,
      why:
        r.baselineRate == null
          ? `Cleared this line in ${r.recent.hits} of the last ${r.recent.total} ${noun}.`
          : r.recent.rate > r.baselineRate
            ? `Cleared this line in ${r.recent.hits} of the last ${r.recent.total} — above their own ${pct(r.baselineRate)} across every ${one} held.`
            : `Cleared this line in ${r.recent.hits} of the last ${r.recent.total}, against ${pct(r.baselineRate)} across every ${one} held.`,
      href: hrefOf(r.c, sport, league),
      ...subjectImages(r.c),
    }));

  return {
    id: 'hit-rate-leaders',
    title: 'Hit-rate leaders',
    scope: `Last ${window} ${noun}`,
    // v4: the sample rides under the rate and the streak is visible in the
    // bars, so neither needs a column of its own any more.
    columns: [
      { key: 'market', label: 'Market', info: 'The market and the line the rate is counted at.', kind: 'market' },
      { key: 'form', label: `Last ${window}`, info: `Each of the last ${window} ${noun}: the bar is what this player did, the dashed rule the line; green cleared it, red missed. Hover a bar for the ${one}.`, kind: 'form' },
      { key: 'rate', label: 'Hit rate', info: `The share of the last ${window} ${noun} in which this player cleared this line. Counted from the logs, not from a model. At least ${minSample} of them must be held.`, numeric: true, kind: 'rate' },
      { key: 'season', label: 'All held', info: `The same rate across every ${one} held for this player, and how far the recent window sits above or below it.`, numeric: true, kind: 'rate' },
    ],
    rows,
    caption: `A count of what happened in the last ${window} ${noun}. It is not a prediction, and it is not compared to a price.`,
    empty: `No player has ${minSample} of their last ${window} ${noun} held for a line on this slate yet.`,
  };
}

/**
 * Active streaks — a run of consecutive games the same way.
 *
 * Both directions, because a run of misses is the same fact as a run of hits
 * and hiding one of them would make the card an argument rather than a count.
 */
export function activeStreaks(candidates: PickCandidate[], opts: SpotlightOptions): SpotlightCard {
  const { sport, league, limit = 8, minSample = 5 } = opts;
  const minStreak = 5;
  const noun = periodNoun(sport);

  const all = candidates
    .map((c) => ({ c, form: readForm(c, { window: 10 }) }))
    .filter((r) => Math.abs(r.form.streak) >= minStreak && r.c.sampleSize >= minSample)
    // A RUN IS ONLY A RUN IF THE THING HAPPENS SOMETIMES. WTA's card came back
    // as eight rows of "Missed this line in each of the last 91 matches" on
    // "To Win a Set · Yes" — which is not a streak, it is the shape of that
    // sport's history: the category never matches, so every period is a miss
    // and the "run" is the whole record. A miss-run needs the player to have
    // cleared the line at least once ever, and a clear-run needs them to have
    // missed it at least once, or the number is a definition rather than form.
    .filter((r) => {
      const base = r.form.baseline;
      if (!isOk(base)) return false;
      return r.form.streak > 0 ? base.rate < 1 : base.rate > 0;
    })
    .sort((a, b) => Math.abs(b.form.streak) - Math.abs(a.form.streak) || b.c.sampleSize - a.c.sampleSize);

  // BOTH DIRECTIONS GET HALF THE CARD. Sorting on magnitude alone filled every
  // row with misses on the real slate — a player who never walks is on a
  // 29-game "streak" of not walking, which is structural rather than a run.
  // Splitting the card keeps it a count of what happened rather than an
  // argument for one side of it.
  const half = Math.ceil(limit / 2);
  const over = onePerSubject(all.filter((r) => r.form.streak > 0).map((r) => ({ ...r, subjectId: r.c.subjectId })), half);
  // Across the whole card, not per half: the same player turned up twice, once
  // for a run of clears and once for a run of misses on a different market.
  // Both were true and the card read as a mistake.
  const taken = new Set(over.map((r) => r.subjectId));
  const under = onePerSubject(
    all.filter((r) => r.form.streak < 0 && !taken.has(r.c.subjectId)).map((r) => ({ ...r, subjectId: r.c.subjectId })),
    limit - over.length,
  );

  const rows: SpotlightRow[] = [...over, ...under]
    .sort((a, b) => Math.abs(b.form.streak) - Math.abs(a.form.streak))
    .map((r) => {
      const isOver = r.form.streak > 0;
      const n = Math.abs(r.form.streak);
      return {
        key: `${r.c.subjectId}:${r.c.dimension}:${r.c.category}`,
        subjectId: r.c.subjectId,
        subjectName: r.c.subjectName,
        market: marketOf(r.c),
        context: contextOf(r.c),
        values: {
          market: { text: r.c.dimensionLabel, sub: `${r.c.categoryLabel}${r.c.line != null ? ` ${r.c.line}` : ''}` },
          streak: { text: `${n} straight`, bar: Math.min(1, n / 10), sub: isOver ? 'cleared it' : 'missed it', tone: isOver ? 'good' : 'bad' },
          direction: { text: isOver ? 'Cleared' : 'Missed' },
          games: { text: String(r.c.sampleSize) },
        },
        ...teamsOf(r.c, sport),
        games: formOf(r.c, sport),
        line: r.c.line ?? null,
        why: `${isOver ? 'Cleared' : 'Missed'} this line in each of the last ${n} ${noun}.`,
        href: hrefOf(r.c, sport, league),
        ...subjectImages(r.c),
      };
    });

  return {
    id: 'active-streaks',
    title: 'Active streaks',
    scope: `${minStreak}+ ${noun} in a row`,
    columns: [
      { key: 'market', label: 'Market', info: 'The market and the line the run is counted at.', kind: 'market' },
      { key: 'form', label: 'Last 10', info: `The last 10 ${noun}: the bar is what this player did, the dashed rule the line; green cleared it, red missed. Hover a bar for the game.`, kind: 'form' },
      { key: 'streak', label: 'Run', info: `How many consecutive most recent ${noun} went the same way, counted from the logs. Both directions are shown: a run of misses is the same fact as a run of hits.`, numeric: true, kind: 'rate' },
    ],
    rows,
    caption: `A count of consecutive ${noun}. A streak is what already happened; it says nothing about the next one.`,
    empty: `Nobody on this slate is on a run of ${minStreak} or more.`,
  };
}

/** Both universal spotlights, in the order the spec lists them. */
export function buildSpotlights(candidates: PickCandidate[], opts: SpotlightOptions): SpotlightCard[] {
  return [hitRateLeaders(candidates, opts), activeStreaks(candidates, opts)];
}

/* -------------------------------------------------------------------------- */
/* F0 — the Python spotlights, as the same card                               */
/* -------------------------------------------------------------------------- */

/**
 * The sport-specific spotlights (`slate_rankings`, `kind='spotlight'`) drawn
 * as the SAME `SpotlightCard` the two universal ones use.
 *
 * WHY CONVERT RATHER THAN ADD A SECOND CARD TYPE. The two TS cards and the
 * Python ones are the same thing to a reader — a short ranked list with its
 * factors and a why — and the section already renders one shape well. A
 * second renderer would be a second place for the columns, the tooltips and
 * the empty state to drift.
 *
 * The rows arrive ranked from the job, so nothing here re-sorts them.
 */
export function flagSpotlightCards(flags: ResearchFlag[], opts: { sport: string; league?: string | null }): SpotlightCard[] {
  const { sport, league } = opts;
  return groupFlags(flags).map((g) => {
    const first = g.flags[0];
    return {
      id: g.rankingId,
      title: g.title,
      subjectLabel: first.subjectKind === 'game' ? 'Game' : 'Player',
      scope: g.frozen ? 'Frozen at the first game' : 'Updates until the first game',
      columns: first.factors.map((f) => ({ key: f.key, label: f.label, info: f.info, numeric: true, kind: 'factor' as const })),
      rows: g.flags.map((f) => ({
        key: `${f.rankingId}:${f.subjectId}`,
        subjectId: f.subjectId,
        subjectName: f.subjectName,
        // The card's title already says what the list is OF, so the line under
        // the name is the matchup rather than the ranking's name again — and
        // nothing at all where the NAME is already the matchup ("AZ @ COL").
        market: '',
        context: f.subjectKind === 'game' ? null : f.opponent ? `${f.team ?? ''} vs ${f.opponent}`.trim() : f.team,
        values: Object.fromEntries(
          f.factors.map((x) => [
            x.key,
            { text: formatFactor(x.key, x.value), bar: x.percentile == null ? undefined : x.percentile / 100, percentile: x.value == null ? null : x.percentile },
          ]),
        ),
        why: f.read ?? g.promo,
        href: flagHref(f, sport, league ?? null),
        // A game-subject row has no face; its team mark carries the identity.
        headshotUrl: f.subjectKind === 'player' ? headshotFor(sport, f.subjectId) : null,
        logoUrl: teamLogoFor(sport, f.teamId, f.team),
        teamLogoUrl: f.subjectKind === 'player' ? teamLogoFor(sport, f.teamId, f.team) : null,
        // v4: a game subject's `team` is the away side and `opponent` the home.
        team: f.subjectKind === 'player' && f.team ? { abbr: f.team, logoUrl: teamLogoFor(sport, f.teamId, f.team) } : null,
        opp: f.subjectKind === 'player' && f.opponent ? { abbr: f.opponent, logoUrl: teamLogoFor(sport, f.opponentId, f.opponent) } : null,
        game:
          f.subjectKind === 'game' && f.team && f.opponent
            ? { away: { abbr: f.team, logoUrl: teamLogoFor(sport, f.teamId, f.team) }, home: { abbr: f.opponent, logoUrl: teamLogoFor(sport, f.opponentId, f.opponent) } }
            : null,
        read: f.read ?? null,
      })),
      caption: `Where each one stands among today's slate on the factors named. A ranking of those factors, not a probability, and not compared to a price.${SOURCE_CREDIT[g.rankingId] ? ` ${SOURCE_CREDIT[g.rankingId]}` : ''}`,
      empty: 'Nothing qualified on this slate.',
    };
  });
}

/** A flag's page: the player's, or the game's where the ranked subject IS the game. */
function flagHref(flag: ResearchFlag, sport: string, league: string | null): string | null {
  const base = sport === 'soccer' || sport === 'tennis' ? (league ? `/${sport}/${league}` : null) : `/${sport}`;
  if (!base) return null;
  return flag.subjectKind === 'game' ? `${base}/game/${flag.subjectId}` : `${base}/player/${flag.subjectId}`;
}

/**
 * N5 — weather games. A FLAG, NOT A RANKING: the spec is explicit that it is
 * never ordered, so the rows keep the slate's own order and the card carries
 * no score. It renders only where a sport's games actually hold a forecast,
 * so nothing here asks which sport it is.
 */
export function weatherSpotlight(cards: SlateGameCard[]): SpotlightCard | null {
  const flagged = cards.filter((c) => c.weatherFlag);
  if (flagged.length === 0) return null;
  return {
    id: 'weather-games',
    title: 'Weather games',
    subjectLabel: 'Game',
    scope: 'Wind over 15 mph or rain over 50%',
    columns: [{ key: 'forecast', label: 'Forecast', info: 'The venue forecast at the start, from Open-Meteo. Only shown where the wind is over 15 mph or rain over 50%; every other game holds a forecast too, on its own card.', kind: 'weather' }],
    rows: flagged.map((c) => ({
      key: c.id,
      subjectId: c.id,
      subjectName: `${c.away.name} @ ${c.home.name}`,
      market: '',
      context: c.venue ?? null,
      values: { forecast: { text: c.weatherFlag as string } },
      why: `${c.weatherFlag} at ${c.venue ?? 'the venue'}, ${c.statusText}.`,
      href: c.href ?? null,
      game: {
        away: { abbr: c.away.abbr ?? c.away.name, logoUrl: c.away.logoUrl ?? null },
        home: { abbr: c.home.abbr ?? c.home.name, logoUrl: c.home.logoUrl ?? null },
        sub: [c.statusText, c.venue].filter(Boolean).join(' · '),
      },
      // A cachedRoute serves the shape it cached: a card from before `weather`
      // existed has none, and the cell falls back to the phrase.
      weather: c.weather ?? null,
    })),
    caption: 'A forecast, not a forecast of anything that happens in the game. It is not ordered: these are the games where the weather is worth knowing.',
  };
}
