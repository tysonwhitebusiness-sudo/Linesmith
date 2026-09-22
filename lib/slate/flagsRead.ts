/**
 * The research flags' one read (F0). Server side only — `/api/slate/flags` is
 * its only caller, and the shapes it returns live in `flags.ts`, which the
 * browser imports.
 *
 * PYTHON WRITES, TYPESCRIPT RENDERS: this selects `kind = 'spotlight'` rows
 * from `slate_rankings` and attaches the shared registry's words. It computes
 * nothing and it never writes.
 */

import { pgAll } from '../db/pgClient';
import { LEADER_ID, SPOTLIGHT_RANKINGS } from './specials';
import type { ResearchFlag } from './flags';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function readFlags(scope: string, date: string): Promise<ResearchFlag[]> {
  const rows = await pgAll<Record<string, unknown>>(
    `SELECT ranking_id, subject_id, subject_name, rank, score, team, team_id, opponent, opponent_id,
            game_id, factors, frozen_at
     FROM slate_rankings
     WHERE sport = ? AND slate_date = ?::date AND kind = 'spotlight' AND subject_id <> '${LEADER_ID}'
     ORDER BY ranking_id, rank`,
    [scope, date],
  );

  // "3rd" needs an "of", and the pool is whatever the job ranked today.
  const total = new Map<string, number>();
  for (const r of rows) total.set(String(r.ranking_id), (total.get(String(r.ranking_id)) ?? 0) + 1);

  const out: ResearchFlag[] = [];
  for (const r of rows) {
    const rankingId = String(r.ranking_id);
    const def = SPOTLIGHT_RANKINGS[rankingId];
    // A ranking this app has no words for is not drawn — the same rule the
    // Specials keep: an unlabelled factor is an assertion without a source.
    if (!def) continue;
    const raw = (r.factors ?? {}) as Record<string, unknown>;
    const percentiles = (raw.percentiles ?? {}) as Record<string, number>;
    const subjectId = String(r.subject_id);
    const gameId = r.game_id == null ? null : String(r.game_id);
    out.push({
      rankingId,
      title: def.title,
      promo: def.promo,
      rank: Number(r.rank),
      of: total.get(rankingId) ?? 0,
      subjectId,
      subjectName: String(r.subject_name ?? subjectId),
      subjectKind: gameId != null && gameId === subjectId ? 'game' : 'player',
      team: r.team == null ? null : String(r.team),
      teamId: r.team_id == null ? null : String(r.team_id),
      opponent: r.opponent == null ? null : String(r.opponent),
      opponentId: r.opponent_id == null ? null : String(r.opponent_id),
      gameId,
      read: typeof raw._read === 'string' ? raw._read : null,
      factors: def.factors.map((f) => ({ ...f, value: num(raw[f.key]), percentile: num(percentiles[f.key]) })),
      score: Number(r.score),
      frozen: r.frozen_at != null,
    });
  }
  return out;
}
