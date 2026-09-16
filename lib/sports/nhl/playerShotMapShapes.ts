/**
 * NHL's own player-page sections, as data: "Shot map & official totals" for a
 * skater and "Shots faced & official totals" for a goalie (R6.5). Spec:
 * `docs/design/phase-g2/src/sports/hoops-hockey.js`. Database-free, so client
 * code may import it.
 *
 * ============ THE COORDINATE TRAP, AGAIN AND ON PURPOSE ====================
 *
 * `x_coord` runs -100..100 with the goals at ±89 and ITS SIGN IS WHICH END THE
 * SHOOTING TEAM WAS ATTACKING, not which side of the ice the shot came from.
 * Teams switch ends every period, so an unnormalised season folds into a blur
 * about the red line — measured in `shotProfileShapes.ts`, where mean x by
 * period ran -12, -10, +16, -3, -32 while mean |x| held at 53-70.
 *
 * Normalisation is a 180° ROTATION: switching ends mirrors BOTH axes, so a shot
 * at (-73, 11) is the same shot as (73, -11). Negating x alone would put a
 * right-wing shot on the left wing. `rotateToAttackingEnd` below is the one
 * place that happens for this section.
 *
 * ============ WHAT THE TABLE HOLDS, MEASURED 2026-09-15 ====================
 *
 * 153,754 rows for 20252026 and 156,622 for 20242025 — the plan's premise that
 * these are "2024-25 only" is out of date. Every row is placed. `event_type` is
 * shot-on-goal, blocked-shot, missed-shot or goal, so the map is ATTEMPTS
 * (Corsi), not shots on goal, and the card says which. `shot_type` is null on
 * 84,797 of them, almost all blocked shots, so a type breakdown must count the
 * blanks rather than quietly dropping them.
 *
 * BLOCKED SHOTS CARRY THE BLOCKING TEAM AS `team_id`, observed rather than
 * assumed when the retired 3x3 grid was built: blocked-shot rows come back with
 * `zone_code = 'D'`, which only makes sense from the defending side, while shots
 * on goal read 'O'. `shooter_id` is still the shooter, so a per-player map is
 * correct — but anything keying a shot map on `team_id` must exclude blocked
 * shots or it will credit them to the defence.
 *
 * A GOALIE TAKES NO SHOTS. Measured: Hellebuyck has 0 rows as `shooter_id` and
 * Vasilevskiy 1. A goalie's card keys on `goalie_id` instead, which is filled
 * on 111,896 of 153,754 rows — a blocked or missed shot often has no goalie
 * attributed — so the goalie map is shots that REACHED him plus goals.
 * =========================================================================
 */

import type { NhlSeasonLine } from '@/lib/sports/nhl/apiWebParsers';
import { sectionOpeningSeason, type ResearchCard, type ResearchSection } from '@/lib/sports/shared/playerResearchShapes';

/** One attempt as the table stores it, before normalisation. */
export interface NhlShot {
  date: string;
  /** The table's own key: 20252026. */
  season: string;
  eventType: 'goal' | 'shot-on-goal' | 'missed-shot' | 'blocked-shot' | string;
  shotType: string | null;
  /** -100..100, sign meaning the attacking end. */
  x: number | null;
  /** -42..42 across the ice. */
  y: number | null;
  zoneCode: string | null;
  period: number | null;
}

export interface NhlShotsPayload {
  /** The id these rows were found under: a skater's `shooter_id` or a goalie's `goalie_id`. */
  playerId: number;
  role: 'skater' | 'goalie';
  seasons: string[];
  shots: NhlShot[];
  asOf: string | null;
}

export interface NhlShotMapInput {
  /** The page's scope season (`research.splits.defaultSeason`); opens here when the source holds it. Set by the adapter. */
  scopeSeason?: number | null;
  /** The history's season label (2025), not the table's (20252026). */
  season: number | null;
  data: NhlShotsPayload | null;
  loading: boolean;
  error: string | null;
  /** The official season lines from the api-web player landing, if the bio carried them. */
  officialSeasons?: NhlSeasonLine[] | null;
  emptyReason?: string;
}

/** `player_game_history` labels the 2025-26 season 2025; `nhl_shot_events` labels it 20252026. */
export const shotSeasonKey = (historySeason: number): string => `${historySeason}${historySeason + 1}`;
export const historySeasonOf = (key: string): number => Number(key.slice(0, 4));

/**
 * Both axes, or neither. A shot taken at the negative end is the same shot
 * rotated half a turn; mirroring only x would swap the wings.
 */
export function rotateToAttackingEnd(s: NhlShot): { x: number; y: number } | null {
  if (s.x == null || s.y == null) return null;
  return s.x < 0 ? { x: -s.x, y: -s.y } : { x: s.x, y: s.y };
}

