/**
 * The team page, built once for every sport — R7. The team counterpart of
 * `playerResearch.ts`: a sport's reader supplies a `TeamResearchPayload`, its
 * spec says how to read it (record shape, units, roster columns), and this
 * builds the scope, the hero and the shared sections. A sport's own sections
 * (MLB's Statcast, NFL's passing game) are added by its adapter.
 *
 * Pure and database-free: the component calls it on every season switch.
 */

import type { ResearchCard, ResearchColumn, ResearchSection, ResearchTableRow, ResearchTile } from './playerResearchShapes';
import { seasonLabel, seasonScope } from './season';
import type { TeamGame, TeamResearchData, TeamResearchPayload, TeamResearchSpec, TeamSeasonData, TeamStatValue } from './teamResearchShapes';

type Result = 'W' | 'L' | 'D' | 'OTL';

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const isFinal = (g: TeamGame) => g.state === 'final' && g.us != null && g.them != null;

/**
 * A final game's result. A hockey loss past regulation is an OTL, never an L
 * (F-B11) — in the regular season only: a playoff game is played to a winner
 * and its record is W-L (R7.3: Utah's 2026 playoffs read "2-2-2").
 */
export function gameResult(g: TeamGame, spec: Pick<TeamResearchSpec, 'record'>): Result {
  const us = g.us ?? 0;
  const them = g.them ?? 0;
  if (us > them) return 'W';
  if (us === them) return 'D';
  return spec.record === 'WLOTL' && !g.postseason && (g.extra === 'OT' || g.extra === 'SO') ? 'OTL' : 'L';
}

export function formatRecord(games: TeamGame[], spec: Pick<TeamResearchSpec, 'record'>): string {
  let w = 0;
  let l = 0;
  let d = 0;
  let otl = 0;
  for (const g of games) {
    const r = gameResult(g, spec);
    if (r === 'W') w++;
    else if (r === 'L') l++;
    else if (r === 'D') d++;
    else otl++;
  }
  if (spec.record === 'WDL') return `${w}-${d}-${l}`;
  if (spec.record === 'WLOTL' && !games.every((g) => g.postseason)) return `${w}-${l}-${otl}`;
  // A tie in a two-way sport is rare enough (an NFL tie) to append rather than to reshape every record.
  return d ? `${w}-${l}-${d}` : `${w}-${l}`;
}

const RECORD_SHAPE: Record<TeamResearchSpec['record'], string> = { WL: 'W-L', WDL: 'W-D-L', WLOTL: 'W-L-OTL' };

/** The streak at the end of these games, oldest first: "W4". */
export function streak(games: TeamGame[], spec: Pick<TeamResearchSpec, 'record'>): string | null {
  if (!games.length) return null;
  const last = gameResult(games[games.length - 1], spec);
  let n = 0;
  for (let i = games.length - 1; i >= 0 && gameResult(games[i], spec) === last; i--) n++;
  return `${last}${n}`;
}

const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthOf = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
/**
 * Month names under a chart of games, each at its month's first game. A month
 * with too few games to hold its label (March's four) gives way to the next,
 * or "Mar" and "Apr" print on top of each other (R7.1 render).
 */
export function monthLabels(dates: string[]): string[] {
  const out = dates.map(() => '');
  const minGap = Math.max(1, Math.floor(dates.length / 14));
  const starts = dates.map((d, i) => (i === 0 || monthOf(d) !== monthOf(dates[i - 1]) ? i : -1)).filter((i) => i >= 0);
  starts.forEach((start, k) => {
    const next = starts[k + 1] ?? dates.length;
    if (next - start >= minGap || k === starts.length - 1) out[start] = monthOf(dates[start]).slice(0, 3);
  });
  return out;
}

const signed = (v: number, decimals: number) => `${v > 0 ? '+' : ''}${v.toFixed(decimals)}`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function scoreText(g: TeamGame, spec: TeamResearchSpec): string {
  return `${gameResult(g, spec)} ${g.us}-${g.them}${g.extra ? ` (${g.extra})` : ''}`;
}

function startText(g: TeamGame): string {
  const t = Date.parse(g.start);
  if (!Number.isFinite(t)) return shortDate(g.date);
  return `${shortDate(g.date)}, ${new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })} ET`;
}

