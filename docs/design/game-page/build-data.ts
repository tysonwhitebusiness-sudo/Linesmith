/**
 * Builds the game-page mockup's data from REAL /api/game-research payloads
 * (raw/, captured with capture.sh), through the app's own adapters, so every
 * section the mockup draws is one the app would show.
 *
 *   npx tsx docs/design/game-page/build-data.ts
 *
 * Live states: MLB is a StatsAPI replay (a real live read), CFB and tennis were
 * captured live. NFL, NBA, NHL and soccer had no live game while this was
 * built, so their live state is the FINAL payload cut at a real play: plays,
 * win probability, runs, drives, events and the score are cut there; box
 * scores and team stats cannot be cut and still read as the final. The mockup
 * says so on every such page.
 *
 * `hero` is the prototype of the new hero's data: everything in it is read
 * from the payload, never invented. Where the design wants a field no payload
 * holds (tennis server, NBA bonus), the field is absent and `missing` says so.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { toGameResearchData as mlb } from '../../../lib/sports/mlb/adapters/mlbGameResearch';
import { toGameResearchData as football } from '../../../lib/sports/nfl/adapters/footballGameResearch';
import { toGameResearchData as soccer } from '../../../lib/sports/soccer/adapters/soccerGameResearch';
import { toGameResearchData as tennis } from '../../../lib/sports/tennis/adapters/tennisGameResearch';
import { toGameResearchData as nba } from '../../../lib/sports/nba/adapters/nbaGameResearch';
import { toGameResearchData as nhl } from '../../../lib/sports/nhl/adapters/nhlGameResearch';
import { bandColors, teamColor } from '../../../lib/sports/shared/teamColors';
import { headshotFor } from '../../../lib/sports/shared/identity';
import { gameWhen } from '../../../lib/sports/shared/gameResearch';

const D = 'docs/design/game-page/';
const raw = (n: string) => JSON.parse(readFileSync(D + 'raw/' + n + '.json', 'utf8'));
const ADAPT: Record<string, any> = { mlb, nfl: football, cfb: football, soccer_epl: soccer, soccer_mls: soccer, tennis_atp: tennis, tennis_wta: tennis, nba, nhl };
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------------------
// Cuts: a final payload as it stood at one real play
// ---------------------------------------------------------------------------

function cutFootball(p: any, pick: (plays: any[]) => number) {
  const c = clone(p);
  const f = c.football;
  const plays = f.drives.flatMap((d: any) => d.plays.map((pl: any) => ({ ...pl, driveId: d.id })));
  const k = pick(plays);
  const at = plays[k];
  const next = plays[k + 1] ?? at;
  const order = new Map(plays.map((pl: any, i: number) => [pl.id, i]));
  const keep = (id: string) => (order.get(id) ?? Infinity) <= k;
  f.drives = f.drives
    .filter((d: any) => d.plays.length && keep(d.plays[0].id))
    .map((d: any) => {
      const inDrive = d.plays.filter((pl: any) => keep(pl.id));
      const current = inDrive.length < d.plays.length || d.id === at.driveId;
      return current ? { ...d, plays: inDrive, current: true, result: null, shortResult: null, isScore: false, offensivePlays: inDrive.length, yards: inDrive.reduce((s: number, pl: any) => s + (pl.yards ?? 0), 0), description: `${inDrive.length} plays` } : { ...d, current: false };
    });
  f.winProbability = f.winProbability.filter((w: any) => keep(w.playId));
  f.scoring = f.scoring.filter((s: any) => keep(s.id));
  c.away.score = at.awayScore;
  c.home.score = at.homeScore;
  c.lineScore = periodLine(c.lineScore, at.period, f.scoring.map((s: any) => ({ period: s.period, away: s.awayScore, home: s.homeScore })), at.awayScore, at.homeScore);
  c.state = 'live';
  c.statusText = `${at.clock} - ${ord(at.period)}`;
  const ytg = next.startYardsToEndzone;
  const offense = next.teamId === c.away.id ? c.away.abbr : c.home.abbr;
  const defense = next.teamId === c.away.id ? c.home.abbr : c.away.abbr;
  const spot = ytg == null ? '' : ytg === 50 ? ' at 50' : ytg < 50 ? ` at ${defense} ${ytg}` : ` at ${offense} ${100 - ytg}`;
  f.live = { period: at.period, clock: at.clock, possessionTeamId: next.teamId, downText: next.downText ? `${next.downText.split(' at ')[0]}${spot}` : null, redZone: (next.startYardsToEndzone ?? 99) <= 20, lastPlay: at.text, inGame: { now: [], moneyline: [] } };
  return { payload: c, cutAt: `${ord(at.period)} quarter, ${at.clock}` };
}

/** A line score with the periods after `period` blanked and `period` itself the runs so far. */
function periodLine(ls: any, period: number, scores: Array<{ period: number; away: number; home: number }>, away: number, home: number) {
  if (!ls) return ls;
  const n = ls.periods.length;
  const upTo = (side: 'away' | 'home', per: number) => scores.filter((s) => s.period <= per).reduce((m, s) => Math.max(m, s[side]), 0);
  const row = (side: 'away' | 'home', total: number) => [
    ...Array.from({ length: n }, (_, i) => (i + 1 < period ? upTo(side, i + 1) - upTo(side, i) : i + 1 === period ? total - upTo(side, i) : null)),
    total,
    ...ls.totals.slice(1).map(() => null),
  ];
  return { ...ls, away: row('away', away), home: row('home', home) };
}

