/**
 * Builds the slate-polish mockup's data from TODAY's real payloads, through the
 * app's own builders, so every number in the mockup is one the app would show.
 *   npx tsx docs/design/slate-polish/build-data.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildSpotlights, flagSpotlightCards, weatherSpotlight } from '../../../lib/slate/spotlights';
import { headshotFor, teamLogoFor } from '../../../lib/sports/shared/identity';

const D = 'docs/design/slate-polish/';
const j = (n: string) => JSON.parse(readFileSync(D + n, 'utf8'));
const api = j('raw-api-mlb.json');
const slate = j('raw-slate.json');
const flags = j('raw-flags.json');
const cards = slate.games.cards;

const spot = [
  ...buildSpotlights(api.candidates, { sport: 'mlb' }),
  ...flagSpotlightCards(flags.flags, { sport: 'mlb' }),
  weatherSpotlight(cards),
].filter(Boolean);

// Headshots for every player the mockup names (movers, market, specials).
const heads: Record<string, string | null> = {};
const addHead = (id: string | null | undefined) => { if (id) heads[id] = headshotFor('mlb', id); };
for (const p of j('raw-movers.json').props) addHead(p.subjectId);
for (const r of [...j('raw-market.json').outliers, ...j('raw-market.json').disagreements]) addHead(r.subjectId);
for (const rk of j('raw-specials.json').rankings) for (const r of rk.rows) addHead(r.subjectId);
for (const f of flags.flags) if (f.subjectKind === 'player') addHead(f.subjectId);

// Team logos by abbreviation, and each player's team from the board's candidates.
const logos: Record<string, string> = {};
for (const c of cards) for (const t of [c.away, c.home]) if (t.abbr && t.logoUrl) logos[t.abbr] = t.logoUrl;
const playerTeam: Record<string, { team: string; opp: string }> = {};
const names: Record<string, string> = {};
const weather: Record<string, any> = {};
const cardByTeam: Record<string, string> = {};
for (const c of cards) { cardByTeam[c.away.abbr] = c.id; cardByTeam[c.home.abbr] = c.id; }
for (const c of api.candidates) {
  const m = c.subjectMeta ?? {};
  if (c.subjectId && m.team) playerTeam[c.subjectId] = { team: m.team, opp: m.opponent ?? '', home: !!m.isHome } as any;
  if (c.subjectId && c.subjectName) names[c.subjectId] = c.subjectName;
  const w = c.context?.weather;
  const gid = m.team ? cardByTeam[m.team] : undefined;
  if (w && gid && !weather[gid]) weather[gid] = { windMph: w.windMph, windDir: w.windDir, rainPct: w.rainPct, tempF: w.tempF };
}

writeFileSync(D + 'mockup-data.js', 'window.SP = ' + JSON.stringify({
  date: slate.date, cards, spotlights: spot, flags: flags.flags, specials: j('raw-specials.json').rankings,
  movers: j('raw-movers.json'), market: j('raw-market.json'), odds: j('raw-odds.json').games,
  ev: j('ev-rows.json'), books: j('books.json'), heads, logos, playerTeam, names, weather,
  teamLogo: Object.fromEntries(cards.flatMap((c: any) => [[c.away.abbr, teamLogoFor('mlb', null, c.away.abbr) ?? c.away.logoUrl], [c.home.abbr, c.home.logoUrl]])),
}) + ';\n');
console.log('spotlights', spot.map((s: any) => `${s.id}:${s.rows.length}`).join(' '));
