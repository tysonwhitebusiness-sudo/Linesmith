import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bioFromNhlLanding, parseEspnAthlete, parseMlbPerson } from '../lib/sports/shared/playerBio';
import { parsePlayerLanding } from '../lib/sports/nhl/apiWebParsers';
import { matchResult } from '../lib/sports/shared/playerHistoryServer';
import { buildPlayerResearch } from '../lib/sports/shared/playerResearch';
import { athleteIdOf, formatResearchValue, historySportFor, type PlayerGame, type PlayerHistory } from '../lib/sports/shared/playerResearchShapes';
import { MLB_HITTER_SPEC, mlbResearchSpec } from '../lib/sports/mlb/adapters/playerResearchSpec';
import { footballResearchSpec } from '../lib/sports/nfl/adapters/playerResearchSpec';
import { nhlResearchSpec } from '../lib/sports/nhl/adapters/playerResearchSpec';
import type { GameResultRow } from '../lib/history/gameResults';

/**
 * R6.1a — the player page without a market: bios from real saved payloads,
 * the results join rule, and the shared research builder over a G2 dataset.
 */

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const AT = '2026-09-15T12:00:00Z';

// ---------------------------------------------------------------------------
// Bios
// ---------------------------------------------------------------------------

test('MLB bio: identity from the active MLB-level roster row, not a minor-league one', () => {
  const judge = parseMlbPerson(read('tests/fixtures/bio/mlb-judge.json'), AT)!;
  assert.equal(judge.name, 'Aaron Judge');
  assert.equal(judge.jersey, '99');
  assert.equal(judge.positionAbbr, 'RF');
  assert.deepEqual(judge.team, { id: '147', name: 'New York Yankees', abbr: 'NYY', logoUrl: 'https://www.mlbstatic.com/team-logos/147.svg' });
  assert.equal(judge.injury, null);
  assert.ok(judge.facts.some((f) => f.label === 'Bats / throws' && f.value === 'R / R'));
});

test('MLB bio: the injured list is a roster status, and a rehab assignment is named', () => {
  const schmidt = parseMlbPerson(read('tests/fixtures/bio/mlb-injured.json'), AT)!;
  assert.equal(schmidt.name, 'Clarke Schmidt');
  assert.equal(schmidt.injury?.status, 'Injured 60-Day');
  assert.match(schmidt.injury?.detail ?? '', /Rehab assignment with Somerset Patriots/);
});

test('ESPN bio: team, jersey, headshot, and no injury key means no injury', () => {
  const chase = parseEspnAthlete(read('tests/fixtures/bio/espn-nfl-chase.json'), 'football/nfl', AT)!;
  assert.equal(chase.positionAbbr, 'WR');
  assert.equal(chase.team?.abbr, 'CIN');
  assert.equal(chase.jersey, '1');
  assert.equal(chase.headshotUrl, 'https://a.espncdn.com/i/headshots/nfl/players/full/4362628.png');
  assert.equal(chase.injury, null);
});

test('ESPN bio: an injury carries status, body part and return date', () => {
  const bio = parseEspnAthlete(read('tests/fixtures/bio/espn-nfl-injured.json'), 'football/nfl', AT)!;
  assert.equal(bio.injury?.status, 'Questionable');
  assert.match(bio.injury?.detail ?? '', /Achilles/);
  assert.ok(bio.injury?.returnDate?.startsWith('2026-09-20'));
});

test('ESPN bio: tennis gets the standard headshot path; soccer, whose path 404s, gets none', () => {
  const alcaraz = parseEspnAthlete(read('tests/fixtures/bio/espn-tennis-alcaraz.json'), 'tennis/atp', AT)!;
  assert.equal(alcaraz.headshotUrl, 'https://a.espncdn.com/i/headshots/tennis/players/full/3782.png');
  assert.equal(alcaraz.team, null);
  const cunha = parseEspnAthlete(read('tests/fixtures/bio/espn-soccer-cunha.json'), 'soccer/eng.1', AT)!;
  assert.equal(cunha.headshotUrl, null);
  assert.equal(cunha.team?.name, 'Manchester United');
});