function cutNba(p: any, pick: (plays: any[]) => number) {
  const c = clone(p);
  const n = c.nba;
  const k = pick(n.plays);
  const at = n.plays[k];
  const order = new Map(n.plays.map((pl: any, i: number) => [pl.id, i]));
  const keep = (id: string) => (order.get(id) ?? Infinity) <= k;
  n.plays = n.plays.slice(0, k + 1);
  n.winProbability = n.winProbability.filter((w: any) => keep(w.playId));
  n.lead = n.lead.filter((l: any) => keep(l.playId));
  n.runs = n.runs.filter((r: any) => keep(r.endPlayId));
  c.away.score = at.awayScore;
  c.home.score = at.homeScore;
  const ends = [1, 2, 3, 4].map((q) => n.plays.filter((pl: any) => pl.period === q).pop()).map((pl: any) => (pl ? { period: pl.period, away: pl.awayScore, home: pl.homeScore } : null)).filter(Boolean);
  c.lineScore = periodLine(c.lineScore, at.period, ends as any, at.awayScore, at.homeScore);
  c.state = 'live';
  c.statusText = `${at.clock} - ${ord(at.period)}`;
  n.live = { period: at.period, clock: at.clock, inGame: { now: [], moneyline: [] } };
  return { payload: c, cutAt: `${ord(at.period)} quarter, ${at.clock}` };
}

const mmss = (s: string) => { const [m, x] = s.split(':').map(Number); return m * 60 + x; };

function cutNhl(p: any, pick: (events: any[]) => number) {
  const c = clone(p);
  const h = c.nhl;
  const k = pick(h.events);
  const at = h.events[k];
  h.events = h.events.slice(0, k + 1);
  const goals = h.events.filter((e: any) => e.type === 'goal');
  const last = goals[goals.length - 1];
  const away = last?.awayScore ?? 0;
  const home = last?.homeScore ?? 0;
  c.away.score = away;
  c.home.score = home;
  const shots = (per: number, isHome: boolean) => h.events.filter((e: any) => e.period === per && e.isHome === isHome && (e.type === 'shot-on-goal' || e.type === 'goal')).length;
  h.shotsByPeriod = [1, 2, 3].filter((per) => per <= at.period).map((per) => ({ period: `P${per}`, away: shots(per, false), home: shots(per, true) }));
  const sog = (isHome: boolean) => h.shotsByPeriod.reduce((s: number, r: any) => s + (isHome ? r.home : r.away), 0);
  c.lineScore = periodLine(c.lineScore, at.period, goals.map((g: any) => ({ period: g.period, away: g.awayScore, home: g.homeScore })), away, home);
  c.lineScore.away[c.lineScore.away.length - 1] = sog(false);
  c.lineScore.home[c.lineScore.home.length - 1] = sog(true);
  const left = 20 * 60 - mmss(at.timeInPeriod);
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  c.state = 'live';
  c.statusText = `P${at.period} ${clock}`;
  h.live = { period: `P${at.period}`, clock, intermission: false, inGame: { now: [], moneyline: [] } };
  return { payload: c, cutAt: `period ${at.period}, ${clock} left` };
}

