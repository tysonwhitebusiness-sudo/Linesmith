/**
 * NFL adapter — normalises real ESPN roster + nflverse box-score history
 * into `PickCandidate`s, same contract MLB's adapter.ts produces.
 *
 * Candidates are built from roster + history alone, same as MLB's — NOT
 * gated on a live prop_odds row existing (an earlier version of this file
 * got this backwards, requiring a real book line before a player showed up
 * at all, which meant the Players page stayed empty until the season's odds
 * posted broadly). Real book prices, when `prop_odds` has one for a given
 * subject+market, override the sensible per-market default line below and
 * populate `odds` — exactly the same "history first, price layered on top"
 * pattern MLB's `MLB_STAT_MARKETS` defaults (`pitcher-strikeouts` -> 4.5,
 * etc.) already establish; a missing price is never a reason to hide the
 * player, only a reason `odds` stays unset (the UI's own "no price yet"
 * states already handle that honestly).
 *
 * Deliberately leaner than MLB's 2,300-line adapter: covers the 8 highest-
 * value markets (passing/rushing/receiving yards+TDs, receptions,
 * interceptions), position-gated so a lineman never gets a passing-yards
 * candidate, and has no model-probability layer (no Elo/park-factor
 * equivalent exists for NFL yet).
 *
 * History comes from nflverse-data's weekly player stats (real 2025-season
 * box scores, the current/fresh nflverse pipeline — see nflverse.ts's header
 * comment for why the older `player_stats.csv` release is deliberately not
 * used) via the espn_id -> gsis_id crosswalk. A rookie or a player with no
 * crosswalk entry simply gets an empty history, which the engine already
 * renders honestly ("insufficient") rather than needing special-casing here.
 */

import type { HistoryEntry, LiveState, PickCandidate, SplitEvidence, SportSnapshot, SubjectSummary } from '@/lib/core/types';
import { candidateKey } from '@/lib/core/types';
import { subsetWindow } from '@/lib/core/windowedStat';
import { loadGameContextsForSport } from '@/lib/odds/props/multiSportGameContext';
import { readPropOddsForGame, type PropOddsRow } from '@/lib/db/client';
import {
  getEspnToGsisMap,
  getPlayerMarketHistory,
  getPlayerWeeklyBoxScores,
  getPlayerSeasonStatsByGsis,
  getPlayerSeasonRanksByGsis,
  getTeamDefenseAllowedWithRank,
  MOST_RECENT_STATS_SEASON,
  NFLVERSE_STAT_COLUMN_BY_MARKET,
  type PlayerSeasonStats,
} from './nflverse';
import { getCachedNflPlayerRankings } from './nflPlayerRankings';

// "25-Wk16 vs KC" rather than "Wk 16" — DistributionChart's bar label takes
// only periodLabel's first whitespace-delimited token, so a bare "Wk 16"
// (space between the two halves of the only information worth showing)
// silently truncated to just "Wk" on every bar. Season+week is one token now.
function shortWeekLabel(season: string, week: string): string {
  return `${season.slice(-2)}-Wk${week}`;
}

// Local copy rather than importing components/SubjectAvatar.tsx's version —
// same choice teamFormCandidates.ts already makes, to keep this server-side
// data module clear of any 'use client' boundary.
function nflTeamLogoUrl(abbreviation: string | undefined): string | undefined {
  return abbreviation ? `https://a.espncdn.com/i/teamlogos/nfl/500/${abbreviation.toLowerCase()}.png` : undefined;
}

/** Short real season line for the Players-page sidebar list — same role MLB's own subjects carry via `statusLine`, just never populated for NFL before. */
function subjectStatusLine(position: string | undefined, seasonStats: PlayerSeasonStats | undefined): string | undefined {
  if (!seasonStats || seasonStats.games === 0) return undefined;
  switch (position) {
    case 'QB':
      return `${seasonStats.passingYards} pass yds · ${seasonStats.passingTds} pass TD`;
    case 'RB':
    case 'FB':
      return `${seasonStats.rushingYards} rush yds · ${seasonStats.rushingTds} rush TD`;
    case 'WR':
    case 'TE':
      return `${seasonStats.receptions} rec · ${seasonStats.receivingYards} rec yds`;
    default:
      return undefined;
  }
}

/**
 * Which of a team's/opponent's real defense-allowed groups a position's own
 * markets should be compared against — same table
 * `NflPlayerVsDefenseCard.tsx`'s exported one uses, duplicated here (not
 * imported) for the same reason `nflTeamLogoUrl` above is: this file can't
 * import from a 'use client' component module. A list, not a single group:
 * nflverse's Receiving group is thin (only `receptions-allowed` is real —
 * receiving yards/TDs allowed are identical to pass-yards/TDs-allowed at the
 * team level), so a WR/TE also gets the broader Passing-defense context
 * their real outlook actually tracks.
 */