test('NHL bio: from the landing, with NHL team ids and the draft spelled out', () => {
  const bio = bioFromNhlLanding(parsePlayerLanding(read('tests/fixtures/nhl-landing-8477492.json')), new Date(AT), AT)!;
  assert.equal(bio.name, 'Nathan MacKinnon');
  assert.equal(bio.team?.id, '21');
  assert.equal(bio.team?.abbr, 'COL');
  assert.equal(bio.position, 'Center');
  assert.ok(bio.facts.some((f) => f.label === 'Draft' && f.value.startsWith('2013 · round 1, pick 1 (1 overall)')));
  assert.equal(bio.injury, null);
});

test('ids and sports: namespaced subject ids reduce to the athlete id', () => {
  assert.equal(athleteIdOf('espn:basketball:4278073'), '4278073');
  assert.equal(athleteIdOf('nhl:8477492'), '8477492');
  assert.equal(athleteIdOf('592450'), '592450');
  assert.equal(historySportFor('soccer', 'mls'), 'soccer_mls');
  assert.equal(historySportFor('tennis', 'wta'), 'tennis_wta');
  assert.equal(historySportFor('golf'), null);
});

// ---------------------------------------------------------------------------
// Results join
// ---------------------------------------------------------------------------

const row = (id: number, date: string, home: string, away: string, hs: number, as: number): GameResultRow => ({
  id, sport: 'nhl', gameDate: date, homeTeamId: home, awayTeamId: away, homeTeamRaw: '', awayTeamRaw: '', homeScore: hs, awayScore: as, venue: null, source: 'espn_core', eventStart: null,
});

test('results join: exact ref wins; a back-to-back takes the same-date game, not the neighbour', () => {
  // TOR @ DAL on 10/27 and TOR @ NSH on 10/28: Matthews' 10/28 game is the Nashville one.
  const results = [row(1, '2023-10-27', '25', '10', 1, 4), row(2, '2023-10-28', '18', '10', 3, 2)];
  const game = { eventId: '2023020122', date: '2023-10-28', teamId: '10', opponentId: '18' };
  assert.equal(matchResult(game, new Map(), results)?.id, 2);
  assert.equal(matchResult(game, new Map([['2023020122', results[0]]]), results)?.id, 1, 'an exact ref is taken as given');
});

test('results join: within a day only when the same date has nothing, and never when two games qualify', () => {
  const utcDated = [row(3, '2023-10-29', '18', '10', 3, 2)];
  assert.equal(matchResult({ eventId: 'x', date: '2023-10-28', teamId: '10', opponentId: '18' }, new Map(), utcDated)?.id, 3);
  const two = [row(4, '2024-01-01', '10', '18', 2, 1), row(5, '2024-01-03', '18', '10', 4, 0)];
  assert.equal(matchResult({ eventId: 'y', date: '2024-01-02', teamId: '10', opponentId: '18' }, new Map(), two), null);
});

// ---------------------------------------------------------------------------
// The builder, over the G2 datasets (same player_game_history rows)
// ---------------------------------------------------------------------------

function historyFrom(slug: string, sport: PlayerHistory['sport']): PlayerHistory {
  const d = read(`docs/design/phase-g2/data/player-${slug}.json`);
  const games: PlayerGame[] = d.games.map((g: Record<string, any>) => ({
    eventId: String(g.event), date: g.date, season: g.season, teamId: g.team, opponentId: g.opp, isHome: g.home, stats: g.stats,
    result: g.result ?? null, teamScore: g.pf ?? null, opponentScore: g.pa ?? null, opponent: { name: null, abbr: g.oppAbbr ?? null, logoUrl: null },
  }));
  return { sport, athleteId: slug, games, asOf: null };
}

