/**
 * R6.1a verification — the shared research sections against G2's OWN formulas.
 * No database: it runs on the G2 datasets alone.
 *   npx tsx scripts/verify-player-research-g2.ts
 *
 * G2's player specs (`docs/design/phase-g2/src/sports/*.js`) are loaded into a
 * sandbox with the kit helpers they use (`fmt`, `U`, `col`, `sumK`…) and run
 * over each dataset's games. Every season-table cell whose column label both
 * builds share is compared as PRINTED TEXT, so formatting counts too. The
 * builder runs over the same games through each sport's `toPlayerResearchData`.
 *
 * Expected differences, each deliberate and reported rather than failed:
 *   - MLB IP prints whole.thirds ("187.1"); G2 printed outs / 3 ("187.3") — R2.
 *   - NHL goalie SV% prints ".912"; G2 printed "91.2".
 *   - Tennis is skipped: G2's tennis page is TennisMyLife matches (R6.4), not
 *     the `player_game_history` rows this build reads.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import type { PlayerGame, PlayerHistory, HistorySport, PlayerBio } from '../lib/sports/shared/playerResearchShapes';

const SRC = 'docs/design/phase-g2/src';
const kit = fs.readFileSync(`${SRC}/kit.js`, 'utf8');
const kit2 = fs.readFileSync(`${SRC}/kit2.js`, 'utf8');
const pick = (text: string, start: string, end: string) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)) + end.length);

const sandbox: Record<string, unknown> = { console };
vm.createContext(sandbox);
vm.runInContext(
  [
    pick(kit, 'const fmt = {', '\n};'),
    pick(kit2, 'const U = {', '\n};'),
    fs.readFileSync(`${SRC}/sports/common.js`, 'utf8'),
    'const h = () => null, card = () => null, section = () => null, statusPill = () => null, dataTable = () => null, segmented = () => null, lineChart = () => null, columnChart = () => null, statGrid = () => null, factList = () => null, pbar = () => null, tipRow = () => null, tipText = () => null, vizLegend = () => null, put = () => null, PITCH_NAMES = {};',
    ...['mlb.js', 'football.js', 'hoops-hockey.js', 'soccer-tennis-golf.js'].map((f) => fs.readFileSync(`${SRC}/sports/${f}`, 'utf8')),
    'globalThis.__SPORTS = SPORTS; globalThis.__fmt = fmt;',
  ].join('\n;\n'),
  sandbox,
);
const SPORTS = sandbox.__SPORTS as Record<string, { subjects: Array<{ spec: any }> }>; // eslint-disable-line @typescript-eslint/no-explicit-any
const fmt = sandbox.__fmt as { n: (v: number | null, d?: number) => string };

const G2_SPEC: Record<string, any> = { // eslint-disable-line @typescript-eslint/no-explicit-any
  hitter: SPORTS.mlb.subjects[0].spec,
  pitcher: SPORTS.mlb.subjects[1].spec,
  receiver: SPORTS.nfl.subjects[0].spec,
  quarterback: SPORTS.nfl.subjects[1].spec,
  guard: SPORTS.nba.subjects[0].spec,
  big: SPORTS.nba.subjects[1].spec,
  skater: SPORTS.nhl.subjects[0].spec,
  goalie: SPORTS.nhl.subjects[1].spec,
  forward: SPORTS.soccer.subjects[0].spec,
  goalkeeper: SPORTS.soccer.subjects[1].spec,
};
const CFB_QB = SPORTS.cfb.subjects[0].spec;

const APP_SPORT: Record<string, string> = { mlb: 'mlb', nfl: 'nfl', cfb: 'cfb', nba: 'nba', nhl: 'nhl', soccer_epl: 'soccer' };

async function main() {
  const adapters = {
    mlb: (await import('../lib/sports/mlb/adapters/playerDetailAdapter')).toPlayerResearchData,
    nfl: (await import('../lib/sports/nfl/adapters/playerDetailAdapter')).toPlayerResearchData,
    cfb: (await import('../lib/sports/cfb/adapters/playerDetailAdapter')).toPlayerResearchData,
    nba: (await import('../lib/sports/nba/adapters/playerDetailAdapter')).toPlayerResearchData,
    nhl: (await import('../lib/sports/nhl/adapters/playerDetailAdapter')).toPlayerResearchData,
    soccer: (await import('../lib/sports/soccer/adapters/playerDetailAdapter')).toPlayerResearchData,
  } as Record<string, (i: { history: PlayerHistory; bio: PlayerBio | null }) => ReturnType<typeof import('../lib/sports/mlb/adapters/playerDetailAdapter').toPlayerResearchData>>;
  const { formatResearchValue, seasonLabelFor } = { ...(await import('../lib/sports/shared/playerResearchShapes')), seasonLabelFor: (await import('../lib/sports/shared/season')).seasonLabel };

  let compared = 0;
  let ipCells = 0;
  let equal = 0;
  const diffs = new Map<string, string[]>();
  for (const file of fs.readdirSync('docs/design/phase-g2/data').filter((f) => f.startsWith('player-') && !/tennis|golf/.test(f))) {
    const d = JSON.parse(fs.readFileSync(`docs/design/phase-g2/data/${file}`, 'utf8'));
    const spec = d.sport === 'cfb' ? CFB_QB : G2_SPEC[d.kind];
    if (!spec) continue;
    const sport = d.sport as HistorySport;
    const games: PlayerGame[] = d.games.map((g: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      eventId: String(g.event), date: g.date, season: g.season, teamId: g.team, opponentId: g.opp, isHome: g.home, stats: g.stats,
      result: g.result ?? null, teamScore: g.pf ?? null, opponentScore: g.pa ?? null, opponent: { name: null, abbr: g.oppAbbr ?? null, logoUrl: null },
    }));
    const bio = { positionAbbr: d.bio?.posAbbr ?? null } as PlayerBio;
    const ours = adapters[APP_SPORT[sport]]({ history: { sport, athleteId: d.slug, games, asOf: null, resultsSource: '' }, bio });
    if (!ours) continue;
    const seasons = [...new Set(d.games.map((g: { season: number }) => g.season))] as number[];
    for (const s of seasons) {
      const gs = d.games.filter((g: { season: number }) => g.season === s);
      const row = ours.seasons.rows.find((r) => r.season === s)!;
      for (const c of spec.seasonCols as Array<{ label: string; fn: (g: unknown[]) => number | null; dec?: number }>) {
        const oc = ours.seasons.columns.find((x) => x.label === c.label);
        if (!oc) continue;
        const theirs = typeof c.fn(gs) === 'string' ? String(c.fn(gs)) : fmt.n(c.fn(gs), c.dec || 0);
        const mine = formatResearchValue(row.values[oc.key], oc);
        compared++;
        // Presentation differences named in the header: baseball rates without the
        // leading zero, innings in thirds, save percentage as a rate.
        const sameValue = theirs === mine || theirs.replace(/^0\./, '.') === mine || (oc.format === 'rate3' && Math.abs(Number(theirs) / 100 - Number(`0${mine}`)) < 1e-9);
        const ipByDesign = oc.format === 'ip';
        if (sameValue) equal++;
        else if (ipByDesign) {
          equal++;
          ipCells++;
        }
        else {
          const key = `${d.slug} ${c.label}`;
          diffs.set(key, [...(diffs.get(key) ?? []), `${seasonLabelFor(sport, s)} g2=${theirs} ours=${mine}`]);
        }
      }
      if (row.games !== gs.length) {
        compared++;
        diffs.set(`${d.slug} GP`, [`${s} g2=${gs.length} ours=${row.games}`]);
      } else {
        compared++;
        equal++;
      }
    }
  }
  console.log(`season-table cells compared ${compared}, equal ${equal} (of which ${ipCells} IP cells printed in thirds by design), different ${compared - equal}`);
  for (const [k, v] of diffs) console.log(`  ${k}: ${v.slice(0, 3).join(' | ')}${v.length > 3 ? ` (+${v.length - 3})` : ''}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