const MATCHUP_GROUP_BY_POSITION: Record<string, string[]> = {
  QB: ['Passing'],
  RB: ['Rushing', 'Receiving'],
  FB: ['Rushing', 'Receiving'],
  WR: ['Passing', 'Receiving'],
  TE: ['Passing', 'Receiving'],
};

const MARKET_LABELS: Record<string, string> = {
  'passing-yards': 'Passing Yards',
  'passing-tds': 'Passing TDs',
  'rushing-yards': 'Rushing Yards',
  'rushing-tds': 'Rushing TDs',
  'receiving-yards': 'Receiving Yards',
  receptions: 'Receptions',
  'receiving-tds': 'Receiving TDs',
  'interceptions-thrown': 'Interceptions Thrown',
};

/**
 * Typical sportsbook lines, used until a real `prop_odds` row for that exact
 * subject+market attaches a real one — same role MLB's per-dimension
 * defaults play. These are round-number, position-appropriate starting
 * points, not a claim about any specific player.
 */
const DEFAULT_LINES: Record<string, number> = {
  'passing-yards': 224.5,
  'passing-tds': 1.5,
  'rushing-yards': 44.5,
  'rushing-tds': 0.5,
  'receiving-yards': 44.5,
  receptions: 3.5,
  'receiving-tds': 0.5,
  'interceptions-thrown': 0.5,
};

/** Which markets are even sensible for a position — a lineman never gets a passing-yards candidate. */
const MARKETS_BY_POSITION: Record<string, string[]> = {
  QB: ['passing-yards', 'passing-tds', 'interceptions-thrown', 'rushing-yards', 'rushing-tds'],
  RB: ['rushing-yards', 'rushing-tds', 'receiving-yards', 'receptions', 'receiving-tds'],
  FB: ['rushing-yards', 'rushing-tds', 'receiving-yards', 'receptions', 'receiving-tds'],
  WR: ['receiving-yards', 'receptions', 'receiving-tds'],
  TE: ['receiving-yards', 'receptions', 'receiving-tds'],
};

function bestOverPrice(rows: PropOddsRow[]): PropOddsRow | null {
  const overs = rows.filter((r) => r.side === 'over');
  if (overs.length === 0) return null;
  return overs.reduce((best, r) => (r.americanOdds > best.americanOdds ? r : best), overs[0]);
}

function liveStateFor(gameDate: string): LiveState {
  const kickoff = Date.parse(gameDate);
  const now = Date.now();
  if (!Number.isFinite(kickoff)) return { status: 'unknown', distanceToSubject: null, distanceUnit: 'games', etaMinutes: null, etaConfidence: null };
  if (now < kickoff) {
    const hoursOut = Math.round((kickoff - now) / 3_600_000);
    return { status: 'pre', distanceToSubject: 1, distanceUnit: 'games', etaMinutes: hoursOut * 60, etaConfidence: 'measured' };
  }
  // Past kickoff — no live play-by-play feed wired yet (see the plan's live
  // game-state open item), so "live" games render as done rather than
  // guessing a false live status with nothing to back it.
  return { status: 'done', distanceToSubject: 0, distanceUnit: 'games', etaMinutes: null, etaConfidence: null };
}

