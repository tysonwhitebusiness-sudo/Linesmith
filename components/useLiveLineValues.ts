'use client';

import { useEffect, useState } from 'react';

/**
 * Live current-value lookup for the tracked-line card — given a sport, that
 * sport's own live-game id (from `PlayerDetailData.liveLineTracker.gameId`,
 * the same id Part 1's hero-card Live tab already polls), and the subject's
 * name, returns `{ [statKey]: number | null }` for whichever tracked stat
 * keys are requested. Reuses Part 1's own `/api/{sport}/game/[id]/live`
 * routes directly rather than building a second live-data pipeline — this
 * hook's only job is extracting one player's row out of that response.
 *
 * MLB is the one exception: it already has its own subjectId-keyed live
 * value lookup (`liveMarketValues()`, exposed via `/api/mlb/game/[id]/live
 * ?subjectId=`), so this defers to that instead of name-matching. Every
 * other sport's live routes only carry player names (no canonical id this
 * app can key against yet), so those are matched by display name — the
 * same imperfect-but-workable approach already used elsewhere in this
 * codebase for name-based subject matching.
 */
export function useLiveLineValues(
  sport: string,
  gameId: string | null,
  subjectId: string,
  subjectName: string | undefined,
  statKeys: string[],
  enabled: boolean,
  league?: string,
): { values: Record<string, number | null>; loading: boolean } {
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(false);
  const keysSignature = statKeys.join(',');

  useEffect(() => {
    if (!enabled || !gameId || !subjectName || statKeys.length === 0) {
      setValues({});
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const nameLower = subjectName.toLowerCase();

    const load = async () => {
      setLoading(true);
      try {
        if (sport === 'mlb') {
          const res = await fetch(`/api/mlb/game/${gameId}/live?subjectId=${encodeURIComponent(subjectId)}`, { cache: 'no-store', signal: controller.signal });
          if (!res.ok) return;
          const json = (await res.json()) as { liveValues?: Record<string, number> };
          if (cancelled) return;
          const out: Record<string, number | null> = {};
          for (const k of statKeys) out[k] = json.liveValues?.[k] ?? null;
          setValues(out);
          return;
        }

        if (sport === 'nhl') {
          const res = await fetch(`/api/nhl/game/${gameId}/live`, { cache: 'no-store', signal: controller.signal });
          if (!res.ok) return;
          const json = (await res.json()) as {
            skatersByTeam?: Record<string, Array<{ name: string; goals: number; assists: number; points: number; shots: number; hits: number; blockedShots: number }>>;
          };
          if (cancelled) return;
          const all = Object.values(json.skatersByTeam ?? {}).flat();
          const row = all.find((p) => p.name.toLowerCase() === nameLower);
          const MAP: Record<string, number | undefined> = row
            ? { goals: row.goals, assists: row.assists, points: row.points, shots_on_goal: row.shots, hits: row.hits, blocked_shots: row.blockedShots }
            : {};
          const out: Record<string, number | null> = {};
          for (const k of statKeys) out[k] = MAP[k] ?? null;
          setValues(out);
          return;
        }

        if (sport === 'nba') {
          const res = await fetch(`/api/nba/game/${gameId}/live`, { cache: 'no-store', signal: controller.signal });
          if (!res.ok) return;
          const json = (await res.json()) as {
            boxByTeam?: Record<string, Array<{ name: string; pts: number; reb: number; ast: number; stl: number; blk: number; to: number }>>;
          };
          if (cancelled) return;
          const all = Object.values(json.boxByTeam ?? {}).flat();
          const row = all.find((p) => p.name.toLowerCase() === nameLower);
          const MAP: Record<string, number | undefined> = row
            ? { points: row.pts, rebounds: row.reb, assists: row.ast, steals: row.stl, blocks: row.blk, turnovers: row.to }
            : {};
          const out: Record<string, number | null> = {};
          for (const k of statKeys) out[k] = MAP[k] ?? null;
          setValues(out);
          return;
        }

        if (sport === 'nfl' || sport === 'cfb') {
          const res = await fetch(`/api/${sport}/game/${gameId}/live`, { cache: 'no-store', signal: controller.signal });
          if (!res.ok) return;
          const json = (await res.json()) as {
            playersByTeam?: Record<
              string,
              Array<{ name: string; passingYards: number | null; passingTds: number | null; rushingYards: number | null; rushingTds: number | null; receivingYards: number | null; receivingTds: number | null; receptions: number | null }>
            >;
          };
          if (cancelled) return;
          const all = Object.values(json.playersByTeam ?? {}).flat();
          const row = all.find((p) => p.name.toLowerCase() === nameLower);
          const MAP: Record<string, number | null | undefined> = row
            ? {
                passing_yards: row.passingYards,
                passing_tds: row.passingTds,
                rushing_yards: row.rushingYards,
                rushing_tds: row.rushingTds,
                receiving_yards: row.receivingYards,
                receiving_tds: row.receivingTds,
                receptions: row.receptions,
              }
            : {};
          const out: Record<string, number | null> = {};
          for (const k of statKeys) out[k] = MAP[k] ?? null;
          setValues(out);
          return;
        }
        void league;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const interval = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport, gameId, subjectId, subjectName, keysSignature, enabled, league]);

  return { values, loading };
}
