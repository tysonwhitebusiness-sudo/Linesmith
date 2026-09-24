/**
 * One book registry (P1, odds workstream, 2026-09-24): key, display name,
 * group (D18) and logo domain, for every book the app or the scraper can name.
 *
 * `components/BookLogo.tsx` knew 15 books and printed any other id raw, so
 * pages showed `bet365`, `fanatics` and, where a caller printed the fallback
 * label again beside it, `parx parx`. Every page now reads names from here.
 *
 * The 87 entries: the approved mockup's book map (`docs/design/odds-rebuild/
 * om-data.js` -> `OM.books`, built by the scraper's `canonical_book`), the 9
 * canonical books the mockup never met, and `williamhill_us` (the-odds-api's
 * raw key for Caesars, which the legacy game feed passes straight through).
 * Ids the app's alias maps do not know yet are scraper keys; P2 adds them to
 * the alias maps, and their rows exist here so P2 touches only those maps.
 * Table: `docs/design/odds-build/P1-fix-what-is-broken.md` §3.
 */

export type BookGroup = 'sharp' | 'exchange' | 'us' | 'nevada' | 'offshore' | 'intl' | 'pickem';

/** D18: the order book groups are shown in. */
export const BOOK_GROUP_ORDER: readonly BookGroup[] = ['sharp', 'exchange', 'us', 'nevada', 'offshore', 'intl', 'pickem'];

export interface BookEntry {
  label: string;
  group: BookGroup;
  /** The book's site, for the favicon; null draws a monogram tile. */
  domain: string | null;
}