test('builder: a pitcher opens as a pitcher, innings sum as outs and print as thirds', () => {
  const h = historyFrom('mlb-skubal', 'mlb');
  const spec = mlbResearchSpec(null, h.games);
  assert.equal(spec.kind, 'pitcher');
  const data = buildPlayerResearch({ sport: 'mlb', history: h, spec, now: new Date(AT) })!;
  const outs2026 = h.games.filter((g) => g.season === 2026).reduce((s, g) => {
    const [w, t = '0'] = String(g.stats.pit_inningsPitched).split('.');
    return s + Number(w) * 3 + Number(t);
  }, 0);
  const ipTile = data.hero.tiles.find((t) => t.label === 'IP')!;
  assert.equal(ipTile.value, `${Math.floor(outs2026 / 3)}.${outs2026 % 3}`);
  assert.equal(data.seasons.rows.at(-1)?.label, 'All held');
  assert.deepEqual(data.seasons.rows.slice(0, -1).map((r) => r.games), [2026, 2025, 2024].map((s) => h.games.filter((g) => g.season === s).length));
  assert.equal(data.gameLog.rows[0].date >= data.gameLog.rows.at(-1)!.date, true, 'log is newest first');
  assert.equal(data.gameLog.rows[0].href, `/mlb/game/${data.gameLog.rows[0].eventId}`);
});

test('builder: one NFL game into a season opens on last season, and says why', () => {
  const h = historyFrom('nfl-chase', 'nfl');
  const data = buildPlayerResearch({ sport: 'nfl', history: h, spec: footballResearchSpec('nfl', null, h.games), now: new Date(AT) })!;
  assert.equal(data.kind, 'receiver');
  assert.equal(data.hero.scopeLabel, '2025-26 season (2026-27: 1 game)');
  assert.match(data.hero.scopeReason ?? '', /2026-27 is 1 game old, so this shows 2025-26/);
  assert.equal(data.splits.defaultSeason, 2025);
});

test('builder: NHL between seasons opens on the finished season without a reason line', () => {
  const h = historyFrom('nhl-vasilevskiy', 'nhl');
  const spec = nhlResearchSpec(null, h.games);
  assert.equal(spec.kind, 'goalie');
  const data = buildPlayerResearch({ sport: 'nhl', history: h, spec, now: new Date(AT) })!;
  assert.equal(data.hero.scopeLabel, '2025-26 season');
  assert.equal(data.hero.scopeReason, null);
  const sv = data.hero.tiles.find((t) => t.label === 'SV %')!.value;
  assert.match(sv, /^\.\d{3}$/, 'save percentage reads .912, not 0.912');
});

test('builder: splits carry venue, result, month and opponent rows for the season', () => {
  const h = historyFrom('mlb-witt', 'mlb');
  const data = buildPlayerResearch({ sport: 'mlb', history: h, spec: MLB_HITTER_SPEC, now: new Date(AT) })!;
  const rows = data.splits.rowsBySeason[2026];
  const groups = new Set(rows.map((r) => r.group));
  for (const g of ['Overall', 'Venue', 'Result', 'Month', 'Opponent']) assert.ok(groups.has(g), `${g} rows present`);
  const home = rows.find((r) => r.key === 'Venue:home')!.games;
  const away = rows.find((r) => r.key === 'Venue:away')!.games;
  assert.equal(home + away, rows.find((r) => r.group === 'Overall')!.games);
  assert.ok(!data.splits.rowsBySeason[0].some((r) => r.group === 'Month'), 'no month rows across every season');
});

test('formatResearchValue: rates drop the leading zero, outs print as innings, percents append', () => {
  assert.equal(formatResearchValue(0.3125, { decimals: 3, format: 'rate3' }), '.313');
  assert.equal(formatResearchValue(562, { decimals: 0, format: 'ip' }), '187.1');
  assert.equal(formatResearchValue(12.345, { decimals: 1, format: 'percent' }), '12.3%');
  assert.equal(formatResearchValue(null, { decimals: 1 }), '—');
});
