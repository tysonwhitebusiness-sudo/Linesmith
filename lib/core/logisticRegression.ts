/**
 * A small, hand-rolled logistic regression — gradient descent with L2
 * (ridge) regularization. Deliberately not a dependency: with a handful of
 * features and a few thousand training rows, this is well within what a
 * plain implementation handles correctly, and it keeps every step of "how
 * the weights got learned" inspectable in this codebase rather than behind
 * a library. Sport-agnostic — this is pure math, no baseball in it.
 */

export interface FitOptions {
  learningRate?: number;
  iterations?: number;
  /** Ridge penalty — shrinks coefficients toward 0, the guard against overfitting a modest dataset. */
  l2?: number;
}

export interface FitResult {
  /** One coefficient per feature column, same order as the training matrix's columns. */
  weights: number[];
  intercept: number;
  iterations: number;
  /**
   * Approximate covariance matrix of [intercept, weight_0, weight_1, ...]
   * (that order — intercept first), from the inverse Fisher information at
   * the fitted point: H = X_aug^T diag(p(1-p)) X_aug + ridgePenalty, Cov =
   * H^-1. This is the standard Laplace/Wald approximation used for ridge
   * (L2-regularized) logistic regression uncertainty — NOT an unbiased
   * frequentist standard error (the ridge penalty biases the estimate, so
   * "confidence interval" here means "how much the fitted curvature says
   * this prediction could plausibly move," not a formal coverage
   * guarantee). Still a legitimate, standard way to distinguish a
   * well-supported prediction from one resting on thin data — see
   * predictProbWithInterval.
   */
  covariance: number[][];
}

function sigmoid(z: number): number {
  if (z > 35) return 1;
  if (z < -35) return 0;
  return 1 / (1 + Math.exp(-z));
}

/**
 * Per-column mean/std, guarding std=0 (a constant column, or n<2 rows) to
 * `1` rather than dividing by zero — that column just doesn't get scaled
 * (still gets centered), which is harmless since a truly constant feature
 * contributes nothing for the fit to find a coefficient for either way.
 */
function standardizeColumns(X: number[][]): { Xstd: number[][]; means: number[]; stds: number[] } {
  const n = X.length;
  const numFeatures = X[0]?.length ?? 0;
  const means = new Array(numFeatures).fill(0);
  const stds = new Array(numFeatures).fill(1);

  for (let j = 0; j < numFeatures; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += X[i][j];
    const mean = n > 0 ? sum / n : 0;
    let variance = 0;
    for (let i = 0; i < n; i++) variance += (X[i][j] - mean) * (X[i][j] - mean);
    const std = n > 0 ? Math.sqrt(variance / n) : 0;
    means[j] = mean;
    stds[j] = std > 1e-10 ? std : 1;
  }

  const Xstd = X.map((row) => row.map((x, j) => (x - means[j]) / stds[j]));
  return { Xstd, means, stds };
}

function matMul(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const inner = B.length;
  const cols = B[0]?.length ?? 0;
  const out = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let k = 0; k < inner; k++) {
      const a = A[i][k];
      if (a === 0) continue;
      for (let j = 0; j < cols; j++) out[i][j] += a * B[k][j];
    }
  }
  return out;
}

function transpose(A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0]?.length ?? 0;
  const out = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j][i] = A[i][j];
  return out;
}

/**
 * Jacobian of the raw-parameter transform w.r.t. the standardized-parameter
 * fit, [intercept, weight_0, ...] order both sides — see fitLogisticRegression's
 * de-standardization comment for the derivation. Used to map the fitted
 * covariance matrix from standardized-parameter space back to raw-parameter
 * space (Cov_orig = J · Cov_std · J^T), the same way the point-estimate
 * weights/intercept themselves get mapped back.
 */
function destandardizeJacobian(means: number[], stds: number[]): number[][] {
  const numFeatures = means.length;
  const dim = numFeatures + 1;
  const J = Array.from({ length: dim }, () => new Array(dim).fill(0));
  J[0][0] = 1;
  for (let j = 0; j < numFeatures; j++) {
    J[0][j + 1] = -means[j] / stds[j];
    J[j + 1][j + 1] = 1 / stds[j];
  }
  return J;
}

/**
 * Gauss-Jordan elimination with partial pivoting — the only matrix op this
 * module needs (inverting the small Fisher-information matrix below), so a
 * general linear-algebra dependency isn't worth pulling in for it.
 */
function invertMatrix(matrix: number[][]): number[][] {
  const n = matrix.length;
  const aug = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(aug[col][col]);
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > maxAbs) {
        maxAbs = Math.abs(aug[r][col]);
        pivotRow = r;
      }
    }
    if (maxAbs < 1e-10) {
      throw new Error('invertMatrix: matrix is singular or near-singular (collinear features?) — cannot compute a confidence interval from it');
    }
    if (pivotRow !== col) [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];

    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }

  return aug.map((row) => row.slice(n));
}

/**
 * The Fisher information matrix at the fitted point, [intercept, weights]
 * order, with the same ridge penalty fitLogisticRegression applied (scaled
 * by n to match: the gradient descent above regularizes the *averaged*
 * loss, so the equivalent penalty on the summed negative log-likelihood
 * this Hessian comes from is l2*n, not l2).
 */