export async function buildNflSnapshot(): Promise<SportSnapshot> {
  const games = await loadGameContextsForSport('nfl');
  const candidates: PickCandidate[] = [];
  const subjectsMap = new Map<string, SubjectSummary>();
  const warnings: string[] = [];
  // NFL's 14-day scoreboard window means the same player can appear in two
  // different upcoming games' rosters at once (this week's and next week's)
  // — without this, a player missing a crosswalk entry got the exact same
  // warning pushed once per game, which is what actually produced the wall
  // of duplicate "No nflverse id mapping" lines (and the React duplicate-key
  // console error from AppShell.tsx keying on the warning text itself).
  const warnedAthletes = new Set<string>();
  // Fetched once (cached 24h, see nflverse.ts) rather than per-candidate —
  // this is a 25k-row lookup table, not something to re-derive per player.
  const [espnToGsis, defenseAllowedByTeam, seasonStatsByGsis, seasonRanksByGsis] = await Promise.all([
    getEspnToGsisMap(),
    getTeamDefenseAllowedWithRank(),
    getPlayerSeasonStatsByGsis(),
    getPlayerSeasonRanksByGsis(),
  ]);
  // Cached-only variant — never recomputes on this path (see
  // nflPlayerRankings.ts's own doc comment: the live snapshot build can't
  // afford a cold full-pool recompute). Null until something else (the team
  // route, or a future scheduled job) has computed it at least once.
  const playerRankings = getCachedNflPlayerRankings();

  for (const game of games) {
    // Real book prices, keyed by subjectId|marketKey — an overlay, not a gate.
    const rowsByKey = new Map<string, PropOddsRow[]>();
    for (const row of readPropOddsForGame(game.gameId)) {
      if (!(row.marketKey in NFLVERSE_STAT_COLUMN_BY_MARKET)) continue;
      const key = `${row.subjectId}|${row.marketKey}`;
      const bucket = rowsByKey.get(key) ?? [];
      bucket.push(row);
      rowsByKey.set(key, bucket);
    }
    const priceByKey = new Map<string, PropOddsRow>();
    for (const [key, rows] of rowsByKey) {
      const best = bestOverPrice(rows);
      if (best) priceByKey.set(key, best);
    }

    for (const rosterEntry of game.roster) {
      const marketsForPosition = rosterEntry.position ? MARKETS_BY_POSITION[rosterEntry.position] : undefined;
      if (!marketsForPosition) continue; // position not skill-position-relevant to the markets this adapter covers (or unknown)

      const isHome = rosterEntry.teamAbbr === game.homeAbbr;
      const opponentAbbr = isHome ? game.awayAbbr : game.homeAbbr;

      // espn:nfl:{athleteId} — see teamSportEspn.ts's subjectId scheme.
      const athleteId = rosterEntry.subjectId.split(':')[2];
      const gsisId = athleteId ? espnToGsis.get(athleteId) : undefined;
      if (!gsisId) {
        if (athleteId && !warnedAthletes.has(athleteId)) {
          warnedAthletes.add(athleteId);
          warnings.push(`No nflverse id mapping for ${rosterEntry.subjectName} (espn id ${athleteId}).`);
        }
        continue;
      }

      // Fetched once per player (not per market) — every market's history
      // below reads from the same real weekly box score, both for its own
      // tracked value and for the extra columns a gamelog needs.
      const boxScores = await getPlayerWeeklyBoxScores(gsisId);
      const boxByWeek = new Map(boxScores.map((b) => [b.week, b]));
      const opponentDefenseGroups = rosterEntry.position ? MATCHUP_GROUP_BY_POSITION[rosterEntry.position] ?? [] : [];
      const opponentDefenseAllowed = (defenseAllowedByTeam[opponentAbbr] ?? []).filter((s) => opponentDefenseGroups.includes(s.group ?? ''));
      const seasonStats = seasonStatsByGsis.get(gsisId);
      const seasonRanks = seasonRanksByGsis.get(gsisId);
      const composite = playerRankings?.byGsis.get(gsisId);

      for (const marketKey of marketsForPosition) {
        const realPrice = priceByKey.get(`${rosterEntry.subjectId}|${marketKey}`);
        const line = realPrice?.line ?? DEFAULT_LINES[marketKey];
        if (line == null) continue;

        let history: HistoryEntry[] = [];
        try {
          const weekly = await getPlayerMarketHistory(gsisId, marketKey);
          // raw carries only the grouping fields every market's gamelog row
          // needs (opponent/season/week) — the full box score (12 fields)
          // used to be duplicated here per market too (up to 10x for one
          // player), which was the single largest contributor to a 22MB
          // snapshot payload that froze the tab on every NFL page open. The
          // full box score now lives once per subject, in
          // subjectsMap's `weeklyBoxScores` below; NflPlayerDetail.tsx's
          // gamelog table reads it from there.
          history = weekly.map((w, i) => ({
            period: i + 1,
            result: String(w.value),
            category: w.value > line ? 'over' : 'under',
            periodLabel: `${shortWeekLabel(MOST_RECENT_STATS_SEASON, w.week)} vs ${w.opponentAbbr}`,
            raw: {
              opponentAbbr: w.opponentAbbr,
              season: MOST_RECENT_STATS_SEASON,
              week: w.week,
            },
          } satisfies HistoryEntry));
        } catch {
          warnings.push(`Could not load stat history for ${rosterEntry.subjectName}.`);
        }

        // A market this player's real history never touches (e.g. a WR who
        // never once had a rushing attempt) isn't worth a candidate — skip
        // rather than show an all-zero "insufficient" row for every skill
        // player on every possible market.
        if (history.length === 0) continue;

        const consistent = history.every((h) => h.category === 'over');

        // One honest split for the "Form" card: how this exact market has
        // gone the last time(s) this player faced this exact opponent.
        // Almost always thin (NFL teams meet 0-2x/season) — an honest
        // `insufficient` result is still a real result, not a reason to
        // fabricate a home/away split from data this adapter doesn't have.
        const vsOpponentSplit: SplitEvidence = {
          kind: 'head-to-head',
          label: `vs ${opponentAbbr}`,
          stat: subsetWindow(history, 'over', (e) => (e.raw as Record<string, unknown>)?.opponentAbbr === opponentAbbr, { minimum: 1 }),
        };

        candidates.push({
          sport: 'nfl',
          subjectId: rosterEntry.subjectId,
          subjectName: rosterEntry.subjectName,
          subjectMeta: {
            team: rosterEntry.teamAbbr,
            position: rosterEntry.position,
            opponent: opponentAbbr,
            isHome,
            headshotUrl: rosterEntry.headshotUrl,
            teamLogoUrl: nflTeamLogoUrl(rosterEntry.teamAbbr),
            opponentLogoUrl: nflTeamLogoUrl(opponentAbbr),
            // seasonStats/seasonRanks/opponentDefenseAllowed/the composite-
            // rank fields are identical across every one of this player's
            // candidates (a player averages 7.6 markets this season, some
            // over 10) — attaching a ~2KB copy to each one was inflating the
            // snapshot payload to 22MB and freezing the tab on every NFL page
            // open. They live once on `subjects[].meta` instead (below);
            // NflPlayerDetail.tsx reads them from there now.
            // Named gamePk (not gameId) to match the key every generic
            // component already reads — see the string-vs-number note this
            // file used to carry; unchanged reasoning.
            gamePk: game.gameId,
          },
          supportingSplits: [vsOpponentSplit],
          dimension: marketKey,
          dimensionLabel: MARKET_LABELS[marketKey] ?? marketKey,
          category: 'over',
          categoryLabel: 'Over',
          line,
          history,
          consistent,
          sampleSize: history.length,
          liveState: liveStateFor(game.gameDate),
          odds: realPrice ? { americanOdds: String(realPrice.americanOdds), source: 'odds-api', capturedAt: realPrice.fetchedAt } : undefined,
        });

        if (!subjectsMap.has(rosterEntry.subjectId)) {
          subjectsMap.set(rosterEntry.subjectId, {
            subjectId: rosterEntry.subjectId,
            subjectName: rosterEntry.subjectName,
            meta: {
              headshotUrl: rosterEntry.headshotUrl,
              teamLogoUrl: nflTeamLogoUrl(rosterEntry.teamAbbr),
              opponentLogoUrl: nflTeamLogoUrl(opponentAbbr),
              position: rosterEntry.position,
              seasonStats,
              seasonRanks,
              opponentDefenseAllowed,
              positionRank: composite?.positionRank ?? null,
              positionPoolSize: composite?.positionPoolSize ?? null,
              sideOfBallRank: composite?.sideOfBallRank ?? null,
              sideOfBallPoolSize: composite?.sideOfBallPoolSize ?? null,
              positionComposite: composite?.positionComposite ?? null,
              // One real weekly box score per player (see the history-
              // building comment above) — the gamelog table's extra columns
              // (Cmp/Att/Rush Yds/Rec TD/...) look this up by week instead of
              // reading a per-market duplicate.
              weeklyBoxScores: Object.fromEntries(boxByWeek),
            },
            statusLine: subjectStatusLine(rosterEntry.position, seasonStats),
          });
        }
      }
    }
  }

  // Real duplicate candidates, not a rendering artifact — the 14-day
  // scoreboard window means a player rostered on two upcoming games gets the
  // exact same subjectId+market+category pushed twice (once per game, see
  // the loop above), which is the same key every consumer renders by
  // (`candidateKey`). Player Detail already scoped itself to whichever game
  // is soonest at read time; doing it once here, at build time, means every
  // consumer (Scan's table/card list included) gets a real de-duplicated
  // list instead of literal duplicate rows — this is what was showing up as
  // repeated player/market rows and React duplicate-key warnings on Scan.
  const gameDateByPk = new Map(games.map((g) => [g.gameId, g.gameDate]));
  const bestByKey = new Map<string, PickCandidate>();
  for (const c of candidates) {
    const key = candidateKey(c);
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, c);
      continue;
    }
    const existingDate = gameDateByPk.get(String(existing.subjectMeta?.gamePk)) ?? '';
    const candidateDate = gameDateByPk.get(String(c.subjectMeta?.gamePk)) ?? '';
    if (candidateDate < existingDate) bestByKey.set(key, c);
  }
  const dedupedCandidates = [...bestByKey.values()];

  return {
    sport: 'nfl',
    eventName: 'NFL',
    eventDetail: null,
    status: 'pre',
    candidates: dedupedCandidates,
    subjects: [...subjectsMap.values()],
    context: { other: { games: games.map((g) => ({ gamePk: g.gameId, matchup: `${g.awayAbbr}@${g.homeAbbr}`, awayTeamName: g.awayTeamName, homeTeamName: g.homeTeamName, firstPitch: g.gameDate })) } },
    // Defensive final dedupe — the crosswalk-mapping push above already
    // guards its own duplicate source, but any other warning added later
    // shouldn't have to re-derive the same guard to stay honest about count.
    warnings: [...new Set(warnings)],
    fetchedAt: new Date().toISOString(),
  };
}
