/**
 * `TeamDetail.tsx` adapter — NHL half.
 *
 * Real Team Detail, matching MLB/NFL/soccer/CFB/NBA's shape (2026-08-23):
 * real candidates (`buildNhlMoneylineCandidate`/`buildNhlGameTotalCandidate`,
 * built from this team's own real recent results — nhle.ts's own real
 * schedule/score data), real windows/distribution/games table through the
 * same windowedStat engine every other sport runs through. `grades`/
 * `matchup`/`statGroups` stay null/empty — no grading model or league-wide
 * season-stats index for NHL yet. Real: roster (every real NHL player,
 * identity carried via the roster link's own query params so a player with
 * zero active props still gets an honest page), next fixture (no real
 * pregame-line source for NHL — see nhle.ts's header), real record from
 * standings.
 */

import type { HoopsHockeyTeamResearchPayload } from '@/lib/sports/multiSport/hoopsHockeyTeamResearch';
import type { ShotCell, TeamShotProfile } from '@/lib/sports/shared/teamProductionShapes';
import { buildTeamResearch, leagueRank } from '@/lib/sports/shared/teamResearch';
import { seasonLabel } from '@/lib/sports/shared/season';
import type { ResearchCard, ResearchSection } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamResearchData } from '@/lib/sports/shared/teamResearchShapes';
import { NHL_TEAM_SPEC } from './teamResearchSpec';
import type { RecentResultRow } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { NhlTeam, NhlGame } from '@/lib/sports/nhl/nhle';
import type { EspnInjuryRow } from '@/lib/sports/multiSport/teamSportEspn';
interface NhlRosterSeasonStats {
  games: number;
  goals: number;
  assists: number;
  points: number;
}


export interface NhlTeamDetailApiResponse {
  team: NhlTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null; seasonStats: NhlRosterSeasonStats | null }>;
  nextGame: NhlGame | null;
  nextGameLine: null;
  recentGames: NhlGame[];
  /** Real, confirmed live 2026-08-24 against ESPN's NHL injuries feed — matched by team name, see the route's own comment. */
  injuries: EspnInjuryRow[];
  /** Real logo per real NHL abbreviation (2026-08-24) — feeds the distribution chart's `logoFor`. */
  logoByAbbr: Record<string, string>;
}

