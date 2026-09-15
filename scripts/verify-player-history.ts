/**
 * R6.1a verification — the player page's history against the G2 datasets.
 * Not a test: it needs the database and the league APIs.
 *   npx tsx scripts/verify-player-history.ts [slug ...]
 *
 * The G2 datasets (`docs/design/phase-g2/data/player-*.json`) were built on
 * 2026-09-14 from the same `player_game_history` rows. For every game G2 holds
 * this checks the reader returns the same event with the same stats and the
 * same opponent — those must match exactly.
 *
 * RESULTS ARE REFEREED BY THE LEAGUE, NOT BY G2. G2 joined results by team name
 * within a day, which takes the neighbouring game on a back-to-back or a series
 * (see `playerHistoryServer.ts`). So a result that differs from G2 is only
 * counted; MLB scores are checked against StatsAPI and NHL scores against
 * api-web's club schedules, and a disagreement there IS a failure. NBA, NFL,
 * CFB and soccer join on the exact ESPN event id. Runs one subject at a time.
 */
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split(/\r?\n/)) {
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const i = line.indexOf('=');
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const SUBJECTS: Record<string, [string, string]> = {
  'mlb-witt': ['mlb', '677951'],
  'mlb-skubal': ['mlb', '669373'],
  'mlb-judge': ['mlb', '592450'],
  'mlb-skenes': ['mlb', '694973'],
  'nfl-lamb': ['nfl', '4241389'],
  'nfl-prescott': ['nfl', '2577417'],
  'nfl-chase': ['nfl', '4362628'],
  'nfl-allen': ['nfl', '3918298'],
  'cfb-sayin': ['cfb', '5079712'],
  'cfb-manning': ['cfb', '4870906'],
  'nba-doncic': ['nba', '3945274'],
  'nba-jokic': ['nba', '3112335'],
  'nba-sga': ['nba', '4278073'],
  'nba-wembanyama': ['nba', '5104157'],
  'nhl-matthews': ['nhl', '8479318'],
  'nhl-hellebuyck': ['nhl', '8476945'],
  'nhl-mackinnon': ['nhl', '8477492'],
  'nhl-vasilevskiy': ['nhl', '8476883'],
  'soccer-haaland': ['soccer_epl', '253989'],
  'soccer-donnarumma': ['soccer_epl', '217092'],
  'soccer-cunha': ['soccer_epl', '259902'],
  'soccer-lammens': ['soccer_epl', '301425'],
  'tennis-zverev': ['tennis_atp', '2375'],
  'tennis-alcaraz': ['tennis_atp', '3782'],
};

interface G2Game {
  date: string;
  season: number;
  event: string;
  home: boolean;
  stats: Record<string, unknown>;
  result?: string;
  pf?: number;
  pa?: number;
  oppAbbr?: string | null;
}

async function main() {
  const { readPlayerHistory } = await import('../lib/sports/shared/playerHistoryServer');
  const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126 Safari/537.36' };
  const NHL_CLUB: Record<string, string> = { '8479318': 'TOR', '8476945': 'WPG', '8477492': 'COL', '8476883': 'TBL' };
  /** Official scores from the player's side, by event id. */
  async function official(sport: string, id: string, games: Array<{ eventId: string; teamId: string | null; season: number }>): Promise<Map<string, [number, number]> | null> {
    const out = new Map<string, [number, number]>();
    if (sport === 'mlb') {
      for (let i = 0; i < games.length; i += 60) {
        const batch = games.slice(i, i + 60);
        const j = (await (await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePks=${batch.map((g) => g.eventId).join(',')}`, { headers: UA })).json()) as any;
        for (const d of j.dates ?? []) for (const g of d.games ?? []) {
          const mine = batch.find((b) => b.eventId === String(g.gamePk));
          if (!mine || g.teams.home.score == null || g.status?.abstractGameState !== 'Final') continue;
          const home = String(g.teams.home.team.id) === mine.teamId;
          out.set(mine.eventId, home ? [g.teams.home.score, g.teams.away.score] : [g.teams.away.score, g.teams.home.score]);
        }
      }
      return out;
    }
    if (sport === 'nhl' && NHL_CLUB[id]) {
      for (const season of [...new Set(games.map((g) => g.season))]) {
        const j = (await (await fetch(`https://api-web.nhle.com/v1/club-schedule-season/${NHL_CLUB[id]}/${season}${season + 1}`, { headers: UA })).json()) as any;
        for (const g of j.games ?? []) {
          const mine = games.find((b) => b.eventId === String(g.id));
          if (!mine || g.homeTeam?.score == null) continue;
          const home = String(g.homeTeam.id) === mine.teamId;
          out.set(mine.eventId, home ? [g.homeTeam.score, g.awayTeam.score] : [g.awayTeam.score, g.homeTeam.score]);
        }
      }
      return out;
    }
    return null;
  }
  const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SUBJECTS);
  let failures = 0;
  for (const slug of wanted) {
    const [sport, id] = SUBJECTS[slug];
    const g2 = JSON.parse(fs.readFileSync(path.join('docs/design/phase-g2/data', `player-${slug}.json`), 'utf8')) as { games: G2Game[]; builtAt: string };
    const t0 = Date.now();
    const h = await readPlayerHistory(sport as never, id);
    const ms = Date.now() - t0;
    const ours = new Map(h.games.map((g) => [g.eventId, g]));
    let missing = 0;
    let statDiff = 0;
    let g2ScoreDiff = 0;
    let oppDiff = 0;
    const examples: string[] = [];
    for (const g of g2.games) {
      const o = ours.get(String(g.event));
      if (!o) {
        missing++;
        if (examples.length < 3) examples.push(`missing ${g.event} ${g.date}`);
        continue;
      }
      const keys = new Set([...Object.keys(g.stats), ...Object.keys(o.stats)]);
      if ([...keys].some((k) => Number(g.stats[k] ?? NaN) !== Number(o.stats[k] ?? NaN) && !(g.stats[k] == null && o.stats[k] == null))) {
        statDiff++;
        if (examples.length < 3) examples.push(`stats ${g.event}`);
      }
      if (g.pf != null && o.teamScore != null && (g.pf !== o.teamScore || g.pa !== o.opponentScore)) g2ScoreDiff++;
      if (g.oppAbbr && o.opponent.abbr && g.oppAbbr !== o.opponent.abbr) {
        oppDiff++;
        if (examples.length < 3) examples.push(`opp ${g.event} g2=${g.oppAbbr} ours=${o.opponent.abbr}`);
      }
    }
    const ref = await official(sport, id, h.games);
    let refAgree = 0;
    let refWrong = 0;
    if (ref) {
      for (const o of h.games) {
        const truth = ref.get(o.eventId);
        if (!truth || o.teamScore == null) continue;
        if (truth[0] === o.teamScore && truth[1] === o.opponentScore) refAgree++;
        else {
          refWrong++;
          if (examples.length < 3) examples.push(`league ${o.eventId} ${o.date} ours=${o.teamScore}-${o.opponentScore} league=${truth.join('-')}`);
        }
      }
    }
    const newer = h.games.filter((g) => g.date > g2.games[g2.games.length - 1]?.date).length;
    const noResult = h.games.filter((g) => !g.result).length;
    const noOppName = h.games.filter((g) => !g.opponent.abbr && !g.opponent.name).length;
    const bad = missing + statDiff + oppDiff + refWrong;
    failures += bad;
    console.log(
      `${slug.padEnd(18)} ours ${String(h.games.length).padStart(3)} g2 ${String(g2.games.length).padStart(3)} newer ${newer} | missing ${missing} stats ${statDiff} opp ${oppDiff} | league ${ref ? `${refAgree} agree ${refWrong} wrong` : 'exact ref'} | differs from G2 ${g2ScoreDiff} | unjoined ${noResult} no-opp-name ${noOppName} | ${ms} ms asOf ${h.asOf?.slice(0, 16)}${examples.length ? ` | ${examples.join('; ')}` : ''}`,
    );
  }
  console.log(failures === 0 ? 'OK: every G2 game present with identical stats and opponent; every refereed score agrees with the league' : `${failures} failures`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
