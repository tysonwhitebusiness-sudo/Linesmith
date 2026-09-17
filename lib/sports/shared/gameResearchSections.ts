/**
 * The before-start sections every team sport's game page shares — Matchup
 * (strength vs strength, form coming in, head to head) and Players (each
 * prop's main line against the player's own games). R8.1b built them for MLB;
 * R8.2b moved them here for football. A sport passes its words ("bats" and
 * "arms", "offense" and "defense") and its hrefs, never a branch.
 *
 * Pure and database-free.
 */

import type { FormGame, GamePregameCommon, GameSide, GameState } from './gameResearchShapes';
import type { ResearchCard, ResearchSection, ResearchTableRow } from './playerResearchShapes';
import { ordinal } from './teamResearch';
import { liveLineHit } from './liveLine';
import type { InGameLines } from '@/lib/odds/gameLineHistory';

const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function formRecord(games: FormGame[]) {
  const w = games.filter((g) => g.us > g.them).length;
  const d = games.filter((g) => g.us === g.them).length;
  return { w, l: games.length - w - d, d, diff: games.reduce((a, g) => a + g.us - g.them, 0) };
}

export interface MatchupWords {
  /** "bats" / "offense": the side producing. */
  attack: string;
  /** "arms" / "defense": the side allowing. */
  defend: string;
  /** "run" / "point", for "run differential". */
  unit: string;
  /** How many teams the ranks run across, for the info line ("all 30 teams"). */
  pool: string;
  /** Link to a past game. */
  gameHref: (pk: FormGame['pk']) => string | null;
  /** Under the head-to-head table: which games count. */
  h2hCaption: string;
}

