/**
 * `TeamDetail.tsx` adapter — NBA half. Mirrors CFB's/soccer's team
 * adapter: no grading model (`grades: null`), no team-level windows/
 * distribution (same deferred gap as CFB/soccer). Real: roster, next
 * fixture with a real single-book pregame line, a recent-fixtures list
 * with real scores, real record/rank from standings.
 */

import type { HoopsHockeyTeamResearchPayload } from '@/lib/sports/multiSport/hoopsHockeyTeamResearch';
import type { ShotCell, TeamShotProfile } from '@/lib/sports/shared/teamProductionShapes';
import { buildTeamResearch, leagueRank, ordinal } from '@/lib/sports/shared/teamResearch';
import { seasonLabel } from '@/lib/sports/shared/season';
import type { ResearchCard, ResearchSection } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamResearchData } from '@/lib/sports/shared/teamResearchShapes';
import { NBA_TEAM_SPEC } from './teamResearchSpec';
import type { RecentResultRow } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { NbaTeam, NbaPregameLine } from '@/lib/sports/nba/espn';
import type { EspnTeamSportGame } from '@/lib/sports/multiSport/teamSportEspn';
import type { EspnInjuryRow } from '@/lib/sports/multiSport/teamSportEspn';
interface NbaRosterSeasonStats {
  games: number;
  points: number;
  rebounds: number;
  assists: number;
}


export interface NbaTeamDetailApiResponse {
  team: NbaTeam;
  roster: Array<{ subjectId: string; fullName: string; position: string | null; headshotUrl: string | null; seasonStats: NbaRosterSeasonStats | null }>;
  nextGame: EspnTeamSportGame | null;
  nextGameLine: NbaPregameLine | null;
  recentGames: EspnTeamSportGame[];
  /** Real, confirmed live 2026-08-24 against ESPN's NBA injuries feed. */
  injuries: EspnInjuryRow[];
  /** Real logo per real NBA abbreviation (2026-08-24) — feeds the distribution chart's `logoFor`. */
  logoByAbbr: Record<string, string>;
}