const EVENTS: Array<{ key: string; label: string }> = [
  { key: 'goal', label: 'Goal' },
  { key: 'shot-on-goal', label: 'On goal' },
  { key: 'missed-shot', label: 'Missed' },
  { key: 'blocked-shot', label: 'Blocked' },
];
const EVENT_LABEL = new Map(EVENTS.map((e) => [e.key, e.label]));

const pct = (n: number, d: number): number | null => (d ? (100 * n) / d : null);
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Feet from the goal line, the only distance a hockey shot is read in. */
export const feetFromNet = (x: number, y: number): number => Math.sqrt((89 - Math.abs(x)) ** 2 + y ** 2);

/**
 * The official NHL totals, which the app parses but has never shown: the
 * landing's own season lines, straight from the league. G2 marked this "not
 * parsed by the app today" — `parsePlayerLanding` has parsed it since R6.1a,
 * and the bio already fetches that landing, so this costs no extra call.
 */
function officialTotals(seasons: NhlSeasonLine[] | null | undefined, goalie: boolean): ResearchCard {
  const rows = (seasons ?? []).slice().reverse();
  return {
    kind: 'table',
    key: 'official',
    title: 'Official NHL season totals',
    scope: 'api-web.nhle.com',
    caption: "The league's own totals, including seasons before this app's own history begins.",
    labelHeader: 'Season',
    columns: goalie
      ? [
          { key: 'gp', label: 'GP', decimals: 0 },
          { key: 'gs', label: 'GS', decimals: 0 },
          { key: 'w', label: 'W', decimals: 0 },
          { key: 'l', label: 'L', decimals: 0 },
          { key: 'otl', label: 'OTL', decimals: 0 },
          { key: 'svp', label: 'SV%', decimals: 3, format: 'rate3' },
          { key: 'gaa', label: 'GAA', decimals: 2 },
          { key: 'so', label: 'SO', decimals: 0 },
        ]
      : [
          { key: 'gp', label: 'GP', decimals: 0 },
          { key: 'g', label: 'G', decimals: 0 },
          { key: 'a', label: 'A', decimals: 0 },
          { key: 'p', label: 'P', decimals: 0 },
          { key: 'ppp', label: 'PPP', decimals: 0 },
          { key: 'gwg', label: 'GWG', decimals: 0 },
          { key: 'shp', label: 'S%', decimals: 1 },
          { key: 'pm', label: '+/-', decimals: 0 },
        ],
    rows: rows.map((s, i) => ({
      key: `${s.season}-${s.team ?? i}`,
      label: `${String(s.season).slice(0, 4)}-${String(s.season).slice(6)}${s.team ? ` · ${s.team}` : ''}`,
      values: (goalie
        ? { gp: s.gamesPlayed, gs: s.gamesStarted, w: s.wins, l: s.losses, otl: s.otLosses, svp: s.savePct, gaa: s.goalsAgainstAvg, so: s.shutouts }
        : {
            gp: s.gamesPlayed,
            g: s.goals,
            a: s.assists,
            p: s.points,
            ppp: s.powerPlayPoints,
            gwg: s.gameWinningGoals,
            // The landing gives a rate; the column is a percentage.
            shp: s.shootingPct == null ? null : s.shootingPct <= 1 ? s.shootingPct * 100 : s.shootingPct,
            pm: s.plusMinus,
          }) as Record<string, number | null>,
    })),
    emptyText: 'The league returned no season totals for this player.',
  };
}

