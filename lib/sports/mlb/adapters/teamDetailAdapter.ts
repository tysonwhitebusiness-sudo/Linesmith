/**
 * Adapter for MLB's Team Detail page — Phase 1 of the sport-adapter design
 * (docs/sport-adapter-design.md §4). Pure data transform, no JSX: takes the
 * same inputs `components/TeamDetail.tsx` already has available (teamId,
 * snapshot, odds, and its hook results) plus the UI-selected market/scope
 * state that component keeps in its own `useState`, and produces the
 * generic `TeamDetailData` shape that a future genericized `TeamDetail`
 * would render.
 *
 * This file does not touch `TeamDetail.tsx` — Phase 2 wires a genericized
 * component to this adapter's output. Every branch below mirrors real logic
 * currently inline in `TeamDetail.tsx` (cited by line where useful) rather
 * than inventing new behavior.
 *
 * `statGroups` is the one section this adapter intentionally upgrades
 * rather than just mirroring: per the project's locked decision (see
 * docs/sport-adapter-design.md §4b/§8 and the caller's brief), MLB's Team
 * Stats section moves from flat two-column numbers to NFL's grouped ranked
 * `StatRankRow` bars — `{ label, stats: OpposingStarterStat[] }[]` — using
 * the same `teamSeasonStatRows` helper NFL's own stat rows go through.
 */

import type { MlbTeamResearchPayload } from '@/lib/sports/mlb/teamResearch';
import type { TeamMetric, TeamStatcastSeason } from '@/lib/sports/mlb/statcastRollupShapes';
import { MLB_TEAM_SPEC } from './teamResearchSpec';
import { buildTeamResearch } from '@/lib/sports/shared/teamResearch';
import type { ResearchCard, ResearchSection } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamResearchData } from '@/lib/sports/shared/teamResearchShapes';
// ---------------------------------------------------------------------------
// Shared sub-shapes (would be hoisted to a sport-agnostic location once an
// NFL counterpart adapter exists — kept local to this file for Phase 1,
// same "additive, one new file" scope the caller specified).
// ---------------------------------------------------------------------------

/** Unifies MLB's `RecentGameResult` (win/runsFor/runsAgainst) with NFL's `RecentResult` (homeScore/awayScore) — see design doc §1b. */
export interface RecentResultRow {
  gameId: string;
  date: string;
  win: boolean | null;
  /** Soccer-only: a real draw, distinct from `win: null`'s existing "result not yet known" meaning — MLB/NFL never set this (no draws), so `win`'s two-state boolean semantics stay unchanged for them. */
  isDraw?: boolean;
  opponentAbbr: string;
  isHome: boolean;
  scoreFor: number;
  scoreAgainst: number;
}

// ---------------------------------------------------------------------------
// R7.1 — the team research page
// ---------------------------------------------------------------------------

/**
 * MLB's team page: the shared team research (`buildTeamResearch`) read through
 * MLB's spec, plus MLB's own section, "Contact & pitch quality", from the R5a
 * team Statcast rollup. Every other sport's adapter exports the same function
 * name from its own file.
 */
export function toTeamResearchData(input: { payload: MlbTeamResearchPayload; season: number | null; now?: Date }): TeamResearchData {
  const data = buildTeamResearch({
    payload: input.payload,
    spec: MLB_TEAM_SPEC,
    season: input.season,
    teamHref: (id) => `/mlb/team/${encodeURIComponent(id)}`,
    now: input.now,
  });
  return { ...data, sections: [...data.sections, mlbTeamStatcastSection(input.payload, data.scope.season)] };
}

type TeamMetricDef = [TeamMetric, string, 'higher' | 'lower', (v: number) => string];
const pct1 = (v: number) => `${v.toFixed(1)}%`;
const mph = (v: number) => `${v.toFixed(1)} mph`;

/** G2's rows (`team-sports.js`). `direction` is which way is good for that side. */
const LINEUP_METRICS: TeamMetricDef[] = [
  ['avgEV', 'Avg exit velocity', 'higher', mph],
  ['hardHit', 'Hard-hit % (95+ mph)', 'higher', pct1],
  ['sweetSpot', 'Sweet-spot % (8–32°)', 'higher', pct1],
  ['barrelish', 'EV 98+ at 26–30°', 'higher', pct1],
  ['hrPct', 'HR / PA', 'higher', pct1],
  ['kPct', 'K %', 'lower', pct1],
  ['bbPct', 'BB %', 'higher', pct1],
  ['whiff', 'Whiff % (per swing)', 'lower', pct1],
  ['chase', 'Chase % (outside zone)', 'lower', pct1],
];
const STAFF_METRICS: TeamMetricDef[] = [
  ['ffVelo', 'Four-seam velocity', 'higher', mph],
  ['kPct', 'K %', 'higher', pct1],
  ['bbPct', 'BB %', 'lower', pct1],
  ['whiff', 'Whiff %', 'higher', pct1],
  ['chase', 'Chase %', 'higher', pct1],
  ['hardHit', 'Hard-hit % allowed', 'lower', pct1],
  ['avgEV', 'Avg exit velocity allowed', 'lower', mph],
  ['hrPct', 'HR / PA allowed', 'lower', pct1],
];

function statcastCard(key: string, title: string, side: TeamStatcastSeason | null, defs: TeamMetricDef[], verb: string): ResearchCard {
  if (!side) return { kind: 'status', key, title, headline: 'No Statcast rollup for this season', reason: 'The team rollup holds no row for this side and season.' };
  return {
    kind: 'percentiles',
    key,
    title,
    scope: `${Math.round(side.metrics.pitches ?? 0).toLocaleString('en-US')} pitches ${verb} · rank of ${side.teams}`,
    rows: defs
      .map(([metric, label, direction, fmt]) => {
        const value = side.metrics[metric];
        const league = side.league[metric] ?? [];
        const best = side.percentiles[metric];
        if (value == null || best == null || league.length < 2) return null;
        const better = league.filter((v) => (direction === 'higher' ? v > value : v < value)).length;
        return {
          key: metric,
          label,
          valueText: fmt(value),
          // The rollup's percentile is best-first; `RankRow` wants a position along the values.
          percentile: direction === 'lower' ? 100 - best : best,
          direction,
          rank: { rank: better + 1, of: league.length },
          strip: { league, value },
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
  };
}

function mlbTeamStatcastSection(payload: MlbTeamResearchPayload, season: number): ResearchSection {
  const s = payload.statcast[String(season)];
  const base = { id: 'statcast', navLabel: 'Statcast', title: 'Contact & pitch quality', sub: `Statcast ${season}, regular season · pitch-weighted` };
  if (!s) {
    return { ...base, rows: [], state: { kind: 'empty', title: `No team Statcast rollup for ${season}`, reason: 'The corpus rollup holds seasons from 2025 on, rebuilt after each corpus refresh.' } };
  }
  const joined = s.bat ?? s.pit;
  return {
    ...base,
    note: joined
      ? `Every team's corpus pitches joined to a club through the game logs: ${joined.pitchesJoined.toLocaleString('en-US')} of ${joined.pitchesTotal.toLocaleString('en-US')} (${Math.round((100 * joined.pitchesJoined) / Math.max(1, joined.pitchesTotal))}%). True barrels need Statcast's barrel table, which is not held.`
      : undefined,
    rows: [[statcastCard('statcast-bat', 'Hitters', s.bat, LINEUP_METRICS, 'seen'), statcastCard('statcast-pit', 'Pitchers', s.pit, STAFF_METRICS, 'thrown')]],
    state: { kind: 'ready' },
  };
}