function cutSoccer(p: any, seconds: number) {
  const c = clone(p);
  const s = c.soccer;
  s.keyEvents = s.keyEvents.filter((e: any) => (e.seconds ?? 0) <= seconds);
  s.commentary = s.commentary.filter((e: any) => (e.seconds ?? 0) <= seconds);
  const goals = s.keyEvents.filter((e: any) => /goal/i.test(e.type ?? '') && !/disallowed/i.test(e.type ?? ''));
  const away = goals.filter((g: any) => g.teamId === c.away.id).length;
  const home = goals.filter((g: any) => g.teamId === c.home.id).length;
  c.away.score = away;
  c.home.score = home;
  const half = seconds > 45 * 60 ? 2 : 1;
  const firstHalf = (id: string) => goals.filter((g: any) => g.teamId === id && g.seconds <= 45 * 60 + 600 && Number(String(g.minute).split("'")[0].split('+')[0]) <= 45).length;
  c.lineScore = { ...c.lineScore, away: [firstHalf(c.away.id), half === 2 ? away - firstHalf(c.away.id) : null, away], home: [firstHalf(c.home.id), half === 2 ? home - firstHalf(c.home.id) : null, home] };
  const minute = `${Math.floor(seconds / 60)}'`;
  c.state = 'live';
  c.statusText = minute;
  s.live = { minute, inGame: { now: [], moneyline: [] } };
  return { payload: c, cutAt: `minute ${Math.floor(seconds / 60)}` };
}

// ---------------------------------------------------------------------------
// Hero data — the new hero's fields, all read from the payload
// ---------------------------------------------------------------------------

const colors: Record<string, any> = {};
for (const s of ['mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer_epl', 'soccer_mls']) colors[s] = JSON.parse(readFileSync(`${D}raw/colors-${s}.json`, 'utf8')).index;

function teamOf(sport: string, side: any) {
  // NHL payload ids are the NHL's own, the colour index is ESPN's: match those by abbreviation.
  const c = teamColor(colors[sport], sport === 'nhl' ? { abbr: side.abbr } : { id: side.id, abbr: side.abbr });
  const band = bandColors(c);
  return { id: side.id, name: side.name, abbr: side.abbr, logo: side.logoUrl, href: side.href, record: side.record, score: side.score, color: c, band: band.stops, accent: band.accent };
}

const am = (n: number | null | undefined) => (n == null ? null : n > 0 ? `+${n}` : String(n));
function lineText(l: any, p: any) {
  if (!l) return null;
  const s = (k: string) => l.sides.find((x: any) => x.side === k);
  if (l.market === 'moneyline') return { away: am(s('away')?.americanOdds), home: am(s('home')?.americanOdds), ...(s('draw') ? { draw: am(s('draw')?.americanOdds) } : {}) };
  if (l.market === 'spread') return { away: s('away') ? `${s('away').point > 0 ? '+' : ''}${s('away').point} ${am(s('away').americanOdds)}` : null, home: s('home') ? `${s('home').point > 0 ? '+' : ''}${s('home').point} ${am(s('home').americanOdds)}` : null };
  if (l.market === 'total') return { total: s('over')?.point ?? null, over: am(s('over')?.americanOdds), under: am(s('under')?.americanOdds) };
  return null;
}
/** Game lines for the hero: each market's open and close, and the latest in-game line while live. */
function espnLines(l: any): any[] {
  if (!l || typeof l !== 'object') return [];
  const sd = (side: string, point: any, odds: any) => ({ side, point: point ?? null, americanOdds: odds ?? null });
  const at = (k: 'open' | 'close') => ({
    moneyline: l.moneyline && { market: 'moneyline', sides: [sd('away', null, l.moneyline.away?.[k]), sd('home', null, l.moneyline.home?.[k]), ...(l.moneyline.draw ? [sd('draw', null, l.moneyline.draw[k])] : [])] },
    spread: l.spread && { market: 'spread', sides: [sd('away', l.spread.away?.line?.[k], l.spread.away?.odds?.[k]), sd('home', l.spread.home?.line?.[k], l.spread.home?.odds?.[k])] },
    total: l.total && { market: 'total', sides: [sd('over', l.total.over?.line?.[k], l.total.over?.odds?.[k]), sd('under', l.total.under?.line?.[k], l.total.under?.odds?.[k])] },
  });
  const o = at('open');
  const c = at('close');
  return (['moneyline', 'spread', 'total'] as const).filter((m) => o[m] || c[m]).map((m) => ({ market: m, open: o[m], close: c[m], provider: l.provider }));
}
function heroLines(p: any, block: any) {
  const lines = Array.isArray(block.lines) ? block.lines : block.storedLines?.length ? block.storedLines : espnLines(block.lines);
  const arr: any[] = Array.isArray(lines) ? lines : [];
  const inGame = block.live?.inGame?.now ?? [];
  return ['moneyline', 'spread', 'total']
    .map((m) => {
      const l = arr.find((x: any) => x.market === m);
      const now = inGame.find((x: any) => x.market === m)?.line;
      if (!l && !now) return null;
      return { market: m, open: lineText(l?.open, p), close: lineText(l?.close, p), now: lineText(now, p) };
    })
    .filter(Boolean);
}

