/**
 * Tennis's compare cards — R10.4d.
 *
 * TENNIS HAS NO TEAMS, so its compare is the player-against-player one the
 * other sports get as a second card, and it is built from a different source:
 * `team_game_production` covers seven sports and tennis is not one of them
 * (R10 Step 0). What tennis does have is the TennisMyLife archive the player
 * page already loads, which carries real serve and return numbers — the thing a
 * tennis reader actually compares.
 *
 * TWO CARDS:
 *   serve and return, both players side by side, each rate over its own
 *   denominator (first-serve points won is of first serves in, not of all
 *   points);
 *   head to head, from the subject's own matches against that opponent — the
 *   archive names an opponent, so the meeting list is a filter, not a join.
 *
 * A RATE OVER A MISSING DENOMINATOR IS LEFT OUT, not printed as zero: the
 * archive's older rows carry a result with no serve detail at all.
 *
 * Pure: no fetching, no database.
 */

import type { ResearchCard } from '@/lib/sports/shared/playerResearchShapes';
import type { TennisArchiveMatch } from '@/lib/sports/tennis/playerArchiveShapes';

const sum = (xs: Array<number | null | undefined>) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const rate = (n: number, d: number) => (d ? (100 * n) / d : null);

export interface TennisServeProfile {
  matches: number;
  acesPerMatch: number | null;
  firstInPct: number | null;
  firstWonPct: number | null;
  secondWonPct: number | null;
  returnWonPct: number | null;
}

/** One player's serve and return over the matches given. */
export function tennisServeProfile(matches: TennisArchiveMatch[]): TennisServeProfile {
  const withServe = matches.filter((m) => m.serve);
  const points = sum(withServe.map((m) => m.serve?.points));
  const firstIn = sum(withServe.map((m) => m.serve?.firstIn));
  const firstWon = sum(withServe.map((m) => m.serve?.firstWon));
  const secondWon = sum(withServe.map((m) => m.serve?.secondWon));
  const withReturn = matches.filter((m) => m.opponentServe);
  const retPoints = sum(withReturn.map((m) => m.opponentServe?.points));
  const retWon = sum(withReturn.map((m) => (m.opponentServe?.firstWon ?? 0) + (m.opponentServe?.secondWon ?? 0)));
  const aces = matches.filter((m) => m.aces != null);
  return {
    matches: matches.length,
    acesPerMatch: aces.length ? sum(aces.map((m) => m.aces)) / aces.length : null,
    firstInPct: rate(firstIn, points),
    firstWonPct: rate(firstWon, firstIn),
    // Second-serve points are the first serves that missed.
    secondWonPct: rate(secondWon, points - firstIn),
    // The opponent's serve is this player's return, so what the SERVER won has
    // to be turned around to read as a return number.
    returnWonPct: retPoints ? rate(retPoints - retWon, retPoints) : null,
  };
}

export function tennisCompareCards(input: {
  subjectName: string;
  subjectMatches: TennisArchiveMatch[];
  peerName: string | null;
  peerMatches: TennisArchiveMatch[] | null;
}): ResearchCard[] {
  if (!input.peerName || !input.peerMatches?.length || !input.subjectMatches.length) return [];
  const mine = tennisServeProfile(input.subjectMatches);
  const theirs = tennisServeProfile(input.peerMatches);

  const rows: Array<{ key: string; label: string; a: number | null; b: number | null; decimals: number; percent?: boolean }> = [
    { key: 'aces', label: 'Aces / match', a: mine.acesPerMatch, b: theirs.acesPerMatch, decimals: 1 },
    { key: 'firstIn', label: '1st serve in %', a: mine.firstInPct, b: theirs.firstInPct, decimals: 1, percent: true },
    { key: 'firstWon', label: '1st serve won %', a: mine.firstWonPct, b: theirs.firstWonPct, decimals: 1, percent: true },
    { key: 'secondWon', label: '2nd serve won %', a: mine.secondWonPct, b: theirs.secondWonPct, decimals: 1, percent: true },
    { key: 'return', label: 'Return points won %', a: mine.returnWonPct, b: theirs.returnWonPct, decimals: 1, percent: true },
  ].filter((r) => r.a != null || r.b != null);

  const cards: ResearchCard[] = [];
  if (rows.length) {
    cards.push({
      kind: 'dumbbell',
      key: 'tennis-serve-vs',
      title: `${input.subjectName} vs ${input.peerName}`,
      scope: `serve and return · ${mine.matches} and ${theirs.matches} matches held`,
      aLabel: input.subjectName,
      bLabel: input.peerName,
      rows: rows.map((r) => ({
        key: r.key,
        label: r.label,
        a: r.a,
        b: r.b,
        aSample: mine.matches,
        bSample: theirs.matches,
        decimals: r.decimals,
      })),
      caption: 'Each rate is over its own denominator: first-serve points won is of first serves in, not of every point.',
    });
  }

  // The archive names an opponent, so the meetings are this player's own rows.
  const meetings = input.subjectMatches
    .filter((m) => m.opponent.toLowerCase() === input.peerName!.toLowerCase())
    .sort((a, b) => b.date.localeCompare(a.date));
  if (meetings.length) {
    const won = meetings.filter((m) => m.isWinner).length;
    cards.push({
      kind: 'table',
      key: 'tennis-h2h',
      title: 'Head to head',
      scope: `${won}-${meetings.length - won} in the seasons held`,
      labelHeader: 'Date',
      fixedOrder: true,
      columns: [
        { key: 'event', label: 'Event', decimals: 0, text: true },
        { key: 'surface', label: 'Surface', decimals: 0 },
        { key: 'round', label: 'Round', decimals: 0 },
        { key: 'result', label: 'Result', decimals: 0 },
      ],
      rows: meetings.map((m, i) => ({
        key: `${m.date}-${i}`,
        // `date` is a full ISO timestamp (`toIsoDate`), so take the day and pin it to noon UTC.
        label: new Date(`${m.date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
        values: { event: m.tournamentName, surface: m.surface, round: m.round ?? '—', result: m.isWinner ? 'Won' : 'Lost' },
        tones: { result: m.isWinner ? ('good' as const) : ('bad' as const) },
      })),
      caption: 'From this player’s own archive rows, which name the opponent; the tournament date is the event’s, not the match’s.',
    });
  }
  return cards;
}
