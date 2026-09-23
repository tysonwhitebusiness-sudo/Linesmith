/**
 * Research flags (F0) — the Python spotlights, read once and shown in several
 * places.
 *
 * PYTHON WRITES, TYPESCRIPT RENDERS. A spotlight is a row in `slate_rankings`
 * with `kind = 'spotlight'`, written by `slate_rankings.py` beside the
 * Specials and through the same freeze: what is unusual about a player, a team
 * or a game on today's slate. Nothing here computes one.
 *
 * WHY ONE READ RATHER THAN A CARD PER PAGE. The Slate, the player page, the
 * team page and the game page all show the same rows, so a player cannot be
 * "back in the lineup" on the Slate and not on their own page. Every surface
 * reads this file through `/api/slate/flags`, and the page only chooses how
 * much of a flag to draw: a chip, a note, or the whole card.
 *
 * A FLAG IS NOT A PICK. It is a rank within today's pool on factors that are
 * named and sourced, never compared to a price and never a probability. The
 * words are the same ones the Python job declares (`SPECIAL_RANKINGS`), so a
 * column cannot say something nobody measured.
 *
 * A SUBJECT IS NOT ALWAYS A PLAYER. `mlb-hr-parks` ranks GAMES — its
 * `subject_id` is the game id and its name is "AZ @ COL" — so `subjectKind`
 * says which, and a page that only wants people can filter on it.
 *
 * THIS FILE HOLDS NO QUERY. The read lives in `flagsRead.ts`, because the
 * Slate and the research pages import these shapes into the BROWSER and
 * `pgClient` pulls `pg` in with it — the same split `specialsFormat.ts`
 * already keeps for the Specials' display half.
 */

import type { SpecialFactorDef } from './specials';

export interface FlagFactor extends SpecialFactorDef {
  /** The measured value. Absent (null) where the job could not measure it. */
  value: number | null;
  /** Its percentile within today's pool, 0-100. */
  percentile: number | null;
}

export interface ResearchFlag {
  rankingId: string;
  /** The ranking's title, from the shared registry ("Platoon spots"). */
  title: string;
  /** What the ranking is a ranking of, in the reader's words. */
  promo: string;
  rank: number;
  /** How many subjects the ranking holds today, so "3rd" has an "of". */
  of: number;
  subjectId: string;
  subjectName: string;
  /** 'game' where the ranked subject IS the game (MLB's HR parks). */
  subjectKind: 'player' | 'game';
  team: string | null;
  teamId: string | null;
  opponent: string | null;
  opponentId: string | null;
  gameId: string | null;
  /** The one-line why, written by Python from the strongest factors. */
  read: string | null;
  factors: FlagFactor[];
  score: number;
  /** True once the job has frozen the slate at its first game. */
  frozen: boolean;
}

export interface FlagsData {
  sport: string;
  date: string;
  flags: ResearchFlag[];
  fetchedAt: string;
}

/** Who a set of flags was asked for. Exactly one, or none for the whole slate. */
export interface FlagSubject {
  subject?: string | null;
  team?: string | null;
  game?: string | null;
}

/**
 * `slate_rankings.sport` is granular for soccer and generic for everyone else,
 * and the research pages hold the granular string either way ('soccer_epl',
 * 'tennis_atp'). This maps whatever a page holds onto the job's key.
 */
export function flagScope(sport: string, league?: string | null): string {
  if (sport.startsWith('soccer')) return sport.includes('_') ? sport : `soccer_${league ?? 'epl'}`;
  // TENNIS IS GRANULAR TOO, and the first version of this said it was not.
  // `rankingSport()` only makes soccer granular, so this followed it — but
  // that function describes the SPECIALS, and tennis has none. SP-TEN's
  // spotlights are written per tour (`tennis_atp`, `tennis_wta`), so folding
  // them to 'tennis' asked for a sport nothing had ever written and every
  // tennis page showed no flags. Found by opening the page; `tsc` cannot see
  // a string that matches no row.
  if (sport.startsWith('tennis')) return sport.includes('_') ? sport : `tennis_${league ?? 'atp'}`;
  return sport;
}

/**
 * The rows that belong to one page.
 *
 * A TEAM'S FLAGS INCLUDE ITS GAME'S. `mlb-hr-parks` ranks the game, and the
 * job writes both sides' team ids onto it, so a team page asking for its own
 * id gets the park flag for the game it is playing today — which is the whole
 * point of showing it on a team page at all.
 */
export function selectFlags(flags: ResearchFlag[], who: FlagSubject): ResearchFlag[] {
  const { subject, team, game } = who;
  if (subject) return flags.filter((f) => f.subjectId === subject);
  if (team) return flags.filter((f) => f.teamId === team || f.opponentId === team);
  if (game) return flags.filter((f) => f.gameId === game);
  return flags;
}

/** One card's worth: every row of one ranking, in rank order. */
export interface FlagGroup {
  rankingId: string;
  title: string;
  promo: string;
  frozen: boolean;
  flags: ResearchFlag[];
}

export function groupFlags(flags: ResearchFlag[]): FlagGroup[] {
  const by = new Map<string, FlagGroup>();
  for (const f of flags) {
    const g = by.get(f.rankingId) ?? { rankingId: f.rankingId, title: f.title, promo: f.promo, frozen: f.frozen, flags: [] };
    g.flags.push(f);
    by.set(f.rankingId, g);
  }
  return [...by.values()].map((g) => ({ ...g, flags: [...g.flags].sort((a, b) => a.rank - b.rank) }));
}