function wpSeries(p: any, block: any) {
  const wp = block.winProbability ?? [];
  if (!wp.length) return null;
  return wp.map((w: any) => Math.round((w.home ?? 0.5) * 1000) / 1000);
}

function mlbHero(p: any) {
  const m = p.mlb;
  const out: any = {};
  if (p.state === 'live' && m.live) {
    const L = m.live;
    const ab = m.atBats[m.atBats.length - 1];
    const last = ab?.pitches[ab.pitches.length - 1];
    out.situation = {
      kind: 'diamond',
      inning: L.inning.number, half: L.inning.half, outs: L.outs, balls: L.count.balls, strikes: L.count.strikes, bases: L.bases,
      batter: L.batter && { id: L.batter.id, name: L.batter.name, line: L.batter.todayLine, hand: ab?.bats ?? null, img: headshotFor('mlb', L.batter.id), side: L.inning.half === 'top' ? 'away' : 'home' },
      pitcher: L.pitcher && { id: L.pitcher.id, name: L.pitcher.name, line: `${L.pitcher.ip} IP · ${L.pitcher.h} H · ${L.pitcher.r} R · ${L.pitcher.k} K · ${L.pitcher.pitches} P`, hand: ab?.throws ?? null, img: headshotFor('mlb', L.pitcher.id), side: L.inning.half === 'top' ? 'home' : 'away' },
      onDeck: L.onDeck && { id: L.onDeck.id, name: L.onDeck.name, line: L.onDeck.todayLine },
      lastPitch: last ? { type: last.typeName ?? last.type, speed: last.speed, call: last.call } : null,
      result: ab?.event ? `${ab.event}: ${ab.description ?? ''}` : null,
      pitchesThisAb: ab?.pitches.filter((x: any) => x.pX != null).map((x: any, i: number) => ({ n: i + 1, type: x.type, name: x.typeName, speed: x.speed, call: x.call, x: x.pX, z: x.pZ, top: x.zoneTop, bot: x.zoneBottom })) ?? [],
    };
  }
  const st = m.pregame?.starters?.payload?.starters ?? m.pregame?.starters?.starters ?? null;
  if (p.state === 'pre' && st) {
    out.probables = (['away', 'home'] as const).map((side) => {
      const s = st[side];
      if (!s) return null;
      const log = s.log ?? [];
      const ip = log.reduce((a: number, r: any) => a + Math.floor(r[2]) + ((r[2] * 10) % 10) / 3, 0);
      const er = log.reduce((a: number, r: any) => a + (r[5] ?? 0), 0);
      const k = log.reduce((a: number, r: any) => a + (r[6] ?? 0), 0);
      const name = (p.notes.find((n: string) => n.startsWith('Probable')) ?? '').replace('Probable: ', '').split(' vs ')[side === 'away' ? 0 : 1] ?? null;
      return { side, id: s.id, name, img: headshotFor('mlb', s.id), last: `Last ${log.length} starts: ${ip.toFixed(1)} IP, ${er} ER, ${k} K`, era: ip ? ((er * 9) / ip).toFixed(2) : null, mix: (s.mix ?? []).slice(0, 4).map((x: any) => ({ type: x.type, share: x.share, velo: x.velo })) };
    });
  }
  if (p.state === 'final' && m.box) {
    const pitchers = [...m.box.away.pitching.map((x: any) => ({ ...x, side: 'away' })), ...m.box.home.pitching.map((x: any) => ({ ...x, side: 'home' }))];
    out.decisions = p.notes
      .map((n: string) => {
        const [label, last] = [n.split(' ')[0], n.split(' ').slice(1).join(' ')];
        const pt = pitchers.find((x: any) => x.name.endsWith(last));
        return pt ? { label, id: pt.id, name: pt.name, side: pt.side, img: headshotFor('mlb', pt.id), line: `${pt.s.ip} IP · ${pt.s.h} H · ${pt.s.er} ER · ${pt.s.k} K`, season: pt.season?.era ? `${pt.season.era} ERA` : null } : null;
      })
      .filter(Boolean);
    const bats = [...m.box.away.batting.map((x: any) => ({ ...x, side: 'away' })), ...m.box.home.batting.map((x: any) => ({ ...x, side: 'home' }))];
    out.performers = bats
      .map((b: any) => ({ ...b, score: b.s.tb + b.s.rbi + b.s.r + b.s.bb }))
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 3)
      .map((b: any) => ({ id: b.id, name: b.name, side: b.side, img: headshotFor('mlb', b.id), line: [`${b.s.h}-for-${b.s.ab}`, b.s.hr ? `${b.s.hr} HR` : null, b.s.doubles ? `${b.s.doubles} 2B` : null, b.s.rbi ? `${b.s.rbi} RBI` : null, b.s.r ? `${b.s.r} R` : null].filter(Boolean).join(' · ') }));
  }
  out.wp = wpSeries(p, m);
  out.lines = heroLines(p, m);
  return out;
}

