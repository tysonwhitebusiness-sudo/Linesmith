/**
 * The NFL team page — R7.2. `toTeamResearchData` reads the football
 * `/api/team-research` payload through the shared `buildTeamResearch` and adds
 * NFL's own passing-game section (`nflPassingGameSection`, the target map).
 * CFB's team page reuses the same football reader.
 *
 * (This file was the old `TeamDetail.tsx` NFL adapter until R7 replaced that
 * page; its header described the deleted `/api/nfl/team/[teamId]` read until
 * R11a.)
 */

import type { FootballTeamResearchPayload } from '@/lib/sports/multiSport/footballTeamResearch';
import type { NflTeamTargets, TeamTargetSide } from '@/lib/sports/nfl/teamTargetShapes';
import { footballTeamSpec } from './teamResearchSpec';
import { buildTeamResearch } from '@/lib/sports/shared/teamResearch';
import type { ResearchCard, ResearchSection } from '@/lib/sports/shared/playerResearchShapes';
import type { TeamResearchData, TeamRosterEntry } from '@/lib/sports/shared/teamResearchShapes';
// ---------------------------------------------------------------------------
// R7.2 — the team research page
// ---------------------------------------------------------------------------

/**
 * NFL's team page: the shared team research read through the football spec,
 * plus NFL's own section, "Passing game" — who the targets go to and where the
 * offense throws and the defense is thrown at, against the league (R5d).
 */
export function toTeamResearchData(input: { payload: FootballTeamResearchPayload; season: number | null; now?: Date }): TeamResearchData {
  const data = buildTeamResearch({
    payload: input.payload,
    spec: footballTeamSpec('nfl'),
    season: input.season,
    teamHref: (id) => `/nfl/team/${encodeURIComponent(id)}`,
    now: input.now,
  });
  const season = data.scope.season;
  const roster = input.payload.seasons.find((s) => s.season === season)?.roster ?? [];
  return { ...data, sections: [...data.sections, nflPassingGameSection(input.payload.targets[String(season)] ?? null, roster, season)] };
}

const CELL_ROWS = ['deep', 'short'] as const;
const CELL_COLS = ['left', 'middle', 'right'] as const;
const pctFmt = (v: number) => `${v.toFixed(0)}%`;

function shareGrid(side: TeamTargetSide): { cells: Array<Array<{ key: string; value: number | null; sampleSize: number | null }>>; total: number } {
  const total = Object.values(side.cells).reduce((a, c) => a + c[0], 0);
  return {
    total,
    cells: CELL_ROWS.map((r) =>
      CELL_COLS.map((c) => {
        const cell = side.cells[`${r}|${c}`];
        return { key: `${r}|${c}`, value: cell && total ? (100 * cell[0]) / total : null, sampleSize: cell?.[0] ?? null };
      }),
    ),
  };
}