/** Rank 1 is best in the stat's direction; ties share a rank. */
export function leagueRank(stat: Pick<TeamStatValue, 'value' | 'league' | 'direction'>): { rank: number; of: number } {
  const better = stat.league.filter((v) => (stat.direction === 'higher' ? v > stat.value : v < stat.value)).length;
  return { rank: better + 1, of: stat.league.length };
}

/** A team stat declared by a reader: how to read it off that sport's per-team numbers. */
export type TeamStatDef<N> = Omit<TeamStatValue, 'value' | 'league'> & { of: (n: N) => number | null };

/**
 * Every declared stat for one team, with the league's values beside it — the
 * one place a reader's per-team numbers become `TeamStatValue`s (R7.3; NFL, CFB,
 * NBA and NHL each did this loop). The pool is decided by the reader (the
 * standings' own teams, R2's 30% rule); a stat the team or fewer than two
 * teams have is left out rather than ranked on a blank.
 */
export function rankTeamStats<N>(defs: ReadonlyArray<TeamStatDef<N>>, numbers: ReadonlyMap<string, N>, pool: ReadonlySet<string>, teamId: string): TeamStatValue[] {
  const mine = numbers.get(teamId);
  if (mine == null || !pool.has(teamId)) return [];
  const out: TeamStatValue[] = [];
  for (const { of, ...d } of defs) {
    const value = of(mine);
    const league = [...pool].map((id) => numbers.get(id)).filter((n): n is N => n != null).map(of).filter((v): v is number => v != null && Number.isFinite(v));
    if (value == null || !Number.isFinite(value) || league.length < 2) continue;
    out.push({ ...d, value, league });
  }
  return out;
}

export interface BuildTeamResearchInput {
  payload: TeamResearchPayload;
  spec: TeamResearchSpec;
  /** The reader's pick from the season switch; `null` opens on the scope season. */
  season: number | null;
  teamHref: (teamId: string) => string | null;
  now?: Date;
}