function footballHero(p: any, sport: string) {
  const f = p.football;
  const out: any = {};
  if (p.state === 'live' && f.live) {
    const L = f.live;
    const poss = L.possessionTeamId === p.away.id ? 'away' : L.possessionTeamId === p.home.id ? 'home' : null;
    // "1st & 10 at TEX 18": yards from the AWAY end zone (left of the hero), so the ball is drawn where it is.
    const mm = /at ([A-Z&]+) (\d+)/.exec(L.downText ?? '');
    const ballOn = mm ? (mm[1] === p.away.abbr ? Number(mm[2]) : 100 - Number(mm[2])) : /at 50/.test(L.downText ?? '') ? 50 : null;
    const dist = /& (\d+|Goal)/.exec(L.downText ?? '');
    const toGo = dist ? (dist[1] === 'Goal' ? null : Number(dist[1])) : null;
    out.situation = { kind: 'field', period: L.period, clock: L.clock, possession: poss, downText: L.downText, ballOn, toGo, direction: poss === 'away' ? 1 : -1, redZone: L.redZone, lastPlay: L.lastPlay };
  }
  if (p.state === 'final' || p.state === 'live') {
    out.scoring = (f.scoring ?? []).map((s: any) => ({ side: s.teamId === p.away.id ? 'away' : 'home', period: s.period, clock: s.clock, type: s.type, text: s.text, away: s.awayScore, home: s.homeScore }));
  }
  out.wp = wpSeries(p, f);
  out.lines = heroLines(p, f);
  return out;
}

function nbaHero(p: any) {
  const n = p.nba;
  const out: any = {};
  if (p.state === 'live' && n.live) {
    const last = n.plays[n.plays.length - 1];
    const run = n.runs[n.runs.length - 1];
    out.situation = {
      kind: 'clock', period: `${ord(n.live.period)} quarter`, clock: n.live.clock, lastPlay: last?.text ?? null,
      run: run ? { side: run.teamId === p.away.id ? 'away' : 'home', points: run.points, when: `${ord(run.period)} ${run.clock}` } : null,
      strength: null,
    };
    out.missing = ['fouls and the bonus: not in the NBA payload today'];
  }
  out.wp = wpSeries(p, n);
  out.lines = heroLines(p, n);
  return out;
}

/** api-web situation code: away goalie, away skaters, home skaters, home goalie. */
function strength(code: string | null, p: any) {
  if (!code || code.length !== 4) return null;
  const [ag, as, hs, hg] = code.split('').map(Number);
  if (as === hs && ag && hg) return as === 5 ? null : { label: `${as} on ${hs}`, side: null };
  if (!ag) return { label: `${p.away.abbr} goalie pulled`, side: 'away' };
  if (!hg) return { label: `${p.home.abbr} goalie pulled`, side: 'home' };
  return as > hs ? { label: `${p.away.abbr} power play · ${as} on ${hs}`, side: 'away' } : { label: `${p.home.abbr} power play · ${hs} on ${as}`, side: 'home' };
}