export function nhlShotMapSection(input: NhlShotMapInput): ResearchSection {
  const goalie = input.data?.role === 'goalie';
  const seasons = (input.data?.seasons ?? []).map(historySeasonOf);
  const base = {
    id: 'shots',
    navLabel: goalie ? 'Shots faced' : 'Shot map',
    title: goalie ? 'Shots faced & official totals' : 'Shot map & official totals',
    sub: goalie ? 'every attempt against' : 'every attempt',
    ...(seasons.length
      ? { season: { value: sectionOpeningSeason(seasons, input.season, input.scopeSeason), options: [...seasons].reverse().map((s) => ({ value: s, label: `${s}-${String(s + 1).slice(2)}` })) } }
      : {}),
  };
  if (input.loading) return { ...base, rows: [], state: { kind: 'loading' } };
  if (input.error) return { ...base, rows: [], state: { kind: 'error', message: input.error } };

  const official = officialTotals(input.officialSeasons, goalie);
  if (!input.data || input.data.shots.length === 0) {
    // The league's own totals still stand on their own, so this is not empty
    // unless they are missing too.
    if (official.kind === 'table' && official.rows.length) {
      return {
        ...base,
        rows: [[official]],
        state: { kind: 'ready' },
        note: input.emptyReason ?? 'The shot feed holds no attempts for this player; the official totals below are unaffected.',
        source: { label: goalie ? 'Shots faced' : 'Shot map', detail: 'NHL api-web player landing', asOf: null },
      };
    }
    return { ...base, rows: [], state: { kind: 'empty', title: 'No shots held', reason: input.emptyReason ?? 'The shot feed holds no attempts for this player.' } };
  }

  const season = sectionOpeningSeason(seasons, input.season, input.scopeSeason);
  const key = shotSeasonKey(season);
  const all = input.data.shots.filter((s) => s.season === key);
  const placed = all.map((s) => ({ s, at: rotateToAttackingEnd(s) })).filter((p): p is { s: NhlShot; at: { x: number; y: number } } => p.at != null);

  const counts = new Map<string, number>();
  for (const { s } of placed) counts.set(s.eventType, (counts.get(s.eventType) ?? 0) + 1);
  const groups = EVENTS.filter((e) => counts.has(e.key))
    .map((e) => ({ key: e.key, label: e.label, count: counts.get(e.key) as number }))
    .sort((a, b) => b.count - a.count);

  const goals = placed.filter((p) => p.s.eventType === 'goal').length;
  const map: ResearchCard = {
    kind: 'scatter',
    key: 'map',
    title: goalie ? 'Shots faced map' : 'Shot map',
    scope: goalie ? `${placed.length} faced · ${goals} in` : `${placed.length} attempts · ${goals} goals`,
    caption: goalie
      ? 'Every attempt the feed attributed to this goalie, rotated so all of them come at the same net.'
      : 'Every attempt, rotated so all of them attack the same net. A filled dot is a goal.',
    surface: 'rink',
    points: placed.map((p) => [p.s.eventType, p.at.y, p.at.x] as [string, number, number]),
    emphasis: placed.map((p) => p.s.eventType === 'goal'),
    tips: placed.map((p) => [
      `${EVENT_LABEL.get(p.s.eventType) ?? p.s.eventType}${p.s.shotType ? ` · ${p.s.shotType}` : ''}`,
      `${feetFromNet(p.at.x, p.at.y).toFixed(0)} ft out${p.s.period ? ` · period ${p.s.period}` : ''}`,
      shortDate(p.s.date),
    ]),
    legend: [
      { label: goalie ? 'Goal against' : 'Goal', dark: false },
      { label: 'No goal', dark: true },
    ],
    groups,
    defaultVisible: groups.map((g) => g.key),
  };

  const byType: ResearchCard = {
    kind: 'table',
    key: 'types',
    title: goalie ? 'What he faced' : 'By shot type',
    scope: `${all.length} attempts`,
    caption: 'Blocked attempts usually reach the feed without a type; they are counted here as "Not given" rather than dropped.',
    labelHeader: 'Type',
    columns: [
      { key: 'n', label: 'Att', decimals: 0 },
      { key: 'g', label: goalie ? 'In' : 'G', decimals: 0 },
      { key: 'rate', label: goalie ? 'Goal rate' : 'Conversion', decimals: 1, format: 'percent' },
      { key: 'share', label: 'Share', decimals: 0, format: 'percent' },
    ],
    rows: (() => {
      const byKey = new Map<string, { n: number; g: number }>();
      for (const s of all) {
        const k = s.shotType ?? 'Not given';
        const at = byKey.get(k) ?? { n: 0, g: 0 };
        at.n += 1;
        if (s.eventType === 'goal') at.g += 1;
        byKey.set(k, at);
      }
      return [...byKey.entries()]
        .sort((a, b) => b[1].n - a[1].n)
        .map(([k, v]) => ({
          key: k,
          label: k === 'Not given' ? k : k.charAt(0).toUpperCase() + k.slice(1),
          values: { n: v.n, g: v.g, rate: pct(v.g, v.n), share: pct(v.n, all.length) },
        }));
    })(),
    emptyText: 'No attempts this season.',
  };

  const unplaced = all.length - placed.length;
  return {
    ...base,
    rows: [[map, byType], [official]],
    state: { kind: 'ready' },
    // The map is attempts, not shots on goal, and a reader comparing it with a
    // box score deserves to be told before they wonder why it is bigger.
    note: `Attempts, not shots on goal: goals, shots on goal, missed and blocked attempts are all here.${unplaced > 0 ? ` ${unplaced} carry no location.` : ''}`,
    source: { label: goalie ? 'Shots faced' : 'Shot map', detail: 'nhl_shot_events (NHL api-web play-by-play); totals from the player landing', asOf: input.data.asOf },
  };
}
