import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamResearch, formatRecord, gameResult, leagueRank, monthLabels, streak } from '../lib/sports/shared/teamResearch';
import type { TeamGame, TeamResearchPayload, TeamResearchSpec, TeamRosterEntry, TeamSeasonData } from '../lib/sports/shared/teamResearchShapes';
import { MLB_TEAM_SPEC } from '../lib/sports/mlb/adapters/teamResearchSpec';

/**
 * R7.1 — the shared team page builder. The numbers the page shows were
 * refereed against the league (Royals 2026: 66-85, 636-732, home 39-36, away
 * 27-49, L3 on 2026-09-16); these tests hold the rules that produce them.
 */

const opp = { id: '2', name: 'Other Club', abbr: 'OTH', logoUrl: null };
let n = 0;
function game(date: string, us: number | null, them: number | null, over: Partial<TeamGame> = {}): TeamGame {
  n++;
  return {
    id: String(n),
    start: `${date}T23:00:00Z`,
    date,
    home: n % 2 === 0,
    opponent: opp,
    us,
    them,
    state: us == null ? 'scheduled' : 'final',
    extra: null,
    postseason: false,
    label: null,
    venue: null,
    opponentRank: null,
    href: null,
    ...over,
  };
}

const season = (s: number, games: TeamGame[], over: Partial<TeamSeasonData> = {}): TeamSeasonData => ({ season: s, games, standings: [], stats: [], roster: [], ...over });
const payload = (seasons: TeamSeasonData[], currentSeason: number): TeamResearchPayload => ({
  sport: 'mlb',
  team: { id: '1', name: 'Test Club', abbr: 'TST', logoUrl: null, venue: 'Home Park', color: null },
  currentSeason,
  seasons,
  sources: [],
  fetchedAt: '2026-09-16T00:00:00Z',
});
const href = (id: string) => `/mlb/team/${id}`;

test('a hockey loss past regulation is an OTL, and the record reads W-L-OTL', () => {
  const hockey: Pick<TeamResearchSpec, 'record'> = { record: 'WLOTL' };
  const gs = [game('2026-01-01', 3, 2), game('2026-01-02', 2, 3, { extra: 'OT' }), game('2026-01-03', 1, 2, { extra: 'SO' }), game('2026-01-04', 0, 4)];
  assert.deepEqual(gs.map((g) => gameResult(g, hockey)), ['W', 'OTL', 'OTL', 'L']);
  assert.equal(formatRecord(gs, hockey), '1-1-2');
  // Baseball's extra innings are not an OTL.
  assert.equal(gameResult(game('2026-06-01', 3, 4, { extra: 'F/10' }), { record: 'WL' }), 'L');
  assert.equal(formatRecord([game('2026-01-01', 1, 1), game('2026-01-02', 2, 0)], { record: 'WDL' }), '1-1-0');
});

test('streak counts back from the last game', () => {
  const gs = [game('2026-05-01', 1, 0), game('2026-05-02', 0, 1), game('2026-05-03', 2, 5), game('2026-05-04', 1, 3)];
  assert.equal(streak(gs, { record: 'WL' }), 'L3');
  assert.equal(streak([], { record: 'WL' }), null);
});

test('a league rank is best-first in the stat direction, ties sharing a rank', () => {
  assert.deepEqual(leagueRank({ value: 4.2, league: [5.1, 4.2, 3.9, 4.2], direction: 'higher' }), { rank: 2, of: 4 });
  assert.deepEqual(leagueRank({ value: 3.9, league: [5.1, 4.2, 3.9, 4.2], direction: 'lower' }), { rank: 1, of: 4 });
});

