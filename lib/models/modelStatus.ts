/**
 * What each sport's model is, and therefore what a page may say about it.
 *
 * M1 of docs/design/master-gameplan-ui-and-slate.md. The register itself is
 * Python's (`python-odds-service/src/model_status.py`, mirrored into
 * `model_status` by `modelStatusJob`); this is the read side and the one place
 * the display rule lives, so no page decides for itself.
 *
 * THE RULE
 *   gated     may show a probability beside the market's implied probability,
 *             a projection, a pick and a graded record. Never the difference
 *             between the two probabilities — that is an edge, and no model in
 *             this project claims one (`tests/scan-no-edge.test.ts`).
 *   baseline  a pick, a projection, hit rates and sample sizes. NO probability
 *             beside a price, and no record framed as a track record.
 *   failed    the attempt did not pass its test. Show nothing; say why.
 *   none      no model exists. Show nothing.
 *
 * Why a baseline may not show a probability: the number is not wrong so much as
 * unearned. The generic Elo blends half the market price into its own answer,
 * so its probability mostly restates the price it would be printed beside.
 */

export type ModelStatusValue = 'none' | 'baseline' | 'gated' | 'failed';
export type ModelKind = 'game' | 'prop';

export interface ModelStatusRow {
  sport: string;
  kind: ModelKind;
  engine: string | null;
  status: ModelStatusValue;
  /** The measurement behind the status, with its date. Shown on hover, not invented. */
  evidence: string;
  since: string;
  fittedAt: string | null;
  notes: string | null;
  /** The pre-registered test that would move this row, carried with it (M4 re-runs it). */
  gate: { test: string | null; criteria: string | null; minSample: number | null };
  checkedAt: string;
}

/** `soccer_epl` and `tennis_atp` fold onto the sport the model is built for. */
export function baseSport(sport: string): string {
  if (sport.startsWith('soccer')) return 'soccer';
  if (sport.startsWith('tennis')) return 'tennis';
  return sport;
}

export function findStatus(rows: ModelStatusRow[], sport: string, kind: ModelKind): ModelStatusRow | null {
  const key = baseSport(sport);
  return rows.find((r) => r.sport === key && r.kind === kind) ?? null;
}

export function statusOf(rows: ModelStatusRow[], sport: string, kind: ModelKind): ModelStatusValue {
  return findStatus(rows, sport, kind)?.status ?? 'none';
}

/** A probability beside a price is a claim about the market. Only a gated model makes it. */
export function mayShowProbability(rows: ModelStatusRow[], sport: string, kind: ModelKind): boolean {
  return statusOf(rows, sport, kind) === 'gated';
}

/** A pick (the Slate's green ring) is honest for a baseline; it claims no number. */
export function mayShowPick(rows: ModelStatusRow[], sport: string, kind: ModelKind): boolean {
  const s = statusOf(rows, sport, kind);
  return s === 'baseline' || s === 'gated';
}

/** A win-loss record reads as a track record, which a baseline has not earned. */
export function mayShowRecord(rows: ModelStatusRow[], sport: string, kind: ModelKind): boolean {
  return statusOf(rows, sport, kind) === 'gated';
}

/** What the page says out loud, in plain words. */
export function statusLabel(rows: ModelStatusRow[], sport: string, kind: ModelKind): string {
  switch (statusOf(rows, sport, kind)) {
    case 'gated':
      return 'validated model';
    case 'baseline':
      return 'baseline model, not validated';
    case 'failed':
      return 'no model — the attempt did not pass its test';
    default:
      return 'no model';
  }
}
