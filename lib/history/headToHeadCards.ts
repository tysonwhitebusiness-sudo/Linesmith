/**
 * Deep head to head — R12c. Pure: the game page's "Head to head" card gains
 * every earlier meeting `game_result` holds, and team Compare gets the same
 * all-time record, both drawn by the shared table card.
 *
 * NO GAME IS COUNTED TWICE. The game page's own card lists meetings this season
 * and last, from the league's schedule (R7-C1, every sport's pregame read). The
 * history adds only meetings BEFORE the start of last season — the seam — so
 * the two never overlap, and a lagging `game_result` (the current season) is
 * never read at all.
 *
 * The history is refereed (R12a): the Eagles against Dallas reads 29-26 in
 * both `game_result` and nflverse since 1999.
 */

import { seasonDateRange, seasonForDate } from '@/lib/sports/shared/season';
import type { ResearchCard, ResearchSection, ResearchTableRow } from '@/lib/sports/shared/playerResearchShapes';
import type { HeadToHead, Meeting, WinLoss } from './teamHistoryShapes';

interface Side {
  id: string;
  abbr: string;
  logoUrl: string | null;
}

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const rec = (r: WinLoss) => `${r.w}-${r.l}${r.d ? `-${r.d}` : ''}`;
const add = (a: WinLoss, b: WinLoss): WinLoss => ({ w: a.w + b.w, l: a.l + b.l, d: a.d + b.d });

/** The first day of last season, for a game starting at `start`: where the page's own head-to-head list begins. */
export function headToHeadSeam(sport: string, start: string): string {
  return seasonDateRange(sport, seasonForDate(sport, new Date(start)) - 1).from;
}

/** A's record in these meetings, overall and split by where they were played. */
function tally(meetings: Meeting[]): { all: WinLoss; home: WinLoss; away: WinLoss } {
  const t = { all: { w: 0, l: 0, d: 0 }, home: { w: 0, l: 0, d: 0 }, away: { w: 0, l: 0, d: 0 } };
  for (const m of meetings) {
    const k = m.aScore > m.bScore ? 'w' : m.aScore < m.bScore ? 'l' : 'd';
    t.all[k]++;
    t[m.home === 'a' ? 'home' : 'away'][k]++;
  }
  return t;
}

function meetingRow(m: Meeting, a: Side, b: Side): ResearchTableRow {
  const aWon = m.aScore > m.bScore;
  const bWon = m.aScore < m.bScore;
  return {
    key: `h-${m.date}-${m.aScore}-${m.bScore}`,
    label: shortDate(m.date),
    labelNote: m.playoff ? 'postseason' : null,
    imageUrl: aWon ? a.logoUrl : bWon ? b.logoUrl : null,
    values: { park: m.home === 'a' ? a.abbr : b.abbr, score: `${m.aScore}–${m.bScore}`, won: aWon ? a.abbr : bWon ? b.abbr : 'Tie' },
  };
}

/**
 * The game page's head-to-head card with the deeper history behind a switch.
 * `recent` is the card the sport's own read built (this season and last, from
 * the away team's side); the history must be from the away team's side too.
 */
export function deepHeadToHeadCard(input: { recent: ResearchCard; history: HeadToHead; away: Side; home: Side; seam: string }): ResearchCard {
  const { recent, history, away, home, seam } = input;
  if (recent.kind !== 'table') return recent;
  const older = history.meetings.filter((m) => m.date < seam);
  if (!older.length) return recent;
  const oldRows = older.map((m) => meetingRow(m, away, home));
  const allRows = [...recent.rows, ...oldRows];

  // The recent card's own rows carry the recent record; count them from their "Won" cells.
  const recentTally: WinLoss = { w: 0, l: 0, d: 0 };
  for (const r of recent.rows) {
    const won = r.values.won;
    if (won === away.abbr) recentTally.w++;
    else if (won === home.abbr) recentTally.l++;
    else if (won === 'Tie') recentTally.d++;
  }
  const deep = tally(older);
  const total = add(deep.all, recentTally);
  const first = older[older.length - 1].date.slice(0, 4);
  const scope = `${away.abbr} ${rec(total)} against ${home.abbr} since ${first} · ${rec(deep.home)} at home before last season${recent.rows.length ? ` · ${rec(recentTally)} since` : ''}`;

  return {
    ...recent,
    scope,
    rows: recent.rows.length ? recent.rows : allRows,
    views: [
      ...(recent.rows.length ? [{ key: 'recent', label: 'Since last season', labelHeader: recent.labelHeader, columns: recent.columns, rows: recent.rows }] : []),
      { key: 'all', label: `All ${allRows.length} meetings`, labelHeader: recent.labelHeader, columns: recent.columns, rows: allRows },
    ],
    caption: `${recent.caption ?? ''} Meetings before last season come from the results archive (${first} onward) and are not linked.`.trim(),
  };
}

/**
 * Swap the head-to-head card for the deep one; every other card untouched.
 * Found by its key, `h2h` (only the shared `matchupSection` builds it), not by
 * section: once a game has started the section is re-keyed `pre-matchup`
 * ("Matchup · at the start"), and matching on `matchup` missed every final.
 */
export function withDeepHeadToHead(sections: ResearchSection[], input: { history: HeadToHead; away: Side; home: Side; seam: string }): ResearchSection[] {
  return sections.map((sec) =>
    sec.rows.some((row) => row.some((card) => card.key === 'h2h'))
      ? { ...sec, rows: sec.rows.map((row) => row.map((card) => (card.key === 'h2h' ? deepHeadToHeadCard({ recent: card, ...input }) : card))) }
      : sec,
  );
}

/** Team Compare's all-time head to head (R10.3): every meeting held, from this team's side. */
export function compareHeadToHeadCard(input: { history: HeadToHead; team: Side; other: Side }): ResearchCard {
  const { history, team, other } = input;
  const t = tally(history.meetings);
  const scope = history.meetings.length
    ? `${team.abbr} ${rec(t.all)} against ${other.abbr} since ${history.meetings[history.meetings.length - 1].date.slice(0, 4)} · ${rec(t.home)} at home, ${rec(t.away)} away${history.playoffs.w + history.playoffs.l + history.playoffs.d ? ` · postseason ${rec(history.playoffs)}` : ''}`
    : 'no meetings in the results held';
  const columns = [
    { key: 'park', label: 'At', decimals: 0 },
    { key: 'score', label: `${team.abbr}–${other.abbr}`, decimals: 0 },
    { key: 'won', label: 'Won', decimals: 0 },
  ];
  return {
    kind: 'table',
    key: 'compare-h2h',
    title: 'Head to head, all time',
    scope,
    labelHeader: 'Date',
    fixedOrder: true,
    emptyText: `${team.abbr} and ${other.abbr} have no meetings in the results held`,
    columns,
    rows: history.meetings.slice(0, 10).map((m) => meetingRow(m, team, other)),
    ...(history.meetings.length > 10
      ? {
          views: [
            { key: 'recent', label: 'Last 10', labelHeader: 'Date', columns, rows: history.meetings.slice(0, 10).map((m) => meetingRow(m, team, other)) },
            { key: 'all', label: `All ${history.meetings.length}`, labelHeader: 'Date', columns, rows: history.meetings.map((m) => meetingRow(m, team, other)) },
          ],
        }
      : {}),
    caption: 'Regular season and postseason, newest first, from the results archive; the current season may lag by a game or two.',
  };
}