export function matchupSection(input: { away: GameSide; home: GameSide; state: GameState; pre: GamePregameCommon; words: MatchupWords; extra?: ResearchCard[][] }): ResearchSection {
  const { away, home, pre, words } = input;
  const rows: ResearchCard[][] = [];

  if (pre.strength.length) {
    const tone = (r: { rank: number; of: number } | null): 'good' | 'bad' | undefined => {
      if (!r) return undefined;
      // A third of the league at each end is marked: ten of 30 MLB teams, eleven of 32 NFL teams, 46 of 138 in college.
      const band = Math.max(3, Math.round(r.of / 3));
      return r.rank <= band ? 'good' : r.rank > r.of - band ? 'bad' : undefined;
    };
    const view = (att: GameSide, def: GameSide) => ({
      key: `${att.abbr}-${words.attack}`,
      label: `${att.abbr} ${words.attack} vs ${def.abbr} ${words.defend}`,
      labelHeader: 'Per game',
      columns: [
        { key: 'prod', label: `${att.abbr} produce`, decimals: 0, imageUrl: att.logoUrl },
        { key: 'prodRank', label: 'Rank', decimals: 0 },
        { key: 'allow', label: `${def.abbr} allow`, decimals: 0, imageUrl: def.logoUrl },
        { key: 'allowRank', label: 'Rank', decimals: 0 },
      ],
      rows: pre.strength.map((r) => {
        const p = r.teams[att.id]?.produced ?? null;
        const a = r.teams[def.id]?.allowed ?? null;
        const fmt = (v: number | undefined) => (v == null ? null : `${v.toFixed(r.decimals)}${r.percent ? '%' : ''}`);
        const tones: Record<string, 'good' | 'bad'> = {};
        const pt = tone(p);
        const at = tone(a);
        if (pt) tones.prodRank = pt;
        if (at) tones.allowRank = at;
        return { key: r.key, label: r.label, values: { prod: fmt(p?.value), prodRank: p ? ordinal(p.rank) : null, allow: fmt(a?.value), allowRank: a ? ordinal(a.rank) : null }, tones };
      }),
    });
    const views = [view(away, home), view(home, away)];
    const of = pre.strength[0].teams[away.id]?.produced?.of ?? pre.strength[0].teams[home.id]?.produced?.of;
    rows.push([
      {
        kind: 'table',
        key: 'strength',
        title: 'Strength vs strength',
        scope: pre.strengthNote ? `${pre.strengthSeason} season` : `${pre.strengthSeason} season, ${input.state === 'pre' ? 'before today' : 'before this game'}`,
        info: `Each ${words.attack === 'bats' ? 'lineup' : 'offense'} against the ${words.defend === 'arms' ? 'pitching and defense' : 'defense'} it faces. Ranks run across ${of ? `all ${of} teams` : words.pool}, 1st best for that side: most produced, fewest allowed. The top and bottom third are coloured.`,
        caption: pre.strengthNote ?? undefined,
        labelHeader: views[0].labelHeader,
        columns: views[0].columns,
        rows: views[0].rows,
        views,
        fixedOrder: true,
      },
    ]);
  }

  const formCard = (team: GameSide): ResearchCard => {
    const last = (pre.form[team.id]?.games ?? []).slice(-10);
    const r = formRecord(last);
    // Not every sport's form reader carries a crest (MLB's comes from StatsAPI),
    // and a caption must not promise one that is not drawn.
    const crests = last.some((g) => g.opponentLogoUrl);
    return {
      kind: 'histogram',
      key: `form-${team.abbr}`,
      title: `${team.abbr} coming in`,
      scope: last.length ? `last ${last.length}: ${r.w}-${r.l}${r.d ? `-${r.d}` : ''}, ${words.unit} differential ${signed(r.diff)}` : 'no games yet this season',
      // Ten games in a half-width card: every band clears the crest threshold.
      minBand: 20,
      height: 210,
      bars: last.map((g) => ({
        key: String(g.pk),
        axisLabel: `${g.home ? '' : '@'}${g.opponentAbbr}`,
        imageUrl: g.opponentLogoUrl ?? null,
        value: Math.abs(g.us - g.them) || 0.25,
        highlight: false,
        tone: g.us > g.them ? ('good' as const) : g.us < g.them ? ('bad' as const) : undefined,
        tip: `${g.us > g.them ? 'W' : g.us < g.them ? 'L' : 'T'} ${g.us}-${g.them} ${g.home ? 'vs' : '@'} ${g.opponentAbbr} · ${shortDay(g.date)}${g.postseason ? ' · postseason' : ''}`,
      })),
      toneLegend: { good: 'won', bad: 'lost' },
      caption: `Bar height is the margin, oldest on the left${crests ? '; the crest is the opponent' : ''}.`,
    };
  };
  rows.push([formCard(away), formCard(home)]);

  const h = formRecord(pre.h2h);
  rows.push([
    {
      kind: 'table',
      key: 'h2h',
      title: 'Head to head',
      scope: pre.h2h.length ? `${away.abbr} ${h.w}-${h.l}${h.d ? `-${h.d}` : ''} against ${home.abbr} since last season, ${words.unit}s ${signed(h.diff)}` : 'since last season',
      labelHeader: 'Date',
      fixedOrder: true,
      emptyText: `${away.abbr} and ${home.abbr} have not met since last season`,
      columns: [
        { key: 'park', label: 'At', decimals: 0 },
        { key: 'score', label: `${away.abbr}–${home.abbr}`, decimals: 0 },
        { key: 'won', label: 'Won', decimals: 0 },
      ],
      rows: [...pre.h2h].reverse().map((g) => ({
        key: String(g.pk),
        label: new Date(`${g.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
        href: words.gameHref(g.pk),
        // The winner's crest, which the "Won" column names in text as well. A
        // draw gets none rather than an arbitrary side's.
        imageUrl: g.us > g.them ? away.logoUrl : g.us < g.them ? home.logoUrl : null,
        values: { park: g.home ? away.abbr : home.abbr, score: `${g.us}–${g.them}`, won: g.us > g.them ? away.abbr : g.us < g.them ? home.abbr : 'Tie' },
      })),
      caption: words.h2hCaption,
    },
  ]);

  return { id: 'matchup', navLabel: 'Matchup', title: 'Matchup', sub: 'strength, form and head to head', rows: [...rows, ...(input.extra ?? [])], state: { kind: 'ready' } };
}

export interface PropHistoryInput {
  key: string;
  name: string;
  href: string | null;
  /** The player's face (R9a); `null` where the sport has no id for him. */
  imageUrl?: string | null;
  side: 'away' | 'home' | null;
  marketLabel: string;
  line: number;
  books: number;
  history: Array<[string, number, string]>;
}

/** Each prop's main line against the player's own games: the last ten, the last five, and games against the other team here. */
export function propHistorySection(input: { away: GameSide; home: GameSide; state: GameState; props: PropHistoryInput[] }): ResearchSection | null {
  if (!input.props.length) return null;
  const avg = (gs: Array<[string, number, string]>) => (gs.length ? gs.reduce((a, g) => a + g[1], 0) / gs.length : null);
  const rows: ResearchTableRow[] = input.props.map((p) => {
    const opp = p.side ? input[p.side === 'away' ? 'home' : 'away'] : null;
    const last10 = p.history.slice(-10);
    const vs = opp ? p.history.filter((g) => g[2] === opp.id) : [];
    const over = (gs: typeof p.history) => `${gs.filter((g) => g[1] > p.line).length} of ${gs.length}`;
    return {
      key: p.key,
      label: p.name,
      labelNote: p.side ? input[p.side].abbr : null,
      href: p.href,
      imageUrl: p.imageUrl ?? null,
      imageKind: 'player' as const,
      values: {
        market: p.marketLabel,
        line: p.line,
        l10: avg(last10),
        l10Over: last10.length ? over(last10) : '—',
        recent: last10.length ? last10.slice(-5).map((g) => g[1]).join(' ') : '—',
        vs: vs.length ? over(vs) : '—',
        vsAvg: avg(vs),
        books: p.books,
      },
    };
  });
  return {
    id: 'players',
    navLabel: 'Players',
    title: 'Players',
    sub: 'each prop’s main line against the player’s own games',
    rows: [
      [
        {
          kind: 'table',
          key: 'prop-history',
          title: 'Prop lines and history',
          scope: input.state === 'pre' ? 'games before today' : 'the line at the start, games before this one',
          info: 'Over means above the line. Games are this season and last; the last five read oldest to newest. Against the opponent counts games against the other team here.',
          labelHeader: 'Player',
          sortKey: 'books',
          columns: [
            { key: 'market', label: 'Market', decimals: 0, text: true },
            { key: 'line', label: 'Line', decimals: 1 },
            { key: 'l10', label: 'L10 avg', decimals: 2 },
            { key: 'l10Over', label: 'L10 over', decimals: 0 },
            { key: 'recent', label: 'Last 5', decimals: 0 },
            { key: 'vs', label: 'Over vs opp', decimals: 0 },
            { key: 'vsAvg', label: 'Avg vs opp', decimals: 2 },
            { key: 'books', label: 'Books', decimals: 0 },
          ],
          rows,
          caption: 'Markets with one book quoting both sides are left out.',
        },
      ],
    ],
    state: { kind: 'ready' },
  };
}

// ---------------------------------------------------------------------------
// While the game is on — R8.1c built these for MLB, R8.2c shares them
// ---------------------------------------------------------------------------

const etTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const am = (v: number | null | undefined) => (v == null ? '—' : v > 0 ? `+${v}` : String(v));

export interface TrackedProp {
  key: string;
  name: string;
  href: string | null;
  sideAbbr: string | null;
  marketLabel: string;
  line: number;
  books: number;
  /** The player's number so far; `null` before he has appeared. */
  result: number | null;
  /** The player's face (R9a); `null` where the sport has no id for him. */
  imageUrl?: string | null;
}

/** Each main line at the start against the player's number so far. Only an over is ever marked: an under cannot be settled while the game is on (`liveLineHit`). */
export function propsTrackerCard(props: TrackedProp[]): ResearchCard {
  // One book quoting both sides is a price, not a market.
  const held = props.filter((p) => p.books >= 2);
  const tracked = held
    .filter((p) => p.result != null)
    .map((p) => ({ p, so: p.result!, share: p.result! / Math.max(p.line, 0.5) }))
    .sort((a, b) => b.share - a.share || a.p.name.localeCompare(b.p.name));
  return {
    kind: 'table',
    key: 'props-tracker',
    title: 'Props tracker',
    scope: held.length ? `${tracked.length} of ${held.length} markets have played` : undefined,
    info: 'The main line at the start against the box score so far. An over is marked once the number passes the line; an under cannot be settled until the game ends.',
    labelHeader: 'Player',
    fixedOrder: true,
    emptyText: held.length ? 'No player with a prop has appeared yet' : 'No player props held for this game',
    columns: [
      { key: 'market', label: 'Market', decimals: 0, text: true },
      { key: 'line', label: 'Line', decimals: 1 },
      { key: 'so', label: 'So far', decimals: 0 },
      { key: 'status', label: 'Status', decimals: 0, text: true },
    ],
    rows: tracked.map(({ p, so }) => {
      const over = liveLineHit('O', so, p.line);
      const row: ResearchTableRow = {
        key: p.key,
        label: p.name,
        labelNote: p.sideAbbr,
        href: p.href,
        imageUrl: p.imageUrl ?? null,
        imageKind: 'player',
        values: { market: p.marketLabel, line: p.line, so, status: over ? 'Over already' : `${Math.floor(p.line - so) + 1} more to go over` },
      };
      if (over) row.tones = { status: 'good' };
      return row;
    }),
  };
}

type Quote = { point: number | null; americanOdds: number | null };

/**
 * Lines now and the home moneyline trend (`readInGameLines`). `close` is each
 * market's line at the start; `scoredSince` says how much of the game has
 * happened since the latest capture, which lands about every fifteen minutes.
 */
export function inGameOddsCards(input: {
  away: GameSide;
  home: GameSide;
  inGame: InGameLines;
  close: (market: string) => { sides: Array<{ side: string } & Quote> } | null;
  spreadLabel: string;
  startWord: string;
  scoredSince: (asOf: string) => { count: number; unit: string } | null;
}): [ResearchCard, ResearchCard] {
  const { away, home, inGame } = input;
  const quote = (market: string, s: Quote | undefined) => (s ? `${s.point != null ? `${market === 'spread' && s.point > 0 ? '+' : ''}${s.point} ` : ''}${am(s.americanOdds)}` : '—');
  const sideLabel = (market: string, side: string) =>
    market === 'moneyline' ? `Moneyline · ${(side === 'home' ? home : away).abbr}` : market === 'spread' ? `${input.spreadLabel} · ${(side === 'home' ? home : away).abbr}` : `Total · ${side}`;
  const rows = inGame.now.flatMap((n) =>
    (n.line?.sides ?? []).map((s) => ({
      key: `${n.market}-${s.side}`,
      label: sideLabel(n.market, s.side),
      values: { close: quote(n.market, input.close(n.market)?.sides.find((x) => x.side === s.side)), now: quote(n.market, s), books: n.line?.books ?? null, at: etTime(n.asOf) },
    })),
  );
  const asOf = inGame.now.map((n) => n.asOf).sort().pop();
  const since = asOf ? input.scoredSince(asOf) : null;
  const linesNow: ResearchCard = {
    kind: 'table',
    key: 'lines-now',
    title: 'Lines now',
    scope: asOf ? `latest capture ${etTime(asOf)} ET${since && since.count > 0 ? ` · ${since.count} ${since.unit}${since.count === 1 ? ' has' : 's have'} scored since` : ''}` : `since ${input.startWord}`,
    labelHeader: 'Market',
    fixedOrder: true,
    emptyText: `No prices captured since ${input.startWord}`,
    columns: [
      { key: 'close', label: 'At the start', decimals: 0 },
      { key: 'now', label: 'Now', decimals: 0 },
      { key: 'books', label: 'Books', decimals: 0 },
      { key: 'at', label: 'Captured', decimals: 0 },
    ],
    rows,
    caption: 'Each market from its latest capture only, however few books it holds: prices are captured about every fifteen minutes during a game, not play by play, and an older price from another book is not current.',
  };
  const ml = inGame.moneyline;
  const trend: ResearchCard =
    ml.length >= 2
      ? {
          kind: 'series',
          key: 'ml-trend',
          title: `${home.abbr} moneyline chance`,
          scope: `${ml.length} captures since ${input.startWord}`,
          values: ml.map((x) => Math.round(x.homePct * 10) / 10),
          xLabels: ml.map((x, i) => (i === 0 || i === ml.length - 1 ? etTime(x.t) : '')),
          reference: { value: 50, label: 'even' },
          zeroBased: true,
          min: 0,
          max: 100,
          decimals: 0,
          unit: '%',
          tips: ml.map((x) => [`${home.abbr} ${x.homePct.toFixed(1)}%`, `${etTime(x.t)} ET · ${x.books === 1 ? 'one book' : `${x.books} books, median`}, vig removed`]),
          caption: 'Each book’s two moneyline prices with the vig taken out, then the median across books.',
        }
      : {
          kind: 'status',
          key: 'ml-trend',
          title: `${home.abbr} moneyline chance`,
          headline: ml.length ? 'One capture so far' : 'No captures yet',
          reason: 'Prices are captured about every fifteen minutes; the trend draws from the second capture.',
        };
  return [linesNow, trend];
}