export function toNhlRecentResultRows(games: NhlGame[], teamAbbr: string): RecentResultRow[] {
  return games.map((g) => {
    const isHome = g.homeAbbr === teamAbbr;
    const scoreFor = isHome ? g.homeScore : g.awayScore;
    const scoreAgainst = isHome ? g.awayScore : g.homeScore;
    const resolved = scoreFor != null && scoreAgainst != null;
    return {
      gameId: g.gameId,
      date: g.date,
      win: resolved ? scoreFor > scoreAgainst : null,
      opponentAbbr: isHome ? g.awayAbbr : g.homeAbbr,
      isHome,
      scoreFor: scoreFor ?? 0,
      scoreAgainst: scoreAgainst ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// R7.3 — the team research page
// ---------------------------------------------------------------------------

/**
 * NHL's team page: the shared team research read through NHL's spec, plus
 * NHL's own section, "Shot map" — where attempts come from for and against,
 * shot types, and volume against the league (R5c `team_shot_profile`).
 */
export function toTeamResearchData(input: { payload: HoopsHockeyTeamResearchPayload; season: number | null; now?: Date }): TeamResearchData {
  const data = buildTeamResearch({ payload: input.payload, spec: NHL_TEAM_SPEC, season: input.season, teamHref: (id) => `/nhl/team/${encodeURIComponent(id)}`, now: input.now });
  const season = data.scope.season;
  return { ...data, sections: [...data.sections, nhlShotMapSection(input.payload.shots[String(season)] ?? null, season)] };
}

const RINK_ROWS = [
  { label: 'Slot', max: 25 },
  { label: 'High slot', max: 45 },
  { label: 'Point', max: 64 },
];
const RINK_COLS = ['Left', 'Middle', 'Right'];

/**
 * 5-ft bins onto the rink surface's nine areas. A bin key is
 * `floor(|x| / 5) | floor((y + 42.5) / 5)`, x from centre ice, folded to one
 * attacking end, with the goal line at 89 ft; the bin is placed by its centre.
 * Behind the net counts as the slot. Attempts from beyond 64 ft of the goal
 * line (outside the offensive zone) are not on the surface and are counted.
 */
export function rinkAreas(bins: Record<string, ShotCell> | undefined): { cells: Array<Array<{ att: number; goals: number }>>; total: number; outside: number } {
  const cells = RINK_ROWS.map(() => RINK_COLS.map(() => ({ att: 0, goals: 0 })));
  let total = 0;
  let outside = 0;
  for (const [key, [att, goals = 0]] of Object.entries(bins ?? {})) {
    const [xi, yi] = key.split('|').map(Number);
    total += att;
    const fromGoal = 89 - (xi * 5 + 2.5);
    const y = yi * 5 - 40;
    const row = RINK_ROWS.findIndex((r) => fromGoal < r.max);
    if (row < 0) {
      outside += att;
      continue;
    }
    const c = y < -12 ? 0 : y > 12 ? 2 : 1;
    cells[row][c].att += att;
    cells[row][c].goals += goals;
  }
  return { cells, total, outside };
}

export function nhlShotMapSection(shots: TeamShotProfile | null, season: number): ResearchSection {
  const base = { id: 'shots', navLabel: 'Shot map', title: 'Shot map', sub: `${seasonLabel('nhl', season)} regular season · nhl_shot_events` };
  if (!shots?.for?.bins) {
    return { ...base, rows: [], state: { kind: 'empty', title: `No shot locations for ${seasonLabel('nhl', season)}`, reason: 'team_shot_profile holds no row for this team and season.' } };
  }
  const f = rinkAreas(shots.for.bins);
  const a = rinkAreas(shots.allowed?.bins);
  const inZone = (x: ReturnType<typeof rinkAreas>) => x.total - x.outside;
  const view = (key: string, label: string, x: ReturnType<typeof rinkAreas>, games: number) => ({
    key,
    label,
    role: {
      title: label,
      surface: 'rink' as const,
      measure: 'share' as const,
      cells: x.cells.map((row, r) => row.map((c, ci) => ({ key: `${r}|${ci}`, value: inZone(x) ? (100 * c.att) / inZone(x) : null, sampleSize: c.att }))),
      rowLabels: RINK_ROWS.map((r) => r.label),
      columnLabels: RINK_COLS,
      domain: { lo: 0, hi: 40 },
      format: (v: number) => `${v.toFixed(0)}%`,
      unit: '% of attempts',
      caption: `${inZone(x).toLocaleString('en-US')} attempts in the offensive zone over ${games} games; ${x.outside.toLocaleString('en-US')} from farther out are not drawn`,
    },
  });
  const map: ResearchCard = {
    kind: 'surface',
    key: 'rink',
    title: 'Where attempts come from',
    scope: 'share of attempts, goals, missed and blocked included',
    views: [view('for', 'Shots for', f, shots.for.games), ...(shots.allowed?.bins ? [view('against', 'Shots against', a, shots.allowed.games)] : [])],
  };
  const areas: ResearchCard = {
    kind: 'table',
    key: 'areas',
    title: 'By area',
    scope: 'attempts and goals, for and against',
    labelHeader: 'Area',
    fixedOrder: true,
    columns: [
      { key: 'fAtt', label: 'For', decimals: 0 },
      { key: 'fG', label: 'Goals', decimals: 0 },
      { key: 'fPct', label: 'G/att', decimals: 1, format: 'percent' },
      { key: 'aAtt', label: 'Against', decimals: 0 },
      { key: 'aG', label: 'Goals', decimals: 0 },
      { key: 'aPct', label: 'G/att', decimals: 1, format: 'percent' },
    ],
    rows: RINK_ROWS.flatMap((r, ri) =>
      RINK_COLS.map((c, ci) => {
        const fc = f.cells[ri][ci];
        const ac = a.cells[ri][ci];
        return {
          key: `${ri}|${ci}`,
          label: `${r.label}, ${c.toLowerCase()}`,
          values: { fAtt: fc.att, fG: fc.goals, fPct: fc.att ? (100 * fc.goals) / fc.att : null, aAtt: ac.att, aG: ac.goals, aPct: ac.att ? (100 * ac.goals) / ac.att : null },
        };
      }),
    ),
    caption: 'Goals per attempt, not shooting %: blocked and missed attempts are in the denominator.',
  };
  const leagueRates = Object.values(shots.league)
    .filter((t) => t.attempts != null && t.games)
    .map((t) => t.attempts! / t.games);
  const myRate = shots.for.attempts != null && shots.for.games ? shots.for.attempts / shots.for.games : null;
  const volumeRank = myRate != null && leagueRates.length > 1 ? leagueRank({ value: myRate, league: leagueRates, direction: 'higher' }) : null;
  const volume: ResearchCard = {
    kind: 'percentiles',
    key: 'volume',
    title: 'Volume',
    scope: `rank of ${leagueRates.length} teams with 40+ games`,
    rows:
      myRate != null && volumeRank
        ? [
            {
              key: 'attempts',
              label: 'Shot attempts / game',
              valueText: myRate.toFixed(1),
              percentile: Math.round(100 * (1 - (volumeRank.rank - 1) / Math.max(1, volumeRank.of - 1))),
              direction: 'higher' as const,
              rank: volumeRank,
              strip: { league: leagueRates, value: myRate },
            },
          ]
        : [],
  };
  const typeKeys = [...new Set([...Object.keys(shots.for.types ?? {}), ...Object.keys(shots.allowed?.types ?? {})])];
  const types: ResearchCard = {
    kind: 'table',
    key: 'types',
    title: 'Shot types',
    scope: 'attempts, for and against',
    labelHeader: 'Type',
    sortKey: 'for',
    columns: [
      { key: 'for', label: 'For', decimals: 0 },
      { key: 'against', label: 'Against', decimals: 0 },
    ],
    rows: typeKeys.map((t) => ({
      key: t,
      label: t === 'unknown' ? 'not recorded (mostly blocked)' : t,
      values: { for: shots.for!.types?.[t] ?? 0, against: shots.allowed?.types?.[t] ?? 0 },
    })),
  };
  return { ...base, sub: `${base.sub} · ${shots.for.games} games`, rows: [[map, areas], [volume, types]], state: { kind: 'ready' } };
}
