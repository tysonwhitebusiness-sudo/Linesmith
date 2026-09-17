/**
 * NBA's own compare card — R10.4: where this player shoots, against what the
 * chosen opponent gives up to players in his position group.
 *
 * BOTH SIDES ALREADY EXIST, which is the point. The player's attempts come from
 * `/api/nba/shots`, which the page fetches for its shot chart (R6.5); the
 * opponent's allowed zones come from `team_shot_profile.allowedPos`, which R5c
 * writes and `/api/team-shot-profile`'s own header says is for this card. So the
 * compare is a join, not a new source.
 *
 * THE TWO SIDES ARE KEYED DIFFERENTLY and that is the whole trap: the rollup's
 * zones are G2's display names ("Restricted area"), while the page's shot
 * helper returns short keys ('restricted'). They are matched by label here, and
 * a zone the rollup does not carry is left out rather than shown as zero.
 *
 * Pure: no fetching, no database.
 */

import type { ResearchCard } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamShotSide } from '@/lib/sports/shared/teamProductionShapes';
import { shotZone, type NbaShot, type NbaZone } from '@/lib/sports/nba/playerShotShapes';

/** The rollup's own zone names, in the order a chart is read. */
const ZONES: Array<{ key: NbaZone; label: string }> = [
  { key: 'restricted', label: 'Restricted area' },
  { key: 'paint', label: 'Paint (non-RA)' },
  { key: 'mid', label: 'Mid-range' },
  { key: 'corner3', label: 'Corner 3' },
  // MEASURED, not assumed: the rollup writes 'Above-break 3' (the player page's
  // own card calls the same zone 'Above the break 3').
  { key: 'break3', label: 'Above-break 3' },
];

const pct = (made: number, att: number) => (att ? (100 * made) / att : null);

export function nbaZoneCompareCard(input: {
  shots: NbaShot[];
  allowed: TeamShotSide | null;
  teamAbbr: string;
  groupLabel: string;
}): ResearchCard | null {
  const located = input.shots.filter((s) => s.x != null && s.y != null);
  const zones = input.allowed?.zones;
  if (!located.length || !zones) return null;

  const mineTotal = located.length;
  const theirTotal = Object.values(zones).reduce((a, c) => a + (c[0] ?? 0), 0);
  const rows = ZONES.map(({ key, label }) => {
    const mine = located.filter((s) => shotZone(s) === key);
    const cell = zones[label];
    if (!mine.length && !cell) return null;
    const made = mine.filter((s) => s.made).length;
    return {
      key,
      label,
      values: {
        mineShare: mineTotal ? (100 * mine.length) / mineTotal : null,
        mineFg: pct(made, mine.length),
        theirShare: cell && theirTotal ? (100 * (cell[0] ?? 0)) / theirTotal : null,
        theirFg: cell ? pct(cell[1] ?? 0, cell[0] ?? 0) : null,
      },
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);
  if (!rows.length) return null;

  return {
    kind: 'table',
    key: 'nba-zones-vs',
    title: `Where he shoots, against what ${input.teamAbbr} allow`,
    scope: `${mineTotal} located attempts · ${input.teamAbbr} to ${input.groupLabel}`,
    info: 'His share and accuracy by zone beside what this team gives up to players in his position group, from every located attempt against them.',
    labelHeader: 'Zone',
    fixedOrder: true,
    columns: [
      { key: 'mineShare', label: 'His share', decimals: 0, format: 'percent', bar: true },
      { key: 'mineFg', label: 'His FG%', decimals: 1, format: 'percent' },
      { key: 'theirShare', label: `${input.teamAbbr} allow share`, decimals: 0, format: 'percent', bar: true },
      { key: 'theirFg', label: `${input.teamAbbr} allow FG%`, decimals: 1, format: 'percent' },
    ],
    rows,
    caption: 'Share is of that side’s own attempts, so the two share columns each add to 100%.',
  };
}