/** Real final scores from ESPN's scoreboard `score`/`status` fields — no draws in basketball, so `isDraw` is always false. */
export function toNbaRecentResultRows(games: EspnTeamSportGame[], teamId: string): RecentResultRow[] {
  return games.map((g) => {
    const isHome = g.homeTeamId === teamId;
    const scoreFor = isHome ? g.homeScore : g.awayScore;
    const scoreAgainst = isHome ? g.awayScore : g.homeScore;
    const resolved = g.status?.completed === true && scoreFor != null && scoreAgainst != null;
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
 * NBA's team page: the shared team research read through NBA's spec, plus
 * NBA's own section, "Shot profile" — where the team shoots and is shot
 * against by zone, and how well, against the league (R5c `team_shot_profile`).
 */
export function toTeamResearchData(input: { payload: HoopsHockeyTeamResearchPayload; season: number | null; now?: Date }): TeamResearchData {
  const data = buildTeamResearch({ payload: input.payload, spec: NBA_TEAM_SPEC, season: input.season, teamHref: (id) => `/nba/team/${encodeURIComponent(id)}`, now: input.now });
  const season = data.scope.season;
  return { ...data, sections: [...data.sections, nbaShotProfileSection(input.payload.shots[String(season)] ?? null, season)] };
}

const NBA_ZONES = ['Restricted area', 'Paint (non-RA)', 'Mid-range', 'Corner 3', 'Above-break 3'] as const;

function zoneTotals(zones: Record<string, ShotCell> | undefined) {
  const total = NBA_ZONES.reduce((a, z) => a + (zones?.[z]?.[0] ?? 0), 0);
  return NBA_ZONES.map((z) => {
    const [att = 0, made = 0, pts = 0] = zones?.[z] ?? [];
    return { zone: z, att, share: total ? (100 * att) / total : null, fg: att ? (100 * made) / att : null, pps: att ? pts / att : null };
  });
}

export function nbaShotProfileSection(shots: TeamShotProfile | null, season: number): ResearchSection {
  const base = { id: 'shots', navLabel: 'Shot profile', title: 'Shot profile', sub: `${seasonLabel('nba', season)} regular season · nba_shot_events` };
  if (!shots?.for?.zones) {
    return { ...base, rows: [], state: { kind: 'empty', title: `No shot locations for ${seasonLabel('nba', season)}`, reason: 'team_shot_profile holds no row for this team and season.' } };
  }
  const mine = zoneTotals(shots.for.zones);
  const allowed = zoneTotals(shots.allowed?.zones);
  const league = Object.values(shots.league).map((t) => zoneTotals(t.zones));
  const games = shots.for.games;
  const avg = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const leagueShare = NBA_ZONES.map((_, i) => avg(league.map((l) => l[i].share)));
  const rankOf = (value: number | null, values: Array<number | null>, direction: 'higher' | 'lower') => {
    const pool = values.filter((v): v is number => v != null);
    return value == null || pool.length < 2 ? null : leagueRank({ value, league: pool, direction });
  };
  // The court surface has four rows (rim, paint, mid-range, three); the two three-point zones share the last.
  const courtRows = (values: Array<number | null>) =>
    [values[0], values[1], values[2], values[3] == null && values[4] == null ? null : (values[3] ?? 0) + (values[4] ?? 0)].map((value, r) => [{ key: `z${r}`, value }]);
  const role = (key: string, label: string, values: Array<number | null>, caption: string) => ({
    key,
    label,
    role: {
      title: label,
      surface: 'halfCourt' as const,
      measure: 'share' as const,
      cells: courtRows(values),
      rowLabels: ['Restricted area', 'Paint', 'Mid-range', 'Three'],
      domain: { lo: 0, hi: 45 },
      format: (v: number) => `${v.toFixed(0)}%`,
      unit: '% of attempts',
      caption,
    },
  });
  const map: ResearchCard = {
    kind: 'surface',
    key: 'court',
    title: 'Where the shots come from',
    scope: 'share of field-goal attempts',
    views: [
      role('for', 'This team', mine.map((z) => z.share), `${mine.reduce((a, z) => a + z.att, 0).toLocaleString('en-US')} attempts in ${games} games`),
      role('allowed', 'Opponents', allowed.map((z) => z.share), `${allowed.reduce((a, z) => a + z.att, 0).toLocaleString('en-US')} attempts against`),
      role('league', 'League average', leagueShare, `Mean of ${league.length} teams with 40+ games`),
    ],
  };
  const table: ResearchCard = {
    kind: 'table',
    key: 'zones',
    title: 'By zone',
    scope: `ranks among ${league.length} teams`,
    labelHeader: 'Zone',
    fixedOrder: true,
    columns: [
      { key: 'fga', label: 'FGA/G', decimals: 1 },
      { key: 'share', label: 'Share', decimals: 1, format: 'percent' },
      { key: 'lgShare', label: 'Lg share', decimals: 1, format: 'percent' },
      { key: 'fg', label: 'FG%', decimals: 1, format: 'percent' },
      { key: 'fgRank', label: 'Rank', decimals: 0 },
      { key: 'pps', label: 'Pts/shot', decimals: 2 },
      { key: 'ofg', label: 'Opp FG%', decimals: 1, format: 'percent', info: 'What opponents shot from this zone' },
    ],
    rows: mine.map((z, i) => {
      const r = rankOf(z.fg, league.map((l) => l[i].fg), 'higher');
      return {
        key: z.zone,
        label: z.zone,
        values: { fga: games ? z.att / games : null, share: z.share, lgShare: leagueShare[i], fg: z.fg, fgRank: r ? ordinal(r.rank) : null, pps: z.pps, ofg: allowed[i].fg },
      };
    }),
    caption: 'Points per shot counts a made three as three and a make at the rim as two; free throws are not shots here.',
  };
  const shooting: ResearchCard = {
    kind: 'percentiles',
    key: 'zone-fg',
    title: 'Shooting by zone',
    scope: `FG% · dot strip is every team`,
    rows: mine
      .map((z, i) => {
        const pool = league.map((l) => l[i].fg).filter((v): v is number => v != null);
        const r = rankOf(z.fg, pool, 'higher');
        if (z.fg == null || !r) return null;
        return { key: z.zone, label: z.zone, valueText: `${z.fg.toFixed(1)}%`, percentile: Math.round(100 * (1 - (r.rank - 1) / Math.max(1, r.of - 1))), direction: 'higher' as const, rank: r, strip: { league: pool, value: z.fg } };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
  };
  return { ...base, sub: `${base.sub} · ${games} games`, rows: [[map, table], [shooting]], state: { kind: 'ready' } };
}
