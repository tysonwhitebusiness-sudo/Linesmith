/**
 * `GameDetail.tsx` adapter — tennis half.
 *
 * Converts `/api/tennis/[tour]/game/[gameId]`'s response (fetched by
 * `useTennisGameDetail`) into the shared `GameDetailData` interface. Real:
 * hero (real set scores, status, country flags used as the "team" logo
 * slot — honest for an individual sport with no crest), season record +
 * last-five + head-to-head (from stats.tennismylife.org, same real source
 * `adapter.ts`'s player-level history uses), left-rail props. `matchup`/
 * `statComparison`/`rankings`/`unitGrades`/`propsForGame` stay `null` — no
 * grading model or opponent-conditional stat source for tennis, same
 * honest gap soccer's/CFB's adapters already document. No `pregameLines`
 * either: tennis's real markets (aces/games-won/to-win-a-set) aren't
 * moneyline-shaped, so there's no real game-level price to surface here —
 * the per-player prop board is the whole story for tennis, same reasoning
 * NHL's adapter documents for its own missing pregame line.
 */

import type { PickCandidate, TennisTour } from '@/lib/core/types';
import type { EspnTennisMatchDetail } from '@/lib/sports/multiSport/espnTennis';
import type { GameDetailData, RecentResultRow } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import type { RecordsSectionTeam, LastFiveGamesTeam } from '@/components/GameDetail';

interface RecentResultRowWire {
  gameId: string;
  date: string;
  win: boolean;
  opponentAbbr: string;
  isHome: boolean;
  scoreFor: number;
  scoreAgainst: number;
}

function toRows(wire: RecentResultRowWire[]): RecentResultRow[] {
  return wire.map((r) => ({ gameId: r.gameId, date: r.date, win: r.win, opponentAbbr: r.opponentAbbr, isHome: r.isHome, scoreFor: r.scoreFor, scoreAgainst: r.scoreAgainst }));
}

function toRecord(rows: RecentResultRow[]): { wins: number; losses: number } | null {
  if (rows.length === 0) return null;
  return { wins: rows.filter((r) => r.win === true).length, losses: rows.filter((r) => r.win === false).length };
}

export interface TennisGameDetailInput {
  tour: TennisTour;
  meta: EspnTennisMatchDetail;
  player1Recent: RecentResultRowWire[];
  player2Recent: RecentResultRowWire[];
  player1H2h: RecentResultRowWire[];
  player2H2h: RecentResultRowWire[];
  /** Page-filtered player-level candidates for this match. */
  candidates: PickCandidate[];
}

export function toGameDetailData(input: TennisGameDetailInput): GameDetailData {
  const { tour, meta, player1Recent, player2Recent, player1H2h, player2H2h, candidates } = input;

  const p1Recent = toRows(player1Recent);
  const p2Recent = toRows(player2Recent);
  const p1H2h = toRows(player1H2h);
  const p2H2h = toRows(player2H2h);

  const isLive = meta.status.state === 'in';
  const isFinal = meta.status.state === 'post';

  // Player1/player2 map onto the shared hero's away/home slots — arbitrary
  // for an individual sport with no real home/away, same convention
  // `multiSportGameContext.ts`'s tennis branch already documents.
  const hero: GameDetailData['hero'] = {
    away: {
      abbr: meta.player2.name,
      name: meta.player2.name,
      href: `/tennis/${tour}/player/${encodeURIComponent(meta.player2.subjectId)}`,
      logoUrl: meta.player2.flagUrl ?? undefined,
      record: toRecord(p2Recent),
      streak: null,
      tintColor: 'rgba(120,120,120,0.15)',
    },
    home: {
      abbr: meta.player1.name,
      name: meta.player1.name,
      href: `/tennis/${tour}/player/${encodeURIComponent(meta.player1.subjectId)}`,
      logoUrl: meta.player1.flagUrl ?? undefined,
      record: toRecord(p1Recent),
      streak: null,
      tintColor: 'rgba(120,120,120,0.15)',
    },
    isLive,
    isFinal,
    liveScore: isLive || isFinal ? { away: String(meta.player2.setsWon[0] ?? 0), home: String(meta.player1.setsWon[0] ?? 0) } : undefined,
    livePeriodLabel: isLive || isFinal ? meta.status.detail : undefined,
    startTimeLabel: new Date(meta.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    model: null,
    pickLockAt: null,
    pickLoading: false,
    venue: null,
    pregameLines: null,
  };

  const records: { away: RecordsSectionTeam; home: RecordsSectionTeam; loading: boolean } = {
    away: { abbr: meta.player2.name, logoUrl: meta.player2.flagUrl ?? undefined, divisionRank: null, season: toRecord(p2Recent), seasonHome: null, seasonAway: null, recent: p2Recent.slice(0, 5), h2h: p2H2h },
    home: { abbr: meta.player1.name, logoUrl: meta.player1.flagUrl ?? undefined, divisionRank: null, season: toRecord(p1Recent), seasonHome: null, seasonAway: null, recent: p1Recent.slice(0, 5), h2h: p1H2h },
    loading: false,
  };

  const lastFive: { away: LastFiveGamesTeam; home: LastFiveGamesTeam; loading: boolean } = {
    away: { abbr: meta.player2.name, logoUrl: meta.player2.flagUrl ?? undefined, games: p2Recent.slice(0, 5) },
    home: { abbr: meta.player1.name, logoUrl: meta.player1.flagUrl ?? undefined, games: p1Recent.slice(0, 5) },
    loading: false,
  };

  return {
    gameId: meta.matchId,
    hero,
    matchup: null,
    records,
    statComparison: null,
    lastFive,
    rankings: null,
    unitGrades: null,
    injuries: { away: { abbr: meta.player2.name, logoUrl: meta.player2.flagUrl ?? undefined, rows: [] }, home: { abbr: meta.player1.name, logoUrl: meta.player1.flagUrl ?? undefined, rows: [] }, loading: false },
    propsForGame: null,
    picksPanelGame: { id: meta.matchId, sport: 'tennis', awayAbbr: meta.player2.name, homeAbbr: meta.player1.name, homeTeamId: null, awayTeamId: null, gameModel: null },
    leftRail: { candidates, goodBetsGated: false },
  };
}