export function buildTeamResearch(input: BuildTeamResearchInput): TeamResearchData {
  const { payload, spec, teamHref } = input;
  const now = input.now ?? new Date();
  const sport = spec.seasonSport;
  const byseason = new Map(payload.seasons.map((s) => [s.season, s]));
  const regularFinals = (s: TeamSeasonData | undefined) => (s?.games ?? []).filter((g) => isFinal(g) && !g.postseason);

  // THE SCOPE (R2): last season while the current one is under MIN_GAMES, said so.
  const currentPlayed = regularFinals(byseason.get(payload.currentSeason)).length;
  const scope = seasonScope(sport, currentPlayed, now);
  let season = input.season ?? scope.season;
  let reason = input.season == null ? scope.reason : null;
  if (!byseason.has(season) && payload.seasons.length) {
    const held = payload.seasons[0].season;
    reason = input.season == null ? `No games held for ${seasonLabel(sport, season)}; this shows ${seasonLabel(sport, held)}.` : null;
    season = held;
  }
  const data = byseason.get(season);
  const games = [...(data?.games ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  const finals = games.filter((g) => isFinal(g) && !g.postseason);
  const postFinals = games.filter((g) => isFinal(g) && g.postseason);
  const allFinals = games.filter(isFinal);
  const isCurrent = season === payload.currentSeason;

  // Hero.
  const standingTable = data?.standings[0];
  const position = standingTable ? standingTable.rows.findIndex((r) => r.team.id === payload.team.id) : -1;
  const standing =
    standingTable && position >= 0 && finals.length
      ? `${isCurrent ? '' : 'Finished '}${ordinal(position + 1)} in ${standingTable.title}`
      : null;
  const upcoming = [...(byseason.get(payload.currentSeason)?.games ?? [])]
    .filter((g) => g.state === 'live' || (g.state === 'scheduled' && Date.parse(g.start) >= now.getTime() - 4 * 3_600_000))
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  const diff = finals.reduce((a, g) => a + (g.us! - g.them!), 0);
  const home = finals.filter((g) => g.home);
  const away = finals.filter((g) => !g.home && !g.neutral);
  const tiles: ResearchTile[] = [
    { label: 'Record', value: finals.length ? formatRecord(finals, spec) : '—', info: RECORD_SHAPE[spec.record] },
    { label: 'Home', value: home.length ? formatRecord(home, spec) : '—' },
    { label: 'Away', value: away.length ? formatRecord(away, spec) : '—' },
    { label: spec.diffLabel, value: finals.length ? signed(diff, 0) : '—' },
    { label: `${spec.unit.plural} / game`, value: finals.length ? avg(finals.map((g) => g.us!))!.toFixed(1) : '—' },
    { label: `Allowed / game`, value: finals.length ? avg(finals.map((g) => g.them!))!.toFixed(1) : '—' },
    { label: 'Streak', value: streak(finals, spec) ?? '—' },
    ...(postFinals.length ? [{ label: 'Postseason', value: formatRecord(postFinals, spec) }] : []),
  ];
  // C2b: the scored/allowed tiles carry the league rank the Team stats section
  // computes for the same stat, and print that stat's value so the number and
  // its rank are one measurement.
  const pct = (rank: number, of: number) => (of > 1 ? Math.round(100 * (1 - (rank - 1) / (of - 1))) : 50);
  const ranked = (key: string | undefined) => {
    const s = key ? (data?.stats ?? []).find((x) => x.key === key) : undefined;
    if (!s || new Set(s.league).size < 2) return null;
    const r = leagueRank(s);
    return { value: formatStat(s.value, s), rank: { rank: r.rank, of: r.of, pool: 'teams', percentile: pct(r.rank, r.of) } };
  };
  for (const [label, key] of [
    [`${spec.unit.plural} / game`, spec.heroRanks?.scored],
    ['Allowed / game', spec.heroRanks?.allowed],
  ] as const) {
    const i = tiles.findIndex((t) => t.label === label);
    const r = ranked(key);
    if (i >= 0 && r && finals.length) tiles[i] = { ...tiles[i], value: r.value, rank: r.rank };
  }
  const hero: TeamResearchData['hero'] = {
    record: finals.length ? formatRecord(finals, spec) : '0-0',
    recordShape: RECORD_SHAPE[spec.record],
    standing,
    lastTen: allFinals.slice(-10).map((g) => ({
      result: gameResult(g, spec),
      tip: `${scoreText(g, spec)} ${g.home ? 'vs' : '@'} ${g.opponent.abbr} · ${shortDate(g.date)}`,
      opponent: `${g.home ? 'vs' : '@'} ${g.opponent.abbr ?? g.opponent.name}`,
      opponentLogo: g.opponent.logoUrl ?? null,
      line: `${g.us}-${g.them}${g.extra ? ` (${g.extra})` : ''}`,
    })),
    next: upcoming
      ? {
          label: `${upcoming.state === 'live' ? 'Live' : 'Next'}: ${upcoming.home ? 'vs' : '@'} ${upcoming.opponent.name}`,
          when: `${startText(upcoming)}${upcoming.venue ? ` · ${upcoming.venue}` : ''}`,
          opponent: upcoming.opponent,
          href: upcoming.href,
          homeAway: upcoming.home ? 'vs' : '@',
          live: upcoming.state === 'live',
        }
      : null,
    tiles,
  };

  // Sections summed from the app's own game logs say so when the logs hold
  // fewer games than the team has played (R7-F1: MLS 2026 logs begin in August).
  const logged = data?.loggedGames;
  const shortNote =
    logged != null && logged < allFinals.length
      ? `Summed from the ${logged} of this team's ${allFinals.length} games that the app holds box scores for; the rest are not in these numbers.`
      : undefined;
  const withNote = (sec: ResearchSection): ResearchSection => (shortNote && sec.state.kind === 'ready' ? { ...sec, note: [shortNote, sec.note].filter(Boolean).join(' ') } : sec);
  // P8 O3: the team's next game's odds (the odds section, team scope). A
  // data-declared card; no section when nothing is scheduled.
  const oddsSection: ResearchSection[] = upcoming
    ? [{
        id: 'odds', navLabel: 'Odds', title: 'Odds', sub: `${upcoming.home ? 'vs' : '@'} ${upcoming.opponent.abbr} · next game`,
        rows: [[{
          kind: 'odds', key: 'odds', scope: 'team', sport, gameId: upcoming.id, side: upcoming.home ? 'home' : 'away',
          // The CURRENT season's finals, whatever season the page shows: the closes are this week's.
          past: [...(byseason.get(payload.currentSeason)?.games ?? [])].sort((a, b) => a.start.localeCompare(b.start))
            .filter(g => isFinal(g) && g.us != null && g.them != null && g.start < upcoming.start).slice(-10).reverse()
            .map(g => ({ gameId: g.id, start: g.start, date: g.date, opp: g.opponent.abbr, home: g.home, us: g.us!, them: g.them! })),
          teams: upcoming.home
            ? { home: { abbr: payload.team.abbr }, away: { abbr: upcoming.opponent.abbr } }
            : { home: { abbr: upcoming.opponent.abbr }, away: { abbr: payload.team.abbr } },
        }]],
        state: { kind: 'ready' },
      }]
    : [];
  const sections: ResearchSection[] = [
    resultsSection(spec, season, games, teamHref),
    ...oddsSection,
    ...(data?.standings.length ? [standingsSection(payload, data, season, sport, teamHref)] : []),
    withNote(statsSection(spec, data, season, sport)),
    withNote(rosterSection(spec, data, season, sport)),
  ];

  const played = (s: number) => regularFinals(byseason.get(s)).length;
  return {
    team: payload.team,
    scope: {
      season,
      label: `${seasonLabel(sport, season)} season`,
      reason,
      options: payload.seasons.map((s) => ({
        value: s.season,
        label: s.season === payload.currentSeason ? `${seasonLabel(sport, s.season)} (${played(s.season)} played)` : seasonLabel(sport, s.season),
      })),
    },
    hero,
    sections,
    sources: payload.sources,
  };
}

// ---------------------------------------------------------------------------
// Results & schedule
// ---------------------------------------------------------------------------

function resultsSection(spec: TeamResearchSpec, season: number, games: TeamGame[], teamHref: (id: string) => string | null): ResearchSection {
  const finals = games.filter((g) => isFinal(g) && !g.postseason);
  const post = games.filter((g) => isFinal(g) && g.postseason);
  const toPlay = games.filter((g) => g.state === 'scheduled' || g.state === 'live');
  const base = {
    id: 'results',
    navLabel: 'Results',
    title: 'Results & schedule',
    sub: `${seasonLabel(spec.seasonSport, season)} · ${finals.length} played${post.length ? ` · ${post.length} postseason` : ''}${toPlay.length ? ` · ${toPlay.length} to play` : ''}`,
  };
  if (!games.length) {
    return { ...base, rows: [], state: { kind: 'empty', title: 'No games on the schedule', reason: `The league lists no games for this team in ${seasonLabel(spec.seasonSport, season)}.` } };
  }

  const monthTicks = (gs: TeamGame[]) => monthLabels(gs.map((g) => g.date));
  const margin: ResearchCard = {
    kind: 'histogram',
    key: 'margin',
    title: 'Margin by game',
    scope: 'regular season · bar height is the margin',
    // R9b: a season's bars need room. 20px a game keeps each one readable and
    // wide enough for the opponent's crest, and the card scrolls rather than
    // drawing 153 games as 3px slivers (the operator could not read it).
    minBand: 20,
    height: 260,
    bars: finals.map((g, i) => {
      const r = gameResult(g, spec);
      return {
        key: `${g.id}-${i}`,
        axisLabel: monthTicks(finals)[i],
        imageUrl: g.opponent.logoUrl,
        value: Math.abs(g.us! - g.them!) || 0.25,
        highlight: false,
        tone: r === 'W' ? 'good' : r === 'D' ? undefined : 'bad',
        tip: `${scoreText(g, spec)} ${g.home ? 'vs' : '@'} ${g.opponent.name} · ${shortDate(g.date)}`,
      };
    }),
    toneLegend: { good: 'won', bad: spec.record === 'WLOTL' ? 'lost (any)' : 'lost' },
    caption: `One bar a game, oldest on the left${finals.some((g) => g.opponent.logoUrl) ? '; the crest is the opponent' : ''}. Scrolls sideways across a season.`,
  };
  let run = 0;
  const cumulative = finals.map((g) => (run += g.us! - g.them!));
  const running: ResearchCard = {
    kind: 'series',
    key: 'running',
    title: `Running ${spec.diffLabel.toLowerCase()}`,
    scope: 'after each game',
    values: cumulative,
    xLabels: monthTicks(finals),
    reference: { value: 0, label: 'even' },
    zeroBased: false,
    decimals: 0,
    unit: '',
    tips: finals.map((g, i) => [`${signed(cumulative[i], 0)} after game ${i + 1}`, `${scoreText(g, spec)} ${g.home ? 'vs' : '@'} ${g.opponent.abbr}`]),
  };

  const cols: ResearchColumn[] = [
    { key: 'gp', label: 'GP', decimals: 0 },
    { key: 'rec', label: 'Record', decimals: 0 },
    { key: 'for', label: `${spec.unit.short} for`, decimals: 1 },
    { key: 'against', label: `${spec.unit.short} agst`, decimals: 1 },
    { key: 'diff', label: 'Diff', decimals: 1 },
  ];
  const split = (key: string, label: string, gs: TeamGame[]): ResearchTableRow | null =>
    gs.length
      ? {
          key,
          label,
          values: {
            gp: gs.length,
            rec: formatRecord(gs, spec),
            for: avg(gs.map((g) => g.us!)),
            against: avg(gs.map((g) => g.them!)),
            diff: signed(avg(gs.map((g) => g.us! - g.them!))!, 1),
          },
        }
      : null;
  const months = [...new Set(finals.map((g) => monthOf(g.date)))];
  const close = (g: TeamGame) => Math.abs(g.us! - g.them!) <= spec.closeMargin;
  const splitRows = [
    split('all', 'All games', finals),
    split('home', 'Home', finals.filter((g) => g.home)),
    split('away', 'Away', finals.filter((g) => !g.home && !g.neutral)),
    split('neutral', 'Neutral site', finals.filter((g) => g.neutral)),
    split('close', `Decided by ${spec.closeMargin} or fewer`, finals.filter(close)),
    split('wide', `Decided by more than ${spec.closeMargin}`, finals.filter((g) => !close(g))),
    ...(months.length > 2 ? months.map((m) => split(`m-${m}`, m, finals.filter((g) => monthOf(g.date) === m))) : []),
    split('post', 'Postseason', post),
  ].filter((r): r is ResearchTableRow => r !== null);

  // Newest results first, then what is still to play (G2).
  const done = games.filter(isFinal).reverse();
  const rest = games.filter((g) => !isFinal(g));
  const scheduleRows: ResearchTableRow[] = [...done, ...rest].map((g, i) => {
    const final = isFinal(g);
    const r = final ? gameResult(g, spec) : null;
    return {
      key: `${g.id}-${i}`,
      label: g.opponent.name,
      labelNote: g.home || g.neutral ? 'vs' : '@',
      imageUrl: g.opponent.logoUrl,
      href: teamHref(g.opponent.id),
      values: {
        date: shortDate(g.date),
        result: final ? scoreText(g, spec) : g.state === 'postponed' ? 'Postponed' : g.state === 'live' ? 'Live' : startText(g).split(', ')[1] ?? '',
        // No venue: "vs" and "@" already say whose park, and a venue column
        // clipped the half-width card at 1440 (R7.1 render).
        note: [g.postseason ? g.label ?? 'Postseason' : g.label, g.opponentRank ? `No. ${g.opponentRank}` : null].filter(Boolean).join(' · ') || null,
      },
      ...(r === 'W' ? { tones: { result: 'good' as const } } : r === 'L' || r === 'OTL' ? { tones: { result: 'bad' as const } } : {}),
    };
  });

  // R9d — home against away as a line per stat, not two rows a reader has to
  // subtract. Only where BOTH sides have games: one side alone is no split.
  const homeGames = finals.filter((g) => g.home);
  const awayGames = finals.filter((g) => !g.home && !g.neutral);
  const perGame = (gs: TeamGame[], of: (g: TeamGame) => number) => (gs.length ? gs.reduce((a, g) => a + of(g), 0) / gs.length : null);
  const homeAway: ResearchCard | null =
    homeGames.length && awayGames.length
      ? {
          kind: 'dumbbell',
          key: 'home-away',
          title: 'Home vs away',
          scope: `per game · ${homeGames.length} home, ${awayGames.length} away`,
          aLabel: 'Home',
          bLabel: 'Away',
          rows: [
            { key: 'for', label: `${spec.unit.short} for`, a: perGame(homeGames, (g) => g.us!), b: perGame(awayGames, (g) => g.us!), aSample: homeGames.length, bSample: awayGames.length, decimals: 1 },
            { key: 'against', label: `${spec.unit.short} against`, a: perGame(homeGames, (g) => g.them!), b: perGame(awayGames, (g) => g.them!), aSample: homeGames.length, bSample: awayGames.length, lowerIsBetter: true, decimals: 1 },
            { key: 'diff', label: spec.diffLabel, a: perGame(homeGames, (g) => g.us! - g.them!), b: perGame(awayGames, (g) => g.us! - g.them!), aSample: homeGames.length, bSample: awayGames.length, decimals: 1 },
            { key: 'win', label: 'Win %', a: 100 * (homeGames.filter((g) => gameResult(g, spec) === 'W').length / homeGames.length), b: 100 * (awayGames.filter((g) => gameResult(g, spec) === 'W').length / awayGames.length), aSample: homeGames.length, bSample: awayGames.length, decimals: 0 },
          ],
          caption: 'Each line runs from the home number to the away one.',
        }
      : null;

  const rows: ResearchCard[][] = [];
  if (finals.length) rows.push([margin, ...(finals.length > 1 ? [running] : [])]);
  if (homeAway) rows.push([homeAway]);
  rows.push([
    ...(splitRows.length
      ? [{ kind: 'table', key: 'splits', title: 'Splits', scope: 'per game', labelHeader: 'Split', columns: cols, rows: splitRows, fixedOrder: true } as ResearchCard]
      : []),
    {
      kind: 'table',
      key: 'schedule',
      title: 'Schedule',
      scope: 'newest results first, then upcoming',
      labelHeader: 'Opponent',
      columns: [
        { key: 'date', label: 'Date', decimals: 0 },
        { key: 'result', label: 'Result', decimals: 0 },
        ...(scheduleRows.some((r) => r.values.note) ? [{ key: 'note', label: 'Game', decimals: 0 }] : []),
      ],
      rows: scheduleRows,
      fixedOrder: true,
    },
  ]);
  return { ...base, rows, state: { kind: 'ready' } };
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

function standingsSection(payload: TeamResearchPayload, data: TeamSeasonData, season: number, sport: string, teamHref: (id: string) => string | null): ResearchSection {
  const cards: ResearchCard[] = data.standings.map((t, i) => ({
    kind: 'table',
    key: `standings-${i}`,
    title: t.title,
    scope: 'this team marked',
    labelHeader: 'Team',
    columns: [{ key: 'pos', label: '#', decimals: 0 }, ...t.columns],
    rows: t.rows.map((r, j) => ({
      key: r.team.id,
      label: r.team.name,
      imageUrl: r.team.logoUrl,
      href: r.href ?? teamHref(r.team.id),
      highlight: r.team.id === payload.team.id,
      labelNote: r.team.id === payload.team.id ? 'this team' : null,
      values: { pos: j + 1, ...r.values },
    })),
    fixedOrder: true,
  }));
  return {
    id: 'standings',
    navLabel: 'Standings',
    title: 'Standings',
    sub: `${seasonLabel(sport, season)}${season === payload.currentSeason ? ', as it stands' : ', final'}`,
    rows: cards.map((c) => [c]),
    state: { kind: 'ready' },
  };
}

// ---------------------------------------------------------------------------
// Team stats
// ---------------------------------------------------------------------------

const pctile = (rank: number, of: number) => (of > 1 ? Math.round(100 * (1 - (rank - 1) / (of - 1))) : 50);

function statsSection(spec: TeamResearchSpec, data: TeamSeasonData | undefined, season: number, sport: string): ResearchSection {
  // A stat every team shares (games played in a season) ranks nothing: dropped (plan R7).
  const stats = (data?.stats ?? []).filter((s) => new Set(s.league).size > 1);
  const base = { id: 'stats', navLabel: 'Team stats', title: 'Team stats', sub: `${seasonLabel(sport, season)} · ranked across the league, best first` };
  if (!stats.length) {
    return { ...base, rows: [], state: { kind: 'empty', title: 'No team stats for this season', reason: 'The league has not published team statistics for it yet.' } };
  }
  const groups = [...new Set(stats.map((s) => s.group))];
  const cards: ResearchCard[] = groups.map((group) => {
    const rows = stats.filter((s) => s.group === group);
    return {
      kind: 'percentiles',
      key: `stats-${group}`,
      title: group,
      scope: `rank of ${rows[0].league.length} · dot strip is every team`,
      info: 'Ranked across every team with the better direction set per stat; a source’s own ranks are not used.',
      caption: spec.statCaptions?.[group],
      rows: rows.map((s) => {
        const r = leagueRank(s);
        return {
          key: s.key,
          label: s.label,
          valueText: formatStat(s.value, s),
          // `RankRow` reads a percentile as a position along the values and
          // flips it for a lower-is-better stat, so a best-first rank is
          // turned back into a position here.
          percentile: s.direction === 'lower' ? 100 - pctile(r.rank, r.of) : pctile(r.rank, r.of),
          direction: s.direction,
          info: s.info,
          rank: r,
          strip: { league: s.league, value: s.value },
        };
      }),
    };
  });
  const rows: ResearchCard[][] = [];
  for (let i = 0; i < cards.length; i += 2) rows.push(cards.slice(i, i + 2));
  return { ...base, rows, state: { kind: 'ready' } };
}

function formatStat(v: number, s: Pick<TeamStatValue, 'decimals' | 'format'>): string {
  if (s.format === 'rate3') {
    const t = v.toFixed(3);
    return t.startsWith('0.') ? t.slice(1) : t;
  }
  const t = v.toFixed(s.decimals);
  return s.format === 'percent' ? `${t}%` : t;
}

// ---------------------------------------------------------------------------
// Roster production
// ---------------------------------------------------------------------------

function rosterSection(spec: TeamResearchSpec, data: TeamSeasonData | undefined, season: number, sport: string): ResearchSection {
  const base = { id: 'roster', navLabel: 'Roster', title: 'Roster production', sub: `${seasonLabel(sport, season)} · from the app's game logs` };
  const roster = data?.roster ?? [];
  if (!roster.length) {
    return { ...base, rows: [], state: { kind: 'empty', title: 'No player games held for this season', reason: 'Roster production is summed from player game logs, and none are held for this team and season.' } };
  }
  const views = spec.roster.groups
    .map((g) => {
      const members = roster.filter(g.include);
      return {
        key: g.key,
        label: `${g.label} · ${members.length}`,
        labelHeader: 'Player',
        sortKey: g.sortKey,
        columns: [{ key: 'games', label: 'G', decimals: 0 }, ...g.columns.map(({ value: _value, ...c }) => c)] as ResearchColumn[],
        rows: members.map<ResearchTableRow>((e) => ({
          key: e.id,
          label: e.name,
          labelNote: e.position,
          imageUrl: e.headshotUrl,
          imageKind: 'player',
          href: e.href,
          values: { games: e.games, ...Object.fromEntries(g.columns.map((c) => [c.key, c.value(e)])) },
        })),
      };
    })
    .filter((v) => v.rows.length);
  if (!views.length) {
    return { ...base, rows: [], state: { kind: 'empty', title: 'No players to list', reason: 'None of the held players fit a roster group.' } };
  }
  const [first] = views;
  return {
    ...base,
    rows: [
      [
        {
          kind: 'table',
          key: 'roster',
          title: 'Players',
          scope: 'click a column to sort',
          caption: spec.roster.caption,
          labelHeader: first.labelHeader,
          columns: first.columns,
          rows: first.rows,
          sortKey: first.sortKey,
          views,
        },
      ],
    ],
    state: { kind: 'ready' },
  };
}
