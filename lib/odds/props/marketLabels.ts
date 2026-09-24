import type { Sport } from '@/lib/core/types';
import { CANONICAL_MARKET_KEYS } from './entityResolution';

/**
 * One market-label registry (P1, odds workstream, 2026-09-24).
 *
 * Every sport's game-research adapter used to keep its own label map and fall
 * back to the raw key (`FOOTBALL_MARKET_LABELS[p.market] ?? p.market`), so a
 * canonical key the map lacked (`longest-rush`, `kicking-points`) reached the
 * game page as a slug. Every label now comes from here.
 *
 * Lookup: the sport's override, then the canonical label, then a legacy key,
 * then (for a key outside the canonical set only) the key sentence-cased from
 * its hyphens, with a dev-only warning. `tests/market-labels.test.ts` keeps
 * every canonical key out of that last step.
 */

/** The 72 canonical keys (`CANONICAL_MARKET_KEYS`), sentence case. */
export const MARKET_LABELS: Readonly<Record<string, string>> = {
  aces: 'Aces',
  'anytime-goalscorer': 'Anytime goalscorer',
  'anytime-td': 'Anytime TD',
  assists: 'Assists',
  'batter-strikeouts': 'Batter strikeouts',
  'blocked-shots': 'Blocked shots',
  blocks: 'Blocks',
  'crosses-attempted': 'Crosses attempted',
  doubles: 'Doubles',
  'dribbles-attempted': 'Dribbles attempted',
  'earned-runs': 'Earned runs',
  'field-goals-made': 'Field goals made',
  'first-goalscorer': 'First goalscorer',
  'first-home-run': 'First home run',
  'first-td-scorer': 'First TD scorer',
  'games-won': 'Games won',
  goals: 'Goals',
  'goals-against': 'Goals against',
  'goals-assists': 'Goals + assists',
  hits: 'Hits',
  'hits-runs-rbis': 'Hits + runs + RBIs',
  'home-runs': 'Home runs',
  'interceptions-thrown': 'Interceptions thrown',
  'kicking-points': 'Kicking points',
  'last-goalscorer': 'Last goalscorer',
  'longest-completion': 'Longest completion',
  'longest-reception': 'Longest reception',
  'longest-rush': 'Longest rush',
  'pass-attempts': 'Pass attempts',
  'passes-attempted': 'Passes attempted',
  'passing-completions': 'Completions',
  'passing-tds': 'Passing TDs',
  'passing-yards': 'Passing yards',
  'pitcher-hits-allowed': 'Hits allowed',
  'pitcher-outs': 'Outs recorded',
  'pitcher-strikeouts': 'Strikeouts',
  'pitcher-walks-allowed': 'Walks allowed',
  'pitcher-win': 'Pitcher win',
  points: 'Points',
  'points-assists': 'Points + assists',
  'points-rebounds': 'Points + rebounds',
  'points-rebounds-assists': 'Points + rebounds + assists',
  rbis: 'RBIs',
  rebounds: 'Rebounds',
  'rebounds-assists': 'Rebounds + assists',
  'receiving-tds': 'Receiving TDs',
  'receiving-yards': 'Receiving yards',
  receptions: 'Receptions',
  runs: 'Runs',
  'runs-rbis': 'Runs + RBIs',
  'rush-rec-tds': 'Rush + rec TDs',
  'rush-rec-yards': 'Rush + rec yards',
  'rushing-attempts': 'Rushing attempts',
  'rushing-tds': 'Rushing TDs',
  'rushing-yards': 'Rushing yards',
  sacks: 'Sacks',
  saves: 'Saves',
  shots: 'Shots',
  'shots-on-goal': 'Shots on goal',
  'shots-on-target': 'Shots on target',
  singles: 'Singles',
  steals: 'Steals',
  'stolen-bases': 'Stolen bases',
  tackles: 'Tackles',
  'three-pointers-made': 'Threes made',
  'to-win-a-set': 'To win a set',
  'total-bases': 'Total bases',
  triples: 'Triples',
  turnovers: 'Turnovers',
  'two-plus-goals': '2+ goals',
  walks: 'Walks',
  'yellow-cards': 'Yellow cards',
};

/** Candidate dimensions and older adapter keys; kept so no current label changes. */
const LEGACY_LABELS: Readonly<Record<string, string>> = {
  completions: 'Completions',
  'passing-attempts': 'Pass attempts',
  interceptions: 'Interceptions thrown',
  'pass-rush-yards': 'Pass + rush yards',
};

/**
 * Where the same key reads differently in one sport. Each entry is the wording
 * that sport's own game-research map used before this registry (diffed
 * 2026-09-24), so no visible label changed; only the fills are new.
 */
const FOOTBALL: Record<string, string> = { assists: 'Tackle assists' };
export const SPORT_MARKET_LABELS: Readonly<Partial<Record<Sport, Record<string, string>>>> = {
  nfl: FOOTBALL,
  cfb: FOOTBALL,
  mlb: {
    'batter-strikeouts': 'Strikeouts (batter)',
    'pitcher-strikeouts': 'Strikeouts (pitcher)',
    'pitcher-walks': 'Walks allowed',
  },
  nba: {
    threes: 'Threes made',
    'three-pointers': 'Threes made',
    'points-rebounds-assists': 'Pts + reb + ast',
    'points-rebounds': 'Pts + reb',
    'points-assists': 'Pts + ast',
    'rebounds-assists': 'Reb + ast',
    'steals-blocks': 'Steals + blocks',
  },
  nhl: { 'anytime-goalscorer': 'Anytime scorer' },
  soccer: { 'anytime-goalscorer': 'Anytime scorer', 'first-goalscorer': 'First scorer' },
};

const warned = new Set<string>();

export function marketLabel(key: string, sport?: Sport | string | null): string {
  const bySport = sport ? SPORT_MARKET_LABELS[sport as Sport]?.[key] : undefined;
  if (bySport) return bySport;
  const label = MARKET_LABELS[key] ?? LEGACY_LABELS[key];
  if (label) return label;
  if (process.env.NODE_ENV !== 'production' && !CANONICAL_MARKET_KEYS.has(key) && !warned.has(key)) {
    warned.add(key);
    console.warn(`marketLabel: no label for market key "${key}"${sport ? ` (${sport})` : ''}; sentence-casing it`);
  }
  const words = key.replace(/-/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

/**
 * The same label in Title Case, for a candidate's `dimensionLabel`: every
 * sport's candidates are Title Case on Scan and the prop block ("Passing
 * Yards", "Pitcher Strikeouts"), and the NFL/CFB candidate maps this replaced
 * were too. Upper-cases each word's first letter and leaves the rest ("TDs",
 * "RBIs") alone.
 */
export function marketLabelTitle(key: string, sport?: Sport | string | null): string {
  return marketLabel(key, sport).replace(/(^|[\s(])([a-z])/g, (_m, pre: string, c: string) => pre + c.toUpperCase());
}
