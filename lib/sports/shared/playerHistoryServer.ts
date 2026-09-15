/**
 * One player's games, every season held — the server half of the player page's
 * history (R6.1a). Read by `/api/player-history` only.
 *
 * `player_game_history` holds 2-4 seasons per sport and the pages read one
 * (Gap 1 of the card audit); this reads them all. Written by the Python
 * `genericPlayerHistoryFreshnessJob` and its backfills, so this is a direct
 * read of a table kept fresh out of band — CLAUDE.md's route pattern 2.
 *
 * RESULTS, measured 2026-09-15 and refereed against the leagues' own scores:
 *   - NFL, CFB, NBA and soccer: `game_result.event_ref` equals the history's
 *     `event_id` (both ESPN event ids) — an exact join.
 *   - NHL: the history uses NHL game ids and the results ESPN refs, so NHL
 *     joins on the team pair (NHL API team ids in both tables). Checked against
 *     api-web's club schedules for MacKinnon, Matthews and Vasilevskiy: 584
 *     scores agree, 0 disagree, 13 unjoined (games absent from the table).
 *   - MLB: NOT `game_result` — see `getTeamSeasonFinals` for why. Results come
 *     from StatsAPI's team schedules, keyed by the same game pk.
 *   - Tennis: the row's own `match_won`, sets as the score.
 *
 * THE G2 DATASETS ARE WRONG HERE, so a mismatch against them is not a failure.
 * They joined by team name within a day, which on a back-to-back or a series
 * takes the neighbouring game: Dončić's 2023-11-16 game at Washington (a
 * 130-117 win) sits in G2 as the previous night's 110-131 loss. Every disputed
 * game checked (9, MLB and NHL) agreed with the league and not with G2.
 *
 * Opponent names and logos come from each sport's existing team directory
 * (all cached upstream: snapshot_cache or StatsAPI's own cache). A team no
 * longer in the league (a relegated club, a moved franchise) falls back to the
 * name on the joined result row.
 */

import { pgAll } from '@/lib/db/pgClient';
import { dedupeGameResults, type GameResultRow } from '@/lib/history/gameResults';
import type { HistorySport, PlayerGame, PlayerHistory, RawStat } from './playerResearchShapes';

const RESULTS_SOURCE: Record<HistorySport, string> = {
  mlb: 'MLB Stats API team schedules, by game pk',
  nfl: 'game_result, joined on the ESPN event id',
  cfb: 'game_result, joined on the ESPN event id',
  nba: 'game_result, joined on the ESPN event id',
  nhl: 'game_result, joined on the team pair and date',
  soccer_epl: 'game_result, joined on the ESPN event id',
  soccer_mls: 'game_result, joined on the ESPN event id',
  tennis_atp: 'the match row itself (sets won and lost)',
  tennis_wta: 'the match row itself (sets won and lost)',
};

interface TeamEntry {
  name: string | null;
  abbr: string | null;
  logoUrl: string | null;
}

const DIRECTORY_TTL_MS = 6 * 60 * 60_000;
const directoryMemo = new Map<string, { at: number; map: Map<string, TeamEntry> }>();

async function loadDirectory(sport: HistorySport): Promise<Map<string, TeamEntry>> {
  const hit = directoryMemo.get(sport);
  if (hit && Date.now() - hit.at < DIRECTORY_TTL_MS) return hit.map;
  const map = new Map<string, TeamEntry>();
  try {
    if (sport === 'mlb') {
      const { getAllTeams } = await import('@/lib/sports/mlb/statsapi');
      for (const t of await getAllTeams()) map.set(String(t.id), { name: t.name, abbr: t.abbreviation, logoUrl: `https://www.mlbstatic.com/team-logos/${t.id}.svg` });
    } else if (sport === 'nfl') {
      const { getStandings } = await import('@/lib/sports/nfl/espn');
      for (const t of await getStandings()) map.set(String(t.teamId), { name: t.displayName, abbr: t.abbreviation, logoUrl: t.logoUrl ?? null });
    } else if (sport === 'cfb') {
      const { fetchAllTeams } = await import('@/lib/sports/cfb/espn');
      for (const t of await fetchAllTeams()) map.set(String(t.teamId), { name: t.name, abbr: t.abbreviation, logoUrl: t.logoUrl ?? null });
    } else if (sport === 'nba') {
      const { fetchAllTeams } = await import('@/lib/sports/nba/espn');
      for (const t of await fetchAllTeams()) map.set(String(t.teamId), { name: t.name, abbr: t.abbreviation, logoUrl: t.logoUrl ?? null });
    } else if (sport === 'nhl') {
      const { fetchAllTeams } = await import('@/lib/sports/nhl/nhle');
      for (const t of await fetchAllTeams()) map.set(String(t.teamId), { name: t.name, abbr: t.abbreviation, logoUrl: t.logoUrl ?? null });
    } else if (sport === 'soccer_epl' || sport === 'soccer_mls') {
      const { fetchAllTeams } = await import('@/lib/sports/soccer/espn');
      for (const t of await fetchAllTeams(sport === 'soccer_epl' ? 'epl' : 'mls')) map.set(String(t.teamId), { name: t.name, abbr: t.abbreviation, logoUrl: t.logoUrl ?? null });
    }
  } catch {
    // A directory outage costs the opponent's logo, not the page: names fall back to the result row.
  }
  directoryMemo.set(sport, { at: Date.now(), map });
  return map;
}

