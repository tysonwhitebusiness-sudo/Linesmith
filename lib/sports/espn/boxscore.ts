/**
 * ESPN's summary box score, one shape for every sport that uses it — football
 * since R8.2, basketball since R8.4. `boxscore.players[]` holds each team's stat
 * groups (football: passing, rushing...; basketball: one group), each with
 * `keys` naming the columns and every athlete's `stats` in that order. Some keys
 * are joined ("completions/passingAttempts", "fieldGoalsMade-fieldGoalsAttempted").
 *
 * Pure and database-free.
 */

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** One stat group of one team's box score, as ESPN lays it out: `keys` name the columns, some joined ("completions/passingAttempts"). */
export interface EspnBoxGroup {
  name: string;
  keys: string[];
  labels: string[];
  totals: string[];
  athletes: Array<{ id: string; name: string; stats: string[] }>;
}

export interface EspnBoxTeam {
  teamId: string;
  groups: EspnBoxGroup[];
}

export function parseEspnBox(summary: J): EspnBoxTeam[] {
  return (summary?.boxscore?.players ?? []).map((t: J) => ({
    teamId: String(t.team?.id ?? ''),
    groups: (t.statistics ?? []).map((g: J) => ({
      name: String(g.name ?? ''),
      keys: (g.keys ?? []).map(String),
      labels: (g.labels ?? []).map(String),
      totals: (g.totals ?? []).map(String),
      athletes: (g.athletes ?? []).map((a: J) => ({ id: String(a.athlete?.id ?? ''), name: String(a.athlete?.displayName ?? ''), stats: (a.stats ?? []).map(String) })),
    })),
  }));
}

/** One stat for one athlete: a plain key, or one part of a joined key ("completions" out of "22/34"). */
export function boxStat(box: EspnBoxTeam[], athleteId: string, group: string, key: string): number | null {
  for (const team of box) {
    const g = team.groups.find((x) => x.name === group);
    const a = g?.athletes.find((x) => x.id === athleteId);
    if (!g || !a) continue;
    const i = g.keys.indexOf(key);
    if (i >= 0) return num(a.stats[i]);
    const j = g.keys.findIndex((k) => k.split(/[/-]/).includes(key));
    if (j >= 0) return num(String(a.stats[j]).split(/[/-]/)[g.keys[j].split(/[/-]/).indexOf(key)]);
  }
  return null;
}

export function boxTeamOf(box: EspnBoxTeam[], athleteId: string): string | null {
  return box.find((t) => t.groups.some((g) => g.athletes.some((a) => a.id === athleteId)))?.teamId ?? null;
}

