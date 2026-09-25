import { NextResponse } from 'next/server';
import { listTrackedLines } from '@/lib/db/client';
import { pgAll } from '@/lib/db/pgClient';
import { readPlayerOdds } from '@/lib/db/oddsRead';
import { trackedLineAlerts, type TrackedAlert } from '@/lib/odds/alerts';
import { upcomingStarts } from '@/lib/odds/gameStarts';
import { userSportsbook } from '@/lib/odds/props/config';
import { candidateDimensionToMarketKey, normalizeBookmaker } from '@/lib/odds/props/entityResolution';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/tracked-lines/alerts — the signed-in reader's alerts on their
 * tracked lines (odds build P12 §1): a line moved, a better price than their
 * book, their book pulled the line, steam.
 *
 * Session-scoped and a DIRECT read, deliberately outside both caching patterns
 * (CLAUDE.md "API route caching": a per-user, request-scoped read, like
 * `/api/tracked-lines` itself). It writes nothing. The schedule it needs for
 * "the next game" is public and cached 10 minutes in `lib/odds/gameStarts.ts`.
 */
async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const tracked = await listTrackedLines(undefined, user.id);
    const raw = userSportsbook();
    const userBook = raw ? normalizeBookmaker(raw) ?? raw.toLowerCase() : null;
    const now = Date.now();
    const alerts: TrackedAlert[] = [];
    const odds = new Map<string, Awaited<ReturnType<typeof readPlayerOdds>>>();
    for (const t of tracked) {
      const marketKey = candidateDimensionToMarketKey(t.statKey);
      if (!marketKey) continue;
      // The next game: the player's priced games that have not started, earliest first.
      const games = await pgAll<{ game_id: string }>(
        `SELECT DISTINCT game_id FROM prop_odds WHERE subject_id = ? AND market_key = ?`, [t.subjectId, marketKey]);
      const starts = await upcomingStarts(t.sport).catch(() => new Map<string, string>());
      const next = games.map(g => ({ id: g.game_id, start: starts.get(g.game_id) }))
        .filter((g): g is { id: string; start: string } => !!g.start && Date.parse(g.start) > now)
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0];
      if (!next) continue;
      const k = `${t.sport}|${next.id}|${t.subjectId}`;
      if (!odds.has(k)) odds.set(k, await readPlayerOdds(t.sport, next.id, t.subjectId));
      const market = odds.get(k)!.markets.find(m => m.key === marketKey) ?? null;
      alerts.push(...trackedLineAlerts(
        { id: t.id, subjectName: t.subjectName, statLabel: t.statLabel, side: t.side, line: t.line, createdAt: new Date(t.createdAt).toISOString() },
        market, userBook));
    }
    alerts.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return NextResponse.json({ asOf: new Date(now).toISOString(), userBook, alerts });
  } catch (e) {
    console.error('[tracked-lines/alerts]', e);
    return NextResponse.json({ error: 'Alerts read failed' }, { status: 500 });
  }
}
