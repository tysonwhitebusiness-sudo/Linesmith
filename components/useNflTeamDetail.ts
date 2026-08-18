'use client';

import { useEffect, useState } from 'react';
import type { PickCandidate } from '@/lib/core/types';
import type { PlayerSeasonStats } from '@/lib/sports/nfl/nflverse';
import type { TeamGrades } from '@/lib/sports/nfl/nflTeamGrades';

/**
 * NFL's team-detail fetch — extracted out of the old `NflTeamDetail.tsx` so
 * the shared `TeamDetail.tsx` (and its `lib/sports/nfl/adapters/teamDetailAdapter.ts`)
 * can consume the same `/api/nfl/team/[teamId]` response without owning the
 * fetch/loading/error plumbing themselves. MLB's team page instead composes
 * several existing hooks (`useTeamRoster`/`useTeamForm`/`useTeamStatcast`) —
 * NFL's real data model is one bespoke endpoint instead, so this hook is the
 * NFL-side equivalent, not a forced match to MLB's shape.
 */

export interface NflTeamStatLine {
  key: string;
  label: string;
  value: number;
  rank: number;
  decimals: number;
  group?: string;
}

export interface NflTeamRosterPlayer {
  subjectId: string;
  fullName: string;
  position: string | null;
  headshotUrl: string | null;
  seasonStats: PlayerSeasonStats | null;
  positionRank: number | null;
  positionPoolSize: number | null;
  sideOfBallRank: number | null;
  sideOfBallPoolSize: number | null;
}

export interface NflTeamRecentResult {
  gameId: string;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface NflTeamDetailApiResponse {
  team: { teamId: string; abbreviation: string; displayName: string; logoUrl: string | null; wins: number; losses: number; divisionRank?: string | null };
  roster: NflTeamRosterPlayer[];
  recentResults: NflTeamRecentResult[];
  teamStats: NflTeamStatLine[];
  nextGame: { gameId: string; gameday: string; homeTeam: string; awayTeam: string } | null;
  opponentAbbr: string | null;
  opponentDefenseAllowed: NflTeamStatLine[];
  grades: TeamGrades | null;
  opponentGrades: TeamGrades | null;
  candidates: { moneyline: PickCandidate | null; total: PickCandidate | null; teamTotal: PickCandidate | null };
}

export interface NflTeamDetailState {
  data: NflTeamDetailApiResponse | null;
  loading: boolean;
  error: string | null;
}

export function useNflTeamDetail(teamId: number | undefined): NflTeamDetailState {
  const [data, setData] = useState<NflTeamDetailApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (teamId == null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/nfl/team/${teamId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setError(json.detail ?? json.error);
        else setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  return { data, loading, error };
}
