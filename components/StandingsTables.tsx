'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { TeamStandingRow } from './useAllTeams';
import { TeamLogo } from './SubjectAvatar';

/** Divisions read East → Central → West, the order every scoreboard uses — not whatever order the API happens to list them in. */
const DIVISION_ORDER = ['East', 'Central', 'West'];

function winPct(wins: number, losses: number): string {
  const total = wins + losses;
  if (total === 0) return '.000';
  return (wins / total).toFixed(3).replace(/^0/, '');
}

function groupTeams(teams: TeamStandingRow[]): Map<string, Map<string, TeamStandingRow[]>> {
  const byLeague = new Map<string, Map<string, TeamStandingRow[]>>();
  for (const t of teams ?? []) {
    const league = t.leagueName || 'Other';
    const division = t.divisionShortName || t.divisionName || 'Other';
    if (!byLeague.has(league)) byLeague.set(league, new Map());
    const byDivision = byLeague.get(league)!;
    if (!byDivision.has(division)) byDivision.set(division, []);
    byDivision.get(division)!.push(t);
  }
  for (const byDivision of byLeague.values()) {
    for (const list of byDivision.values()) {
      list.sort((a, b) => Number(a.divisionRank || 99) - Number(b.divisionRank || 99));
    }
  }
  return byLeague;
}

function sortedDivisionNames(byDivision: Map<string, TeamStandingRow[]>): string[] {
  return [...byDivision.keys()].sort((a, b) => {
    const ai = DIVISION_ORDER.findIndex((d) => a.includes(d));
    const bi = DIVISION_ORDER.findIndex((d) => b.includes(d));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

/**
 * AL/NL standings, grouped by division. Shared between the Teams index page
 * (where it's the whole point of the page) and the bottom of every team's
 * own detail page (where it's context — "how does this team's division
 * look" without a separate trip to /mlb/teams).
 */
export function StandingsTables({
  teams,
  loading,
  highlightTeamId,
  teamHref,
}: {
  teams: TeamStandingRow[];
  loading?: boolean;
  /** The team whose row gets a highlight — set on the team detail page, omitted on the plain index. */
  highlightTeamId?: number;
  /**
   * Builds each row's link. Was hardcoded to `/mlb/team/${teamId}` before —
   * a real bug for every non-MLB caller (NFL, soccer), since this component
   * is shared across every sport's `TeamDetail.tsx`. Defaults to the old
   * MLB behavior so no existing call site needs to change.
   */
  teamHref?: (teamId: number) => string;
}) {
  const hrefFor = teamHref ?? ((teamId: number) => `/mlb/team/${teamId}`);
  const grouped = useMemo(() => groupTeams(teams), [teams]);
  const leagueNames = useMemo(
    () => [...grouped.keys()].sort((a, b) => (a.includes('American') ? -1 : b.includes('American') ? 1 : 0)),
    [grouped],
  );

  if (loading && teams.length === 0) {
    return (
      <div className="lb-card p-4">
        <div className="h-32 animate-pulse rounded-lg bg-line/30" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {leagueNames.map((league) => {
        const byDivision = grouped.get(league)!;
        return (
          <section key={league} className="space-y-3">
            <h2 className="text-sm font-semibold text-ink-muted">{league}</h2>
            {/* DIVISIONS SIT TWO-UP, not stacked.
                A division table is five short rows of six narrow columns. On a
                team page's main column that is roughly 860px wide, each one was
                a full-width card mostly made of empty space, and six of them
                ran the page on for six screens -- the design board draws ONE
                standings card, not six stacked ones.
                Collapses to a single column below `sm`, where 860px is not
                available and two tables side by side would each be unreadable. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {sortedDivisionNames(byDivision).map((division) => {
              const rows = byDivision.get(division)!;
              // A points-based table (soccer) if every row in this group
              // actually carries `points` — mixed groups shouldn't happen
              // in practice (one group is always one sport/league), but
              // "every row" rather than "some row" avoids a table with a
              // ragged, half-populated Pts column if it ever does.
              const isPointsTable = rows.length > 0 && rows.every((t) => t.points !== undefined);
              return (
                <div key={division} className="lb-card overflow-hidden">
                  <div className="border-b border-line bg-ink/[0.02] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    {division}
                  </div>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wide text-ink-faint">
                        <th className="py-1.5 pl-3">Team</th>
                        <th className="py-1.5 text-right">W</th>
                        {isPointsTable ? <th className="py-1.5 text-right">D</th> : null}
                        <th className="py-1.5 text-right">L</th>
                        {isPointsTable ? (
                          <>
                            <th className="py-1.5 text-right">GD</th>
                            <th className="py-1.5 pr-3 text-right">Pts</th>
                          </>
                        ) : (
                          <>
                            <th className="py-1.5 text-right">PCT</th>
                            <th className="py-1.5 text-right">GB</th>
                            <th className="py-1.5 pr-3 text-right">L10</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <tr
                          key={t.teamId}
                          className={`border-t border-line/60 transition-colors hover:bg-ink/[0.03] ${
                            t.teamId === highlightTeamId ? 'bg-accent-soft/50' : ''
                          }`}
                        >
                          <td className="py-1.5 pl-3">
                            <Link href={hrefFor(t.teamId)} className="flex items-center gap-2">
                              <TeamLogo logoUrl={t.logoUrl} abbreviation={t.abbreviation} size={20} />
                              <span className={`font-medium ${t.teamId === highlightTeamId ? 'text-masters' : ''}`}>{t.name}</span>
                            </Link>
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{t.wins}</td>
                          {isPointsTable ? <td className="py-1.5 text-right tabular-nums">{t.draws ?? 0}</td> : null}
                          <td className="py-1.5 text-right tabular-nums">{t.losses}</td>
                          {isPointsTable ? (
                            <>
                              <td className="py-1.5 text-right tabular-nums text-ink-faint">
                                {(t.goalDifferential ?? 0) > 0 ? `+${t.goalDifferential}` : t.goalDifferential ?? 0}
                              </td>
                              <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">{t.points}</td>
                            </>
                          ) : (
                            <>
                              <td className="py-1.5 text-right tabular-nums">{winPct(t.wins, t.losses)}</td>
                              <td className="py-1.5 text-right tabular-nums text-ink-faint">{t.gamesBack}</td>
                              <td className="py-1.5 pr-3 text-right tabular-nums text-ink-faint">
                                {t.lastTen ? `${t.lastTen.wins}-${t.lastTen.losses}` : '—'}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default StandingsTables;