function nhlHero(p: any) {
  const h = p.nhl;
  const out: any = {};
  if (p.state === 'live' && h.live) {
    const last = [...h.events].reverse().find((e: any) => !['period-start', 'stoppage'].includes(e.type));
    const name = (id: any) => (id ? h.roster[String(id)]?.name : null);
    const sog = (isHome: boolean) => h.shotsByPeriod.reduce((s: number, r: any) => s + (isHome ? r.home : r.away), 0);
    out.situation = {
      kind: 'clock', period: h.live.period.replace('P', 'Period '), clock: h.live.clock,
      lastPlay: last ? `${last.type.replace(/-/g, ' ')}${last.shooterId ? ` · ${name(last.shooterId)}` : ''} · ${last.isHome ? p.home.abbr : p.away.abbr}` : null,
      run: null,
      strength: strength(last?.situation ?? null, p),
      shots: { away: sog(false), home: sog(true) },
    };
  }
  out.wp = null;
  out.lines = heroLines(p, h);
  if (p.state !== 'pre') {
    out.goals = h.events.filter((e: any) => e.type === 'goal').map((g: any) => ({ side: g.isHome ? 'home' : 'away', period: g.period, time: g.timeInPeriod, name: h.roster[String(g.shooterId)]?.name ?? null, id: g.shooterId, img: headshotFor('nhl', g.shooterId) }));
  }
  return out;
}

function soccerHero(p: any) {
  const s = p.soccer;
  const out: any = {};
  const side = (id: string) => (id === p.away.id ? 'away' : 'home');
  const goals = s.keyEvents.filter((e: any) => /goal/i.test(e.type ?? '') && !/disallowed/i.test(e.type ?? '')).map((g: any) => ({ side: side(g.teamId), minute: g.minute, text: g.text, name: (g.text ?? '').split(' (')[0].replace(/^Goal!\s*[^.]*\.\s*/, '') }));
  const cards = (sd: string, kind: RegExp) => s.keyEvents.filter((e: any) => kind.test(e.type ?? '') && side(e.teamId) === sd).length;
  if (p.state !== 'pre') {
    out.goals = goals;
    out.cards = { away: { yellow: cards('away', /yellow/i), red: cards('away', /red/i) }, home: { yellow: cards('home', /yellow/i), red: cards('home', /red/i) } };
  }
  if (p.state === 'live' && s.live) {
    const last = s.keyEvents[s.keyEvents.length - 1];
    const poss = s.teamStats?.find((t: any) => /possession/i.test(t.label ?? t.name ?? ''));
    out.situation = { kind: 'minute', minute: s.live.minute, lastPlay: last?.text ?? null, possession: poss ?? null };
  }
  out.wp = null;
  out.lines = heroLines(p, s);
  return out;
}

function tennisHero(p: any) {
  const t = p.tennis;
  const out: any = { tournament: t.tournament, round: t.round, surface: t.surface, resultNote: t.resultNote };
  out.situation = { kind: 'sets', sets: p.state === 'pre' ? [] : t.sets, live: p.state === 'live' };
  if (p.state === 'live') out.missing = ['who is serving and the point score: not in the tennis payload today'];
  out.wp = null;
  out.lines = heroLines(p, t);
  return out;
}

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
/** Reds against reds (LIV at BOU), oranges against oranges (TEX at TENN): the away band switches so the two halves read apart. */
function unclash(sport: string, away: any, home: any) {
  if (dist(away.band[0], home.band[0]) >= 70) return { away, home };
  const alt = away.color?.secondary ? bandColors({ primary: away.color.secondary, secondary: null }) : null;
  const band = alt && alt.source !== 'charcoal' && dist(alt.stops[0], home.band[0]) >= 70 ? alt.stops : bandColors(null).stops;
  return { away: { ...away, band, clash: true }, home };
}