export const BOOKS: Readonly<Record<string, BookEntry>> = {
  circa: { label: 'Circa', group: 'sharp', domain: 'circasports.com' },
  pinnacle: { label: 'Pinnacle', group: 'sharp', domain: 'pinnacle.com' },
  betfairexchange: { label: 'Betfair Exchange', group: 'exchange', domain: 'betfair.com' },
  kalshi: { label: 'Kalshi', group: 'exchange', domain: 'kalshi.com' },
  matchbook: { label: 'Matchbook', group: 'exchange', domain: 'matchbook.com' },
  novig: { label: 'Novig', group: 'exchange', domain: 'novig.us' },
  polymarket: { label: 'Polymarket', group: 'exchange', domain: 'polymarket.com' },
  polymarketus: { label: 'Polymarket US', group: 'exchange', domain: 'polymarket.com' },
  prophetx: { label: 'ProphetX', group: 'exchange', domain: 'prophetx.co' },
  smarkets: { label: 'Smarkets', group: 'exchange', domain: 'smarkets.com' },
  ballybet: { label: 'Bally Bet', group: 'us', domain: 'ballybet.com' },
  bet365: { label: 'bet365', group: 'us', domain: 'bet365.com' },
  betanything: { label: 'BetAnything', group: 'us', domain: 'betanything.com' },
  betmgm: { label: 'BetMGM', group: 'us', domain: 'betmgm.com' },
  betparx: { label: 'betPARX', group: 'us', domain: 'betparx.com' },
  betrivers: { label: 'BetRivers', group: 'us', domain: 'betrivers.com' },
  caesars: { label: 'Caesars', group: 'us', domain: 'caesars.com' },
  williamhill_us: { label: 'Caesars', group: 'us', domain: 'caesars.com' },
  courtside: { label: 'Courtside', group: 'us', domain: 'courtside.com' },
  draftkings: { label: 'DraftKings', group: 'us', domain: 'draftkings.com' },
  espnbet: { label: 'ESPN BET', group: 'us', domain: 'espnbet.com' },
  fanatics: { label: 'Fanatics', group: 'us', domain: 'sportsbook.fanatics.com' },
  fanduel: { label: 'FanDuel', group: 'us', domain: 'fanduel.com' },
  fliff: { label: 'Fliff', group: 'us', domain: 'getfliff.com' },
  hardrockbet: { label: 'Hard Rock Bet', group: 'us', domain: 'hardrock.bet' },
  parx: { label: 'Parx', group: 'us', domain: 'betparx.com' },
  rebet: { label: 'Rebet', group: 'us', domain: null },
  riverscasino: { label: 'Rivers', group: 'us', domain: 'riverscasino.com' },
  sugarhouse: { label: 'SugarHouse', group: 'us', domain: 'playsugarhouse.com' },
  thescore: { label: 'theScore Bet', group: 'us', domain: 'thescore.bet' },
  wynnbet: { label: 'WynnBET', group: 'us', domain: 'wynnbet.com' },
  betmgmnv: { label: 'BetMGM NV', group: 'nevada', domain: 'betmgm.com' },
  boomers: { label: 'Boomers', group: 'nevada', domain: 'boomerslv.com' },
  caesarsnv: { label: 'Caesars NV', group: 'nevada', domain: 'caesars.com' },
  southpoint: { label: 'South Point', group: 'nevada', domain: 'southpointcasino.com' },
  stations: { label: 'Station Casinos', group: 'nevada', domain: 'stationcasinos.com' },
  wynn: { label: 'Wynn', group: 'nevada', domain: 'wynnbet.com' },
  aceshigh: { label: 'Aces High', group: 'offshore', domain: 'aceshigh.ag' },
  bet105: { label: 'Bet105', group: 'offshore', domain: 'bet105.ag' },
  betanysports: { label: 'BetAnySports', group: 'offshore', domain: 'betanysports.eu' },
  betonline: { label: 'BetOnline', group: 'offshore', domain: 'betonline.ag' },
  betus: { label: 'BetUS', group: 'offshore', domain: 'betus.com.pa' },
  bodog: { label: 'Bodog', group: 'offshore', domain: 'bodog.eu' },
  bookmaker: { label: 'Bookmaker', group: 'offshore', domain: 'bookmaker.eu' },
  bovada: { label: 'Bovada', group: 'offshore', domain: 'bovada.lv' },
  everygame: { label: 'Everygame', group: 'offshore', domain: 'everygame.eu' },
  gtbets: { label: 'GTbets', group: 'offshore', domain: 'gtbets.ag' },
  heritage: { label: 'Heritage', group: 'offshore', domain: 'heritagesports.eu' },
  justbet: { label: 'JustBet', group: 'offshore', domain: 'justbet.cx' },
  lowvig: { label: 'LowVig', group: 'offshore', domain: 'lowvig.ag' },
  mybookie: { label: 'MyBookie', group: 'offshore', domain: 'mybookie.ag' },
  '10bet': { label: '10bet', group: 'intl', domain: '10bet.com' },
  onexbet: { label: '1xBet', group: 'intl', domain: '1xbet.com' },
  '888sport': { label: '888sport', group: 'intl', domain: '888sport.com' },
  betano: { label: 'Betano', group: 'intl', domain: 'betano.com' },
  betfairsportsbook: { label: 'Betfair Sportsbook', group: 'intl', domain: 'betfair.com' },
  betrsportsbook: { label: 'Betr (AU)', group: 'intl', domain: 'betr.com.au' },
  betsson: { label: 'Betsson', group: 'intl', domain: 'betsson.com' },
  betvictor: { label: 'BetVictor', group: 'intl', domain: 'betvictor.com' },
  betway: { label: 'Betway', group: 'intl', domain: 'betway.com' },
  boylesports: { label: 'BoyleSports', group: 'intl', domain: 'boylesports.com' },
  casumo: { label: 'Casumo', group: 'intl', domain: 'casumo.com' },
  coolbet: { label: 'Coolbet', group: 'intl', domain: 'coolbet.com' },
  coral: { label: 'Coral', group: 'intl', domain: 'coral.co.uk' },
  grosvenor: { label: 'Grosvenor', group: 'intl', domain: 'grosvenorcasinos.com' },
  ladbrokes: { label: 'Ladbrokes', group: 'intl', domain: 'ladbrokes.com.au' },
  leovegas: { label: 'LeoVegas', group: 'intl', domain: 'leovegas.com' },
  livescorebet: { label: 'LiveScore Bet', group: 'intl', domain: 'livescorebet.com' },
  marathonbet: { label: 'Marathonbet', group: 'intl', domain: 'marathonbet.com' },
  neds: { label: 'Neds', group: 'intl', domain: 'neds.com.au' },
  nordicbet: { label: 'NordicBet', group: 'intl', domain: 'nordicbet.com' },
  paddypower: { label: 'Paddy Power', group: 'intl', domain: 'paddypower.com' },
  playup: { label: 'PlayUp', group: 'intl', domain: 'playup.com.au' },
  pointsbet: { label: 'PointsBet', group: 'intl', domain: 'pointsbet.com.au' },
  sportsbet: { label: 'Sportsbet', group: 'intl', domain: 'sportsbet.com.au' },
  tab: { label: 'TAB', group: 'intl', domain: 'tab.com.au' },
  tabau: { label: 'TAB (AU)', group: 'intl', domain: 'tab.com.au' },
  tabtouch: { label: 'TABtouch', group: 'intl', domain: 'tabtouch.com.au' },
  tipico: { label: 'Tipico', group: 'intl', domain: 'tipico.com' },
  unibet: { label: 'Unibet', group: 'intl', domain: 'unibet.com' },
  virginbet: { label: 'Virgin Bet', group: 'intl', domain: 'virginbet.com' },
  williamhill: { label: 'William Hill', group: 'intl', domain: 'williamhill.com' },
  betr: { label: 'Betr', group: 'pickem', domain: 'betr.app' },
  pick6: { label: 'DraftKings Pick6', group: 'pickem', domain: 'pick6.draftkings.com' },
  prizepicks: { label: 'PrizePicks', group: 'pickem', domain: 'prizepicks.com' },
  sleeper: { label: 'Sleeper', group: 'pickem', domain: 'sleeper.com' },
  underdog: { label: 'Underdog', group: 'pickem', domain: 'underdogfantasy.com' },
};

const warned = new Set<string>();

export function bookEntry(id: string | null | undefined): BookEntry | null {
  return id ? BOOKS[id] ?? null : null;
}

/** The registry's display name. An unknown id prints as itself, with a dev-only warning naming it. */
export function bookLabel(id: string | null | undefined): string {
  if (!id) return '';
  const e = BOOKS[id];
  if (e) return e.label;
  if (process.env.NODE_ENV !== 'production' && !warned.has(id)) {
    warned.add(id);
    console.warn(`bookLabel: "${id}" is not in lib/odds/books/registry.ts`);
  }
  return id;
}

/**
 * No sportsbook publishes a stable public logo CDN, so this hotlinks each
 * book's real site favicon through Google's public favicon proxy.
 */
export function bookLogoUrl(id: string | null | undefined, px = 32): string | undefined {
  const domain = bookEntry(id)?.domain;
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=${px}` : undefined;
}

/** An unknown book sorts with the international books. */
export function bookGroup(id: string | null | undefined): BookGroup {
  return bookEntry(id)?.group ?? 'intl';
}
