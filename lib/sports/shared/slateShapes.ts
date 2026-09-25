/**
 * The Slate's shared shape (S1).
 *
 * `SlatePage` renders one `SlateData` and NEVER asks which sport it is — the
 * same rule the research pages follow (CLAUDE.md, sport-adapter architecture).
 * A sport with nothing for a section leaves it unset, and the section hides,
 * along with its entry in the nav.
 *
 * The Games section is the only one S1 fills. Movers, Spotlights, Specials,
 * Model and Your lines are declared here so the nav and the page can be built
 * once; S2 to S5 fill them.
 */

/** Where a game is. `pre` and `done` match the snapshot's own vocabulary. */
export type SlateStatus = 'pre' | 'live' | 'done';

export interface SlateTeam {
  /** Full name, as the card prints it. */
  name: string;
  /** Short form for a tight row ("NYY"). */
  abbr?: string;
  logoUrl?: string | null;
  /** "92-63", or a table position. Absent where the sport does not hold one. */
  record?: string | null;
  /** Live or final. A string, because cricket-style scores are not numbers. */
  score?: string | null;
  /** CFB only, and only where the poll holds them. */
  rank?: number | null;
  /** One line under the name: MLB's probable starter with his ERA and K. */
  note?: string | null;
  href?: string | null;
}

/** One market's three numbers, as the lines block prints them. */
export interface SlateMarket {
  /** The consensus: the MEDIAN across books, not one book's number. */
  consensus?: string | null;
  /** The best price on offer and who is offering it. */
  best?: { price: string; book: string } | null;
  /** How many distinct books are quoting this market. */
  books?: number | null;
  /** Which books are quoting this market, for the card footer's marks. */
  booksList?: string[];
}

export interface SlateLines {
  spread?: SlateMarket | null;
  total?: SlateMarket | null;
  moneyline?: SlateMarket | null;
  /** Soccer's third outcome. A real difference in the data, not a port artifact. */
  draw?: SlateMarket | null;
}

/**
 * The model row, where a sport has one that may show it.
 *
 * M1's display rule decides what may be filled in, not this type: a `gated`
 * model may show a probability beside a price, a `baseline` one may show the
 * pick and nothing else. The adapter reads the register and leaves `percent`
 * unset where the rule says it must.
 */
export interface SlateModelRow {
  /** "NYY", the side picked. */
  pick: string;
  /** Only where the register says `gated`. Absent is the honest default. */
  percent?: string | null;
  /** "4.9–4.1 runs". */
  detail?: string | null;
  /** What the number is, in plain words, for the tooltip. Never a tier name. */
  note?: string | null;
  /**
   * D9's ring: the rare pick that goes AGAINST the market favourite. One
   * boolean, so switching to ring-every-game is a one-line change (queue Q1).
   */
  againstFavourite?: boolean;
}

export interface SlateGameCard {
  id: string;
  status: SlateStatus;
  /** "7:05 PM", "Top 6th", "Final". Already formatted; the card just prints it. */
  statusText: string;
  /** ISO, for sorting. */
  startsAt?: string | null;
  venue?: string | null;
  away: SlateTeam;
  home: SlateTeam;
  lines?: SlateLines | null;
  model?: SlateModelRow | null;
  /** Park, weather, injuries — each already a finished phrase. */
  context?: string[];
  /**
   * N5 — the forecast, but only when it is worth naming: wind over 15 mph or
   * rain over 50%. A finished phrase, and unset for a roofed park, a sport
   * that holds no forecast, and every ordinary day. The Spotlights section
   * lists these; the card itself already prints the full forecast in
   * `context`.
   */
  weatherFlag?: string | null;
  /** The game page. */
  href?: string | null;
  /** How many props this slate holds for this game. Null where none are held. */
  propCount?: number | null;
}

export interface SlateGamesSection {
  cards: SlateGameCard[];
  counts: { all: number; pre: number; live: number; done: number };
  /** What the cards are, when they are not games: "matches", "golfers". */
  noun: string;
  /** Said above the grid when something is known to be missing. */
  note?: string | null;
}

export interface SlateData {
  sport: string;
  date: string;
  fetchedAt: string;
  games?: SlateGamesSection | null;
  /**
   * S5 — set by a sport whose picks the Slate lists in a Model section. Unset
   * means no section: the shell asks the data, never the sport.
   */
  modelPicks?: { note: string } | null;
  /** Anything the build could not do, in the reader's words. */
  warnings: string[];
}

/** One entry in the sticky section nav. A hidden section is not in this list. */
export interface SlateSection {
  id: string;
  label: string;
  count?: number;
}

/**
 * The nav, derived from the data rather than declared beside it — so a section
 * cannot be in the nav and missing from the page, or the reverse.
 *
 * `propCount` comes from the Props board, which is still client-side (its rows
 * are Scan's, unchanged), so it is passed in rather than read off `SlateData`.
 */
export function slateSections(
  data: SlateData | null,
  propCount: number | null,
  marketCount?: number | null,
  spotlightCount?: number | null,
  specialsCount?: number | null,
  modelCount?: number | null,
  yourLinesCount?: number | null,
  moversCount?: number | null,
): SlateSection[] {
  const out: SlateSection[] = [];
  if (data?.games && data.games.cards.length > 0) {
    out.push({ id: 'games', label: 'Games', count: data.games.counts.all });
  }
  // MV3: Movers sits right under the games it moved on (spec §3 order).
  if (moversCount != null && moversCount > 0) out.push({ id: 'movers', label: 'Movers', count: moversCount });
  // S2's two market-shape cards, and O4's Market hub (the odds hub: "Books → Market").
  if (marketCount != null && marketCount > 0) out.push({ id: 'market', label: 'Market', count: marketCount });
  if (spotlightCount != null && spotlightCount > 0) out.push({ id: 'spotlights', label: 'Spotlights', count: spotlightCount });
  if (specialsCount != null && specialsCount > 0) out.push({ id: 'specials', label: 'Specials', count: specialsCount });
  if (data?.modelPicks && modelCount != null && modelCount > 0) out.push({ id: 'model', label: 'Model', count: modelCount });
  if (yourLinesCount != null && yourLinesCount > 0) out.push({ id: 'your-lines', label: 'Your lines', count: yourLinesCount });
  if (propCount != null && propCount > 0) out.push({ id: 'props', label: 'Props', count: propCount });
  return out;
}