export function nflPassingGameSection(targets: NflTeamTargets | null, roster: TeamRosterEntry[], season: number): ResearchSection {
  const base = { id: 'passing', navLabel: 'Passing game', title: 'Passing game', sub: `${season} · targets and where the ball goes, nflverse play-by-play` };
  const receivers = roster.filter((e) => (e.stats['receiving.receivingTargets'] ?? 0) > 0);
  const teamTargets = receivers.reduce((a, e) => a + (e.stats['receiving.receivingTargets'] ?? 0), 0);
  if (!targets?.offense && !receivers.length) {
    return { ...base, rows: [], state: { kind: 'empty', title: `No passing data for ${season}`, reason: 'Neither the target rollup nor the game logs hold targets for this team and season yet.' } };
  }

  const share: ResearchCard = {
    kind: 'table',
    key: 'target-share',
    title: 'Target share',
    scope: `${teamTargets} targets from the box scores`,
    labelHeader: 'Receiver',
    sortKey: 'share',
    columns: [
      { key: 'tgt', label: 'Tgt', decimals: 0 },
      { key: 'share', label: 'Share', decimals: 1, format: 'percent' },
      { key: 'rec', label: 'Rec', decimals: 0 },
      { key: 'catch', label: 'Catch%', decimals: 1, format: 'percent' },
      { key: 'yds', label: 'Yds', decimals: 0 },
      { key: 'td', label: 'TD', decimals: 0 },
    ],
    rows: receivers.map((e) => {
      const tgt = e.stats['receiving.receivingTargets'] ?? 0;
      const rec = e.stats['receiving.receptions'] ?? 0;
      return {
        key: e.id,
        label: e.name,
        labelNote: e.position,
        imageUrl: e.headshotUrl,
        imageKind: 'player' as const,
        href: e.href,
        values: { tgt, share: teamTargets ? (100 * tgt) / teamTargets : null, rec, catch: tgt ? (100 * rec) / tgt : null, yds: e.stats['receiving.receivingYards'] ?? 0, td: e.stats['receiving.receivingTouchdowns'] ?? 0 },
      };
    }),
  };

  const sides: Array<{ key: 'offense' | 'defense' | 'league'; label: string; side: TeamTargetSide | null | undefined }> = [
    { key: 'offense', label: 'Where they throw', side: targets?.offense },
    { key: 'defense', label: 'Where they are thrown at', side: targets?.defense },
    { key: 'league', label: 'League', side: targets?.league },
  ];
  const views = sides
    .flatMap((v) => (v.side ? [{ key: v.key, label: v.label, side: v.side }] : []))
    .map(({ key, label, side }) => {
      const g = shareGrid(side);
      return {
        key,
        label,
        role: {
          title: label,
          surface: 'field' as const,
          measure: 'share' as const,
          cells: g.cells,
          rowLabels: ['Deep', 'Short'],
          columnLabels: ['left', 'middle', 'right'],
          domain: { lo: 0, hi: 40 },
          format: pctFmt,
          unit: '% of targets',
          caption: `${g.total.toLocaleString('en-US')} located targets${key === 'league' ? ', every team' : ` in ${side.games} games`} · deep is 15+ air yards`,
        },
      };
    });

  const rows: ResearchCard[][] = [];
  if (views.length) {
    const map: ResearchCard = { kind: 'surface', key: 'throw-map', title: 'Throw map', scope: 'share of targets by area', views };
    const lg = targets?.league ? shareGrid(targets.league) : null;
    const off = targets?.offense ? shareGrid(targets.offense) : null;
    const def = targets?.defense ? shareGrid(targets.defense) : null;
    const comp = (side: TeamTargetSide | null | undefined, key: string) => {
      const c = side?.cells[key];
      return c && c[0] ? (100 * c[1]) / c[0] : null;
    };
    const areas: ResearchCard = {
      kind: 'table',
      key: 'areas',
      title: 'By area, against the league',
      scope: 'share of targets and completion %',
      labelHeader: 'Area',
      fixedOrder: true,
      columns: [
        { key: 'off', label: 'Off share', decimals: 1, format: 'percent' },
        { key: 'lg', label: 'League', decimals: 1, format: 'percent' },
        { key: 'offCmp', label: 'Off cmp%', decimals: 1, format: 'percent' },
        { key: 'lgCmp', label: 'Lg cmp%', decimals: 1, format: 'percent' },
        { key: 'def', label: 'Def share', decimals: 1, format: 'percent' },
        { key: 'defCmp', label: 'Def cmp%', decimals: 1, format: 'percent', info: 'Completion % allowed' },
      ],
      rows: CELL_ROWS.flatMap((r, ri) =>
        CELL_COLS.map((c, ci) => {
          const key = `${r}|${c}`;
          return {
            key,
            label: `${r === 'deep' ? 'Deep' : 'Short'} ${c}`,
            values: {
              off: off?.cells[ri][ci].value ?? null,
              lg: lg?.cells[ri][ci].value ?? null,
              offCmp: comp(targets?.offense, key),
              lgCmp: comp(targets?.league, key),
              def: def?.cells[ri][ci].value ?? null,
              defCmp: comp(targets?.defense, key),
            },
          };
        }),
      ),
      caption: 'Interceptions are not held: nflverse’s interception flag is false on every stored target (R6-F11).',
    };
    rows.push([map, areas]);
  } else {
    rows.push([{ kind: 'status', key: 'throw-map', title: 'Throw map', headline: `No target rollup for ${season}`, reason: 'team_target_profile holds no row for this team and season yet.' }]);
  }
  if (receivers.length) rows.push([share]);
  return { ...base, rows, state: { kind: 'ready' } };
}