test('month labels give way when a month is too short to hold one', () => {
  // The Royals' 2026 games per month, March to September.
  const counts: Array<[string, number]> = [['03', 4], ['04', 27], ['05', 28], ['06', 27], ['07', 25], ['08', 27], ['09', 13]];
  const dates = counts.flatMap(([m, c]) => Array.from({ length: c }, () => `2026-${m}-15`));
  const labels = monthLabels(dates);
  assert.equal(labels[0], '', 'March has four games and would print over April');
  assert.equal(labels[4], 'Apr');
  assert.deepEqual(labels.filter(Boolean), ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']);
});

test('the page opens on last season while the current one is under MIN_GAMES, and says so', () => {
  const last = season(2025, Array.from({ length: 30 }, (_, i) => game(`2025-05-${String((i % 28) + 1).padStart(2, '0')}`, 5, 3)));
  const current = season(2026, [game('2026-03-28', 2, 1), game('2026-03-29', 1, 2), game('2026-04-30', null, null)]);
  const data = buildTeamResearch({ payload: payload([current, last], 2026), spec: MLB_TEAM_SPEC, season: null, teamHref: href, now: new Date('2026-04-02T12:00:00Z') });
  assert.equal(data.scope.season, 2025);
  assert.match(data.scope.reason ?? '', /2026 is 2 games old, so this shows 2025/);
  assert.equal(data.hero.record, '30-0');
  assert.deepEqual(data.scope.options.map((o) => o.label), ['2026 (2 played)', '2025']);
  // The next game is always the current season's, whichever season the page shows.
  assert.match(data.hero.next?.label ?? '', /^Next: /);

  const picked = buildTeamResearch({ payload: payload([current, last], 2026), spec: MLB_TEAM_SPEC, season: 2026, teamHref: href, now: new Date('2026-04-02T12:00:00Z') });
  assert.equal(picked.scope.season, 2026);
  assert.equal(picked.scope.reason, null, "a reader's own pick needs no explanation");
  assert.equal(picked.hero.record, '1-1');
});

test('postseason games never enter the record, the splits or the margin chart', () => {
  const regular = Array.from({ length: 25 }, (_, i) => game(`2026-06-${String(i + 1).padStart(2, '0')}`, i % 2 ? 4 : 2, 3));
  const october = [game('2026-10-01', 1, 5, { postseason: true, label: 'Wild Card G1' }), game('2026-10-02', 2, 6, { postseason: true, label: 'Wild Card G2' })];
  const data = buildTeamResearch({ payload: payload([season(2026, [...regular, ...october])], 2026), spec: MLB_TEAM_SPEC, season: null, teamHref: href, now: new Date('2026-10-05T12:00:00Z') });
  assert.equal(data.hero.record, '12-13');
  assert.ok(data.hero.tiles.some((t) => t.label === 'Postseason' && t.value === '0-2'));
  const results = data.sections.find((s) => s.id === 'results')!;
  const margin = results.rows[0][0];
  assert.ok(margin.kind === 'histogram');
  assert.equal(margin.bars.length, 25);
  const splits = results.rows[1][0];
  assert.ok(splits.kind === 'table');
  assert.deepEqual(splits.rows.find((r) => r.key === 'all')?.values.gp, 25);
  assert.deepEqual(splits.rows.find((r) => r.key === 'post')?.values.rec, '0-2');
  // The last ten do include October: they are the team's form, not its record.
  assert.deepEqual(data.hero.lastTen.slice(-2).map((g) => g.result), ['L', 'L']);
});

test('the standing names the team place in its first table, and a past season says it finished there', () => {
  const table = {
    title: 'Test Division',
    columns: [],
    rows: [
      { team: { id: '9', name: 'Leader', abbr: 'LDR', logoUrl: null }, href: null, values: {} },
      { team: { id: '1', name: 'Test Club', abbr: 'TST', logoUrl: null }, href: null, values: {} },
    ],
  };
  const gs = Array.from({ length: 25 }, (_, i) => game(`2025-06-${String(i + 1).padStart(2, '0')}`, 3, 2));
  const now = new Date('2026-06-01T12:00:00Z');
  const cur = buildTeamResearch({ payload: payload([season(2026, Array.from({ length: 25 }, (_, i) => game(`2026-05-${String(i + 1).padStart(2, '0')}`, 3, 2)), { standings: [table] })], 2026), spec: MLB_TEAM_SPEC, season: null, teamHref: href, now });
  assert.equal(cur.hero.standing, '2nd in Test Division');
  const past = buildTeamResearch({ payload: payload([season(2026, []), season(2025, gs, { standings: [table] })], 2026), spec: MLB_TEAM_SPEC, season: 2025, teamHref: href, now });
  assert.equal(past.hero.standing, 'Finished 2nd in Test Division');
  const st = past.sections.find((s) => s.id === 'standings')!.rows[0][0];
  assert.ok(st.kind === 'table');
  assert.equal(st.rows.find((r) => r.highlight)?.label, 'Test Club', 'the page team is marked');
});

test('team stats drop a stat every team shares, and a lower-is-better rank sits at the low end of the track', () => {
  const stats = [
    { key: 'era', group: 'Pitching', label: 'ERA', value: 3.1, league: [3.1, 4.0, 4.5, 5.2], direction: 'lower' as const, decimals: 2 },
    { key: 'gp', group: 'Pitching', label: 'Games', value: 150, league: [150, 150, 150, 150], direction: 'higher' as const, decimals: 0 },
  ];
  const data = buildTeamResearch({ payload: payload([season(2026, [game('2026-06-01', 1, 0)], { stats })], 2026), spec: MLB_TEAM_SPEC, season: 2026, teamHref: href, now: new Date('2026-06-02T00:00:00Z') });
  const card = data.sections.find((s) => s.id === 'stats')!.rows[0][0];
  assert.ok(card.kind === 'percentiles');
  assert.deepEqual(card.rows.map((r) => r.key), ['era']);
  assert.deepEqual(card.rows[0].rank, { rank: 1, of: 4 });
  // Best ERA is the lowest value: position 0 on the track, which RankRow colours good for a 'lower' stat.
  assert.equal(card.rows[0].percentile, 0);
});

test('the roster lists each group with its players, innings as outs', () => {
  const roster: TeamRosterEntry[] = [
    { id: '10', name: 'Hitter', position: 'SS', headshotUrl: null, href: '/mlb/player/10', games: 100, score: 150, stats: { bat_plateAppearances: 400, bat_hits: 100, bat_atBats: 360 } },
    { id: '11', name: 'Pitcher', position: 'P', headshotUrl: null, href: '/mlb/player/11', games: 30, score: 120, stats: { pit_outs: 562, pit_earnedRuns: 60, pit_strikeOuts: 180 } },
  ];
  const data = buildTeamResearch({ payload: payload([season(2026, [game('2026-06-01', 1, 0)], { roster })], 2026), spec: MLB_TEAM_SPEC, season: 2026, teamHref: href, now: new Date('2026-06-02T00:00:00Z') });
  const card = data.sections.find((s) => s.id === 'roster')!.rows[0][0];
  assert.ok(card.kind === 'table' && card.views);
  assert.deepEqual(card.views.map((v) => v.label), ['Hitters · 1', 'Pitchers · 1']);
  const pit = card.views[1];
  assert.equal(pit.rows[0].values.ip, 562, 'IP is carried as outs and printed 187.1 by the ip format');
  assert.equal(Number(pit.rows[0].values.era).toFixed(2), '2.88');
});