function isoDate(v: Date | string): string {
  return typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}

function daysApart(a: string, b: string): number {
  return Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

function shiftDate(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

interface HistoryRow {
  season: number;
  event_id: string;
  game_date: Date | string;
  team_id: string | null;
  opponent_id: string | null;
  is_home: boolean | null;
  stats: Record<string, RawStat> | string;
  fetched_at: Date | string | null;
}

/**
 * Which result row belongs to a game (every sport but MLB and tennis). Exported
 * for the test.
 *
 *  1. The exact event ref.
 *  2. Else the team pair on the same date, when exactly one.
 *  3. Else the team pair within a day, when exactly one (a source that dated an
 *     evening game by UTC). Two candidates stay unjoined rather than guessed.
 */
export function matchResult(
  game: { eventId: string; date: string; teamId: string | null; opponentId: string | null },
  byRef: Map<string, GameResultRow>,
  results: readonly GameResultRow[],
): GameResultRow | null {
  const exact = byRef.get(game.eventId);
  if (exact) return exact;
  if (!game.teamId || !game.opponentId) return null;
  const pair = results.filter(
    (r) => (r.homeTeamId === game.teamId && r.awayTeamId === game.opponentId) || (r.homeTeamId === game.opponentId && r.awayTeamId === game.teamId),
  );
  const sameDay = pair.filter((r) => r.gameDate === game.date);
  if (sameDay.length > 0) return sameDay.length === 1 ? sameDay[0] : null;
  const near = pair.filter((r) => daysApart(r.gameDate, game.date) <= 1);
  return near.length === 1 ? near[0] : null;
}

/** MLB finals for every team-season the player's rows touch, from StatsAPI, as result rows keyed by game pk. */
async function mlbFinalsByPk(rows: readonly HistoryRow[]): Promise<Map<string, GameResultRow>> {
  const { getTeamSeasonFinals } = await import('@/lib/sports/mlb/statsapi');
  const pairs = [...new Set(rows.filter((r) => r.team_id).map((r) => `${r.team_id}|${r.season}`))];
  const out = new Map<string, GameResultRow>();
  for (const key of pairs) {
    const [team, season] = key.split('|');
    const finals = await getTeamSeasonFinals(Number(team), Number(season));
    for (const [pk, f] of finals) {
      out.set(pk, { id: Number(pk), sport: 'mlb', gameDate: '', homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId, homeTeamRaw: '', awayTeamRaw: '', homeScore: f.homeScore, awayScore: f.awayScore, venue: null, source: 'statsapi', eventStart: null });
    }
  }
  return out;
}

export async function readPlayerHistory(sport: HistorySport, athleteId: string): Promise<PlayerHistory> {
  const rows = await pgAll<HistoryRow>(
    `SELECT season, event_id, game_date, team_id, opponent_id, is_home, stats, fetched_at
       FROM player_game_history
      WHERE sport = $1 AND athlete_id = $2
      ORDER BY game_date, event_id`,
    [sport, athleteId],
  );
  if (rows.length === 0) return { sport, athleteId, games: [], asOf: null, resultsSource: RESULTS_SOURCE[sport] };

  const isTennis = sport === 'tennis_atp' || sport === 'tennis_wta';
  const first = isoDate(rows[0].game_date);
  const last = isoDate(rows[rows.length - 1].game_date);
  const teamIds = [...new Set(rows.map((r) => r.team_id).filter((t): t is string => Boolean(t)))];

  // Tennis opponents are athletes, not teams: their names come from the
  // crosswalk, which holds a row (name-only where no ESPN match) for every
  // athlete in `player_game_history`.
  const tennisNames = isTennis
    ? pgAll<{ athlete_id: string; athlete_name: string | null }>(
        `SELECT DISTINCT ON (athlete_id) athlete_id, athlete_name FROM athlete_crosswalk
          WHERE sport = $1 AND athlete_id = ANY($2::text[]) AND athlete_name IS NOT NULL
          ORDER BY athlete_id, built_at DESC`,
        [sport, [...new Set(rows.map((r) => r.opponent_id).filter((t): t is string => Boolean(t)))]],
      ).then((rs) => new Map(rs.map((r) => [String(r.athlete_id), r.athlete_name as string])))
    : Promise.resolve(new Map<string, string>());

  const isMlb = sport === 'mlb';
  const [resultsRaw, directory, names, mlbFinals] = await Promise.all([
    isTennis || isMlb
      ? Promise.resolve([] as Array<{ row: GameResultRow; ref: string | null }>)
      : pgAll<{
          id: number;
          game_date: Date | string;
          home_team_id: string | null;
          away_team_id: string | null;
          home_team_raw: string;
          away_team_raw: string;
          home_score: number;
          away_score: number;
          source: string;
          event_ref: string | null;
        }>(
          `SELECT id, game_date, home_team_id, away_team_id, home_team_raw, away_team_raw, home_score, away_score, source, event_ref
             FROM game_result
            WHERE sport = $1
              AND home_score IS NOT NULL AND away_score IS NOT NULL
              AND game_date BETWEEN $2 AND $3
              AND (event_ref = ANY($4::text[]) OR home_team_id = ANY($5::text[]) OR away_team_id = ANY($5::text[]))`,
          [sport, shiftDate(first, -1), shiftDate(last, 1), rows.map((r) => String(r.event_id)), teamIds],
        ).then((rs) =>
          rs.map((r) => ({
            row: {
              id: r.id,
              sport,
              gameDate: isoDate(r.game_date),
              homeTeamId: r.home_team_id,
              awayTeamId: r.away_team_id,
              homeTeamRaw: r.home_team_raw,
              awayTeamRaw: r.away_team_raw,
              homeScore: r.home_score,
              awayScore: r.away_score,
              venue: null,
              source: r.source,
              eventStart: null,
            } satisfies GameResultRow,
            ref: r.event_ref,
          })),
        ),
    loadDirectory(sport),
    tennisNames,
    isMlb ? mlbFinalsByPk(rows).catch(() => new Map<string, GameResultRow>()) : Promise.resolve(new Map<string, GameResultRow>()),
  ]);

  // Rank sources per event ref first, so a live_capture score-in-progress never beats a final.
  const withRefs = resultsRaw as Array<{ row: GameResultRow; ref: string | null }>;
  const kept = new Set(dedupeGameResults(withRefs.map((x) => x.row)).map((r) => r.id));
  const byRef = new Map<string, GameResultRow>();
  for (const x of withRefs) {
    if (!x.ref) continue;
    const cur = byRef.get(x.ref);
    if (!cur || (kept.has(x.row.id) && !kept.has(cur.id))) byRef.set(x.ref, x.row);
  }
  const results = withRefs.map((x) => x.row).filter((r) => kept.has(r.id));

  let asOf: string | null = null;
  const games: PlayerGame[] = rows.map((r) => {
    const stats = (typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats) as Record<string, RawStat>;
    const fetched = r.fetched_at == null ? null : typeof r.fetched_at === 'string' ? r.fetched_at : r.fetched_at.toISOString();
    if (fetched && (!asOf || fetched > asOf)) asOf = fetched;
    const game = {
      eventId: String(r.event_id),
      date: isoDate(r.game_date),
      teamId: r.team_id,
      opponentId: r.opponent_id,
      isHome: r.is_home,
    };
    const dir = r.opponent_id ? directory.get(String(r.opponent_id)) : undefined;

    if (isTennis) {
      const won = stats.match_won;
      const setsWon = typeof stats.sets_won === 'number' ? stats.sets_won : null;
      const setsLost = typeof stats.sets_lost === 'number' ? stats.sets_lost : null;
      return {
        ...game,
        season: r.season,
        stats,
        result: won === true || won === 1 ? 'W' : won === false || won === 0 ? 'L' : null,
        teamScore: setsWon,
        opponentScore: setsLost,
        opponent: { name: r.opponent_id ? names.get(String(r.opponent_id)) ?? null : null, abbr: null, logoUrl: null },
      };
    }

    const res = isMlb ? mlbFinals.get(game.eventId) ?? null : matchResult(game, byRef, results);
    let teamScore: number | null = null;
    let opponentScore: number | null = null;
    let oppRaw: string | null = null;
    if (res) {
      // Side by team id when it matches either; else by the history's own home flag.
      const home = res.homeTeamId === r.team_id ? true : res.awayTeamId === r.team_id ? false : r.is_home;
      if (home != null) {
        teamScore = home ? res.homeScore : res.awayScore;
        opponentScore = home ? res.awayScore : res.homeScore;
        oppRaw = home ? res.awayTeamRaw : res.homeTeamRaw;
      }
    }
    return {
      ...game,
      season: r.season,
      stats,
      result: teamScore == null || opponentScore == null ? null : teamScore > opponentScore ? 'W' : teamScore < opponentScore ? 'L' : 'D',
      teamScore,
      opponentScore,
      opponent: { name: dir?.name ?? oppRaw, abbr: dir?.abbr ?? null, logoUrl: dir?.logoUrl ?? null },
    };
  });

  return { sport, athleteId, games, asOf, resultsSource: RESULTS_SOURCE[sport] };
}
