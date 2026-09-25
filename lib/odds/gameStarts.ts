/**
 * Upcoming game starts by game id, per sport (odds build P12: "the next game"
 * for a tracked line). The app's odds tables carry no start time, so this reads
 * the schedules the app already reads elsewhere — StatsAPI for MLB, the NHL
 * API, ESPN's scoreboard for the rest — and keeps the public result for 10
 * minutes in-process. It is schedule data, not a user's; the per-user alerts
 * that use it are never cached. A sport with no schedule reader returns an
 * empty map, and its tracked lines get no alerts (no guessed game).
 */
import { easternDate, getScheduleRange, shiftDate } from '@/lib/sports/mlb/statsapi';
import { fetchWeekSchedule } from '@/lib/sports/nhl/nhle';
import { fetchScoreboard } from '@/lib/sports/multiSport/teamSportEspn';

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; starts: Map<string, string> }>();

const ESPN: Record<string, [string, string][]> = {
  nfl: [['football', 'nfl']],
  cfb: [['football', 'college-football']],
  nba: [['basketball', 'nba']],
  soccer: [['soccer', 'eng.1'], ['soccer', 'usa.1']],
};

async function read(sport: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (sport === 'mlb') {
    const today = easternDate();
    for (const g of await getScheduleRange(today, shiftDate(today, 3))) out.set(String(g.gamePk), g.gameDate);
  } else if (sport === 'nhl') {
    for (const g of await fetchWeekSchedule()) out.set(g.gameId, g.date);
  } else if (ESPN[sport]) {
    for (const [s, l] of ESPN[sport]) {
      for (const g of await fetchScoreboard(s, l, 8)) if (!g.status?.completed) out.set(g.gameId, g.date);
    }
  }
  return out;
}

export async function upcomingStarts(sport: string): Promise<Map<string, string>> {
  const key = sport.startsWith('soccer') ? 'soccer' : sport;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.starts;
  const starts = await read(key);
  cache.set(key, { at: Date.now(), starts });
  return starts;
}