function heroFor(sport: string, p: any) {
  const base = {
    state: p.state,
    statusText: p.statusText,
    when: gameWhen(p.start),
    start: p.start,
    venue: p.venue,
    conditions: p.conditions,
    notes: p.notes,
    ...unclash(sport, teamOf(sport, p.away), teamOf(sport, p.home)),
    lineScore: p.lineScore,
  };
  const extra = sport === 'mlb' ? mlbHero(p) : sport === 'nfl' || sport === 'cfb' ? footballHero(p, sport) : sport === 'nba' ? nbaHero(p) : sport === 'nhl' ? nhlHero(p) : sport.startsWith('soccer') ? soccerHero(p) : tennisHero(p);
  return { ...base, ...extra };
}

// ---------------------------------------------------------------------------
// The pages
// ---------------------------------------------------------------------------

type Page = { sport: string; label: string; state: string; source: string; note: string | null; asOf: string | null; hero: any; data: any };

function page(sport: string, label: string, payload: any, source: string, opts: { requested?: string; note?: string; asOf?: string } = {}): Page {
  const data = ADAPT[payload.sport]({ payload, requestedState: opts.requested ?? null });
  // The pregame view of a finished game: the hero reads as before the start too.
  const heroPayload = opts.requested === 'pre' ? { ...payload, state: 'pre', statusText: 'Scheduled', away: { ...payload.away, score: null }, home: { ...payload.home, score: null }, lineScore: null } : payload;
  return { sport, label, state: data.state, source, note: opts.note ?? null, asOf: opts.requested === 'pre' ? null : (opts.asOf ?? payload.fetchedAt ?? null), hero: heroFor(payload.sport, heroPayload), data };
}

const flat = (p: any) => p.football.drives.flatMap((d: any) => d.plays);

const pages: Record<string, Record<string, Page>> = {};
const add = (key: string, pg: Page) => ((pages[key] ??= {})[pg.state] = pg);

// MLB — one game, three moments (StatsAPI timecodes).
add('mlb', page('mlb', 'MLB', raw('mlb-pre'), 'CIN @ TOR, 2026-09-25 · StatsAPI replay at 20:00 UTC (pre-game)', { asOf: '2026-09-25T20:00:00Z' }));
add('mlb', page('mlb', 'MLB', raw('mlb-live'), 'CIN @ TOR, 2026-09-25 · StatsAPI replay at 00:29 UTC (Top 5th)'));
add('mlb', page('mlb', 'MLB', raw('mlb-final'), 'CIN @ TOR, 2026-09-25 · final'));

// NFL — pre: Sunday's LAC @ BUF; live: Thursday's ATL @ GB cut in the third quarter; final: the same game.
add('nfl', page('nfl', 'NFL', raw('nfl-pre'), 'LAC @ BUF, 2026-09-27 · captured 2026-09-26'));
{
  const fin = raw('nfl-final');
  const cut = cutFootball(fin, (plays) => {
    const i = plays.findIndex((pl: any) => pl.period === 3 && mmss(pl.clock) <= 6 * 60 && pl.down > 0);
    return i > 0 ? i : Math.floor(plays.length * 0.6);
  });
  add('nfl', page('nfl', 'NFL', cut.payload, `ATL @ GB, 2026-09-24 · the final cut at ${cut.cutAt}`, { note: `No NFL game was live while this was built. This is the finished ATL @ GB game cut at a real play (${cut.cutAt}): the hero, drives, win probability and scoring stop there; the box score and team stats still read as the final.` }));
  add('nfl', page('nfl', 'NFL', fin, 'ATL @ GB, 2026-09-24 · final'));
}

// CFB — pre: OU @ UGA; live: TEX @ TENN captured live; final: UTSA @ TEX.
add('cfb', page('cfb', 'CFB', raw('cfb-pre'), 'OU @ UGA, 2026-09-26 · captured before the start'));
add('cfb', page('cfb', 'CFB', raw('cfb-live-q1'), 'TEX @ TENN, 2026-09-26 · captured live'));
add('cfb', page('cfb', 'CFB', raw('cfb-final'), 'UTSA @ TEX, 2026-09-19 · final'));

