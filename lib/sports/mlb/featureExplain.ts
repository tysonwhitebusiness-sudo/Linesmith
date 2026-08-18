/**
 * Translates a fitted model's raw logistic-regression coefficients into a
 * plain-language "how much does this actually matter" read — for the
 * diagnostics page's Model Health section, not for anything the model
 * itself trains on.
 *
 * A raw coefficient alone is misleading: two features with similar-looking
 * weights can have wildly different practical effect if one varies a lot
 * game to game and the other barely moves. `practicalContribution` scales
 * each weight by a `typicalSwing` — a reasonable, disclosed reference for
 * how much that specific feature actually varies in real games (same spirit
 * as gameModel.ts's NEUTRAL_TEMP_F or modelFit.ts's NEUTRAL_BULLPEN_ERA: a
 * round, defensible approximation, not an empirically fit constant) — and
 * buckets that into a label a human can read at a glance.
 */

interface FeatureMeta {
  displayName: string;
  /** Reasonable typical real-world swing for this feature, used only to translate a coefficient into a practical log-odds contribution. Not derived from the training data itself. */
  typicalSwing: number;
  note?: string;
}

const FEATURE_META: Record<string, FeatureMeta> = {
  rawLog5: { displayName: 'Team quality (log5)', typicalSwing: 0.15 },
  rawPoissonOverProb: { displayName: 'Runs formula', typicalSwing: 0.15 },
  venueDiff: { displayName: 'Home/away split', typicalSwing: 0.04 },
  formDiff: { displayName: 'Recent form', typicalSwing: 0.05 },
  parkFactorCentered: {
    displayName: 'Park factor',
    typicalSwing: 0.06,
    note: 'typical park; extreme parks like Coors Field move this several times further',
  },
  eloProb: { displayName: 'Elo rating gap', typicalSwing: 0.12 },
  marketProbCentered: { displayName: 'Market price', typicalSwing: 0.08 },
  lineMovement: { displayName: 'Line movement (open→close)', typicalSwing: 0.5 },
  bullpenEraCentered: { displayName: 'Bullpen quality', typicalSwing: 0.8 },
  // Home Run model plan
  betaBinomialHrProb: { displayName: 'Beta-Binomial baseline', typicalSwing: 0.15 },
  parkHrFactorCentered: {
    displayName: 'Park HR factor',
    typicalSwing: 0.1,
    note: 'general run-scoring park factor used as a proxy, not an HR-specific one — see docs/hr-predictor-plan.md',
  },
  pitcherMatchupSignal: {
    displayName: 'Pitcher matchup',
    typicalSwing: 0.3,
    note: 'season-aggregate opponent proxy in training; live currently feeds neutral until a per-request lookup is built',
  },
  expectedPaCentered: { displayName: 'Lineup slot / expected PA', typicalSwing: 0.4 },
};

const DEFAULT_TYPICAL_SWING = 0.1;

export type FeatureDominance = 'dominant' | 'meaningful' | 'minor' | 'negligible';

const DOMINANT_THRESHOLD = 0.08;
const MEANINGFUL_THRESHOLD = 0.03;
const MINOR_THRESHOLD = 0.01;

function labelFor(contribution: number): FeatureDominance {
  if (contribution >= DOMINANT_THRESHOLD) return 'dominant';
  if (contribution >= MEANINGFUL_THRESHOLD) return 'meaningful';
  if (contribution >= MINOR_THRESHOLD) return 'minor';
  return 'negligible';
}

export interface FeatureExplanation {
  name: string;
  displayName: string;
  weight: number;
  /** |weight| × typicalSwing — a rough "how much does this actually move a real prediction" estimate, in log-odds. */
  practicalContribution: number;
  label: FeatureDominance;
  note?: string;
}

export function explainFeatureWeights(featureNames: readonly string[], weights: number[]): FeatureExplanation[] {
  return featureNames.map((name, i) => {
    const weight = weights[i] ?? 0;
    const meta = FEATURE_META[name];
    const swing = meta?.typicalSwing ?? DEFAULT_TYPICAL_SWING;
    const practicalContribution = Math.abs(weight) * swing;
    return {
      name,
      displayName: meta?.displayName ?? name,
      weight,
      practicalContribution,
      label: labelFor(practicalContribution),
      note: meta?.note,
    };
  });
}
