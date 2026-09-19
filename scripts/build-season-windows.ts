/**
 * R12a — writes `lib/history/seasonWindows.ts`: each league-season's regular
 * season and postseason dates, and for MLB and the NHL each team's own opening
 * day, so deep history can drop preseason games and mark playoffs without a
 * request-time call.
 *
 * WHY A GENERATED FILE. `game_result` has no game-type column, and measured
 * (R12a Step 0) MLB 2025 holds 67 spring-training games from `espn_core`, and
 * NBA 2024-26 carries preseason games. The windows of a finished season never
 * change, so they are fetched once and checked in. Re-run each new season:
 *   npx tsx scripts/build-season-windows.ts
 *
 * WHY PER-TEAM OPENERS. MLB and the NHL open abroad days before everyone else
 * (MLB 2014/2019/2024/2025, NHL 2007-11/2022/2024). The league window then
 * starts on the opener, and every other team's preseason games after it sit
 * inside the window — measured: Winnipeg and Utah each showed 83 games for
 * 2024-25 from one Oct 5 preseason game. A game is regular season only once
 * BOTH teams have played their first regular-season game.
 *
 * SOURCES. MLB from StatsAPI (its own season dates; ESPN's 2025 regular season
 * starts 03-26, after the Tokyo Series). NHL openers from the NHL stats API's
 * season game list (one call a season). Windows otherwise from ESPN's core API
 * `seasons/{y}/types` (2 regular, 3 post). Soccer has no preseason or
 * postseason in `game_result` and is not listed.
 */
import fs from 'node:fs';
import path from 'node:path';

interface Window { regularStart: string; regularEnd: string; postEnd: string | null; teamStart?: Record<string, string> }

/** Our season label -> ESPN's season param. NBA labels by end year like ESPN; NHL by start year, one behind ESPN. */
const ESPN: Record<string, { path: string; first: number; last: number; param: (label: number) => number }> = {
  nba: { path: 'basketball/leagues/nba', first: 2008, last: 2026, param: (s) => s },
  nhl: { path: 'hockey/leagues/nhl', first: 2007, last: 2025, param: (s) => s + 1 },
  nfl: { path: 'football/leagues/nfl', first: 1999, last: 2026, param: (s) => s },
  cfb: { path: 'football/leagues/college-football', first: 2013, last: 2026, param: (s) => s },
};

/** NHL stats ids -> the app's franchise ids (`lib/history/deepHistory.ts` LINEAGE): Thrashers 11 -> Jets 52, Utah 59 -> 68. */
const NHL_LINEAGE: Record<string, string> = { '11': '52', '59': '68' };

/** ESPN windows run midnight-Pacific to midnight-Pacific in UTC: the start's date is the day; the end's day is 12h earlier. */
const startDay = (iso: string) => iso.slice(0, 10);
const endDay = (iso: string) => new Date(Date.parse(iso) - 12 * 3600_000).toISOString().slice(0, 10);

function firstDates(games: Array<{ date: string; home: string; away: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of games) for (const t of [g.home, g.away]) if (!out[t] || g.date < out[t]) out[t] = g.date;
  return out;
}

async function json(url: string): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (res.status === 404) return null;
      if (res.ok) return (await res.json()) as Record<string, unknown>;
    } catch {
      // retried
    }
  }
  throw new Error(`no answer from ${url}`);
}

async function mlbOpeners(season: number): Promise<Record<string, string>> {
  const sched = await json(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=${season}&gameType=R`);
  const dates = (sched?.dates ?? []) as Array<{ games: Array<{ officialDate: string; teams: { home: { team: { id: number } }; away: { team: { id: number } } } }> }>;
  return firstDates(dates.flatMap((d) => d.games.map((g) => ({ date: g.officialDate, home: String(g.teams.home.team.id), away: String(g.teams.away.team.id) }))));
}

async function nhlOpeners(label: number): Promise<Record<string, string>> {
  const j = await json(`https://api.nhle.com/stats/rest/en/game?cayenneExp=season=${label}${label + 1}%20and%20gameType=2`);
  const games = ((j?.data ?? []) as Array<{ gameDate: string; homeTeamId: number; visitingTeamId: number }>).map((g) => ({
    date: g.gameDate,
    home: NHL_LINEAGE[String(g.homeTeamId)] ?? String(g.homeTeamId),
    away: NHL_LINEAGE[String(g.visitingTeamId)] ?? String(g.visitingTeamId),
  }));
  return firstDates(games);
}

function render(w: Window): string {
  const team = w.teamStart ? `, teamStart: { ${Object.entries(w.teamStart).sort(([a], [b]) => Number(a) - Number(b)).map(([t, d]) => `'${t}': '${d}'`).join(', ')} }` : '';
  return `{ regularStart: '${w.regularStart}', regularEnd: '${w.regularEnd}', postEnd: ${w.postEnd ? `'${w.postEnd}'` : 'null'}${team} }`;
}

async function main() {
  const out: Record<string, Record<number, Window>> = {};
  for (let season = 2010; season <= 2026; season++) {
    const j = await json(`https://statsapi.mlb.com/api/v1/seasons/${season}?sportId=1`);
    const s = (j?.seasons as Array<Record<string, string>> | undefined)?.[0];
    if (!s?.regularSeasonStartDate) continue;
    (out.mlb ??= {})[season] = { regularStart: s.regularSeasonStartDate, regularEnd: s.regularSeasonEndDate, postEnd: s.postSeasonEndDate ?? null, teamStart: await mlbOpeners(season) };
  }
  for (const [sport, def] of Object.entries(ESPN)) {
    for (let label = def.first; label <= def.last; label++) {
      const base = `https://sports.core.api.espn.com/v2/sports/${def.path}/seasons/${def.param(label)}/types`;
      const reg = await json(`${base}/2`);
      if (!reg?.startDate) continue;
      const post = await json(`${base}/3`);
      const teamStart = sport === 'nhl' ? await nhlOpeners(label) : undefined;
      (out[sport] ??= {})[label] = {
        regularStart: startDay(String(reg.startDate)),
        regularEnd: endDay(String(reg.endDate)),
        postEnd: post?.endDate ? endDay(String(post.endDate)) : null,
        ...(teamStart && Object.keys(teamStart).length ? { teamStart } : {}),
      };
    }
  }
  const body = Object.entries(out)
    .map(([sport, seasons]) => `  ${sport}: {\n${Object.entries(seasons).map(([y, w]) => `    ${y}: ${render(w)},`).join('\n')}\n  },`)
    .join('\n');
  const file = `/**
 * GENERATED by \`scripts/build-season-windows.ts\` — do not edit by hand; re-run it
 * each new season. Each league-season's regular-season and postseason dates
 * (local calendar days, inclusive), keyed by this app's season label
 * (\`lib/sports/shared/season.ts\`), and for MLB and the NHL each team's first
 * regular-season game. Used by \`lib/history/deepHistory.ts\` to drop preseason
 * and mark playoffs.
 */

export interface SeasonWindow {
  regularStart: string;
  regularEnd: string;
  /** null when the league lists no postseason for that year. */
  postEnd: string | null;
  /** MLB and NHL: each team's first regular-season game, by the app's team id. */
  teamStart?: Record<string, string>;
}

export const SEASON_WINDOWS: Record<string, Record<number, SeasonWindow>> = {
${body}
};
`;
  fs.writeFileSync(path.join(process.cwd(), 'lib/history/seasonWindows.ts'), file);
  console.log(Object.entries(out).map(([s, v]) => `${s}: ${Object.keys(v).length} seasons, ${Object.values(v).filter((w) => w.teamStart).length} with openers`).join(', '));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