// NBA — off-season: one game, pregame as it stood at the start, a cut, the final.
{
  const fin = raw('nba-final');
  add('nba', page('nba', 'NBA', fin, 'OKC @ LAL, 2026-04-08 · research as it stood at the start', { requested: 'pre', note: 'No NBA game is scheduled until the preseason, so the pregame page is a finished game shown as it stood at the start — the app already does this for ?state=pre.' }));
  const cut = cutNba(fin, (plays) => plays.findIndex((pl: any) => pl.period === 3 && mmss(pl.clock) <= 5 * 60));
  add('nba', page('nba', 'NBA', cut.payload, `OKC @ LAL, 2026-04-08 · the final cut at ${cut.cutAt}`, { note: `No NBA game was live. This is the finished OKC @ LAL game cut at a real play (${cut.cutAt}): plays, lead, runs and win probability stop there; the box score and team stats still read as the final.` }));
  add('nba', page('nba', 'NBA', fin, 'OKC @ LAL, 2026-04-08 · final'));
}

// NHL — preseason: pre PIT @ BUF; live: BOS @ WSH cut in the third on a power play; final: the same game.
add('nhl', page('nhl', 'NHL', raw('nhl-pre'), 'PIT @ BUF, 2026-09-26 (preseason) · captured before the start'));
{
  const fin = raw('nhl-final');
  const cut = cutNhl(fin, (ev) => {
    const pen = ev.findIndex((e: any) => e.period === 3 && e.type === 'penalty');
    const after = ev.findIndex((e: any, i: number) => i > pen && e.type === 'shot-on-goal');
    return after > 0 ? after : Math.floor(ev.length * 0.75);
  });
  add('nhl', page('nhl', 'NHL', cut.payload, `BOS @ WSH, 2026-09-25 (preseason) · the final cut at ${cut.cutAt}`, { note: `No NHL game was live while this was built. This is the finished BOS @ WSH game cut at a real event (${cut.cutAt}): events, shots and the score stop there; the skater and goalie box still read as the final.` }));
  add('nhl', page('nhl', 'NHL', fin, 'BOS @ WSH, 2026-09-25 (preseason) · final'));
}

// Soccer — pre: MLS NYC @ ATL; live: EPL LIV @ BOU cut at 70'; final: the same.
add('soccer', page('soccer_mls', 'Soccer', raw('soccer_mls-pre'), 'NYC @ ATL (MLS), 2026-09-26 · captured before the start'));
{
  const fin = raw('soccer_epl-final');
  const cut = cutSoccer(fin, 70 * 60);
  add('soccer', page('soccer_epl', 'Soccer', cut.payload, `LIV @ BOU (EPL), 2026-09-20 · the final cut at ${cut.cutAt}`, { note: `No match was live while this was built. This is the finished LIV @ BOU match cut at ${cut.cutAt}: events, commentary, the timeline and the score stop there; team stats and lineups still read as the final.` }));
  add('soccer', page('soccer_epl', 'Soccer', fin, 'LIV @ BOU (EPL), 2026-09-20 · final'));
}

// Tennis — pre: a finished match as it stood at the start; live: WTA captured live; final: ATP.
{
  const fin = raw('tennis_atp-final');
  add('tennis', page('tennis_atp', 'Tennis', fin, 'Pavlovic v Muller, Chengdu Q1 · research as it stood at the start', { requested: 'pre', note: 'No upcoming match was captured, so the pregame page is a finished match shown as it stood at the start.' }));
  add('tennis', page('tennis_wta', 'Tennis', raw('tennis_wta-live'), 'Selekhmeteva v Grabher, Tolentino · captured live'));
  add('tennis', page('tennis_atp', 'Tennis', fin, 'Pavlovic v Muller, Chengdu Q1 · final'));
}

// Park walls for the spray chart: StatsAPI's field dimensions for the game's venue.
void fetch('https://statsapi.mlb.com/api/v1/venues/14?hydrate=fieldInfo')
  .then((r) => r.json())
  .then((venue) => {
    const park = { name: venue.venues[0].name, ...venue.venues[0].fieldInfo };

    writeFileSync(D + 'data.js', `window.GP = ${JSON.stringify({ builtAt: new Date().toISOString(), pages, park })};\n`);
    for (const [k, v] of Object.entries(pages)) console.log(k.padEnd(7), Object.values(v).map((p) => `${p.state}: ${p.hero.away.abbr} ${p.hero.away.score ?? ''}-${p.hero.home.score ?? ''} ${p.hero.home.abbr} [${p.hero.situation?.kind ?? '-'}] ${p.data.sections.length} sections`).join(' | '));
  });