function computeCovariance(X: number[][], weights: number[], intercept: number, l2: number): number[][] {
  const n = X.length;
  const dim = weights.length + 1; // + intercept
  const H = Array.from({ length: dim }, () => new Array(dim).fill(0));

  for (let i = 0; i < n; i++) {
    const xAug = [1, ...X[i]];
    const p = predictProb(X[i], weights, intercept);
    const w = Math.max(p * (1 - p), 1e-6); // guard against a fully-saturated prediction zeroing out its row's contribution to curvature
    for (let a = 0; a < dim; a++) {
      for (let b = 0; b < dim; b++) H[a][b] += w * xAug[a] * xAug[b];
    }
  }
  for (let j = 1; j < dim; j++) H[j][j] += l2 * n; // ridge penalty, weight positions only — intercept (index 0) is never regularized, matching fitLogisticRegression

  return invertMatrix(H);
}

/**
 * X: one row per training example, one column per feature (no intercept
 * column — the intercept is fit separately and not regularized, standard
 * practice so shrinkage doesn't bias the baseline rate).
 * y: 0/1 actual outcome per row, same order as X.
 *
 * Internally standardizes each feature column (zero mean, unit variance)
 * before running gradient descent, then transforms the fitted weights,
 * intercept, and covariance matrix back to raw-feature units before
 * returning. Every caller and every downstream consumer (predictProb,
 * predictProbWithInterval, the stored model_weights row) keeps working on
 * raw features exactly as before — this is purely an internal fitting-
 * quality fix, invisible outside this function.
 *
 * Why it matters: the L2 penalty below (`l2 * weights[j]`) shrinks every
 * weight by the same amount regardless of that feature's natural scale. A
 * feature with a narrow range (say 0.02-0.30) needs a proportionally larger
 * coefficient to produce the same effect on the prediction as a feature with
 * a wide range (say -2 to +2) — but L2 penalizes "large coefficient" the
 * same way whether that size reflects real importance or just a small
 * natural scale. Left unfixed, this systematically under-weights tightly-
 * clustered features (like a Beta-Binomial baseline probability) relative to
 * wider-swinging ones (like a centered lineup-slot feature), independent of
 * which one actually predicts better — exactly the failure mode observed
 * fitting the home-run model's v1/v2 (see docs/hr-predictor-plan.md).
 * Standardizing first means every feature enters the ridge penalty on equal
 * footing, so the fit reflects true predictive power instead of raw scale.
 */
export function fitLogisticRegression(X: number[][], y: number[], options: FitOptions = {}): FitResult {
  const { learningRate = 0.3, iterations = 3000, l2 = 0.01 } = options;
  const n = X.length;
  const numFeatures = X[0]?.length ?? 0;

  const { Xstd, means, stds } = standardizeColumns(X);

  const weightsStd = new Array(numFeatures).fill(0);
  let interceptStd = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const gradW = new Array(numFeatures).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      let z = interceptStd;
      for (let j = 0; j < numFeatures; j++) z += weightsStd[j] * Xstd[i][j];
      const pred = sigmoid(z);
      const error = pred - y[i];
      for (let j = 0; j < numFeatures; j++) gradW[j] += error * Xstd[i][j];
      gradB += error;
    }
    for (let j = 0; j < numFeatures; j++) {
      weightsStd[j] -= learningRate * (gradW[j] / n + l2 * weightsStd[j]);
    }
    interceptStd -= learningRate * (gradB / n);
  }

  const covarianceStd = computeCovariance(Xstd, weightsStd, interceptStd, l2);

  // De-standardize the point estimate: x_std = (x_raw - mean) / std, so
  // z = intercept_std + sum(w_std * x_std)
  //   = [intercept_std - sum(w_std * mean / std)] + sum((w_std / std) * x_raw)
  const weights = weightsStd.map((w, j) => w / stds[j]);
  let intercept = interceptStd;
  for (let j = 0; j < numFeatures; j++) intercept -= (weightsStd[j] * means[j]) / stds[j];

  // Same transform applied to the covariance matrix via its Jacobian —
  // Cov_orig = J · Cov_std · J^T, the standard delta-method mapping for a
  // linear reparameterization (see destandardizeJacobian's derivation).
  const J = destandardizeJacobian(means, stds);
  const covariance = matMul(matMul(J, covarianceStd), transpose(J));

  return { weights, intercept, iterations, covariance };
}

export function predictProb(features: number[], weights: number[], intercept: number): number {
  let z = intercept;
  for (let j = 0; j < weights.length; j++) z += weights[j] * features[j];
  return sigmoid(z);
}

export interface ProbInterval {
  prob: number;
  lower: number;
  upper: number;
  /** Standard error of the underlying logit — the raw curvature-based uncertainty before it's mapped through the sigmoid into probability space. */
  se: number;
}

/**
 * Wald confidence interval for a new prediction via the delta method: the
 * logit z = intercept + w·x is linear in the fitted parameters, so
 * Var(z) = x_aug^T Cov x_aug propagates directly from the parameter
 * covariance: no resampling or refitting needed for a single prediction.
 * zScore=1.645 is the default (90% interval); use 1.96 for 95%.
 */
export function predictProbWithInterval(features: number[], weights: number[], intercept: number, covariance: number[][], zScore = 1.645): ProbInterval {
  const xAug = [1, ...features];
  let variance = 0;
  for (let a = 0; a < xAug.length; a++) {
    for (let b = 0; b < xAug.length; b++) variance += xAug[a] * covariance[a][b] * xAug[b];
  }
  const se = Math.sqrt(Math.max(variance, 0));
  const z = intercept + features.reduce((sum, x, j) => sum + weights[j] * x, 0);
  return {
    prob: sigmoid(z),
    lower: sigmoid(z - zScore * se),
    upper: sigmoid(z + zScore * se),
    se,
  };
}

export function brierScore(predictions: Array<{ prob: number; actual: number }>): number {
  if (predictions.length === 0) return NaN;
  let sum = 0;
  for (const p of predictions) sum += (p.prob - p.actual) * (p.prob - p.actual);
  return sum / predictions.length;
}
