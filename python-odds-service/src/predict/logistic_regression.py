"""Direct, line-for-line port of lib/core/logisticRegression.ts — not a
reimplementation, and deliberately NOT a numpy-native rewrite. A hand-rolled
logistic regression (gradient descent, L2/ridge-regularized), sport-agnostic,
pure math, no baseball in it.

Literal port over a numpy rewrite is a deliberate choice (see
docs/mlb-prediction-engine-python-port-gameplan-2026-08-21.md's Layer 0
notes): this needs to stay compatible with `model_weights` rows already
fitted and stored by the TS version — a numpy-native rewrite would produce
numerically different coefficients from a re-fit, a real behavior change,
not a no-op port. Loop order matches the TS source exactly (not just
mathematically equivalent) since floating-point addition isn't associative.
"""
import math

Matrix = list[list[float]]


class FitResult:
    def __init__(self, weights: list[float], intercept: float, iterations: int, covariance: Matrix):
        self.weights = weights
        self.intercept = intercept
        self.iterations = iterations
        # Approximate covariance matrix of [intercept, weight_0, weight_1, ...]
        # (that order — intercept first), from the inverse Fisher information
        # at the fitted point. Standard Laplace/Wald approximation for ridge
        # (L2-regularized) logistic regression uncertainty — NOT an unbiased
        # frequentist standard error (the ridge penalty biases the estimate).
        self.covariance = covariance


class ProbInterval:
    def __init__(self, prob: float, lower: float, upper: float, se: float):
        self.prob = prob
        self.lower = lower
        self.upper = upper
        # Standard error of the underlying logit — the raw curvature-based
        # uncertainty before it's mapped through the sigmoid into probability space.
        self.se = se


def _sigmoid(z: float) -> float:
    # More necessary here than in JS: math.exp raises OverflowError on very
    # large args where JS silently returns Infinity — this clamp is load-
    # bearing in Python, not just a style choice carried over from the source.
    if z > 35:
        return 1.0
    if z < -35:
        return 0.0
    return 1 / (1 + math.exp(-z))


def _standardize_columns(X: Matrix) -> tuple[Matrix, list[float], list[float]]:
    """Per-column mean/std, guarding std<=1e-10 to 1 rather than dividing by
    zero — that column just doesn't get scaled (still gets centered), harmless
    since a truly constant feature contributes nothing for the fit to find a
    coefficient for either way."""
    n = len(X)
    num_features = len(X[0]) if X else 0
    means = [0.0] * num_features
    stds = [1.0] * num_features

    for j in range(num_features):
        total = 0.0
        for i in range(n):
            total += X[i][j]
        mean = total / n if n > 0 else 0.0
        variance = 0.0
        for i in range(n):
            variance += (X[i][j] - mean) * (X[i][j] - mean)
        std = math.sqrt(variance / n) if n > 0 else 0.0
        means[j] = mean
        stds[j] = std if std > 1e-10 else 1.0

    x_std = [[(x - means[j]) / stds[j] for j, x in enumerate(row)] for row in X]
    return x_std, means, stds


def _mat_mul(a: Matrix, b: Matrix) -> Matrix:
    rows = len(a)
    inner = len(b)
    cols = len(b[0]) if b else 0
    out = [[0.0] * cols for _ in range(rows)]
    for i in range(rows):
        for k in range(inner):
            av = a[i][k]
            if av == 0:
                continue
            for j in range(cols):
                out[i][j] += av * b[k][j]
    return out


def _transpose(a: Matrix) -> Matrix:
    rows = len(a)
    cols = len(a[0]) if a else 0
    out = [[0.0] * rows for _ in range(cols)]
    for i in range(rows):
        for j in range(cols):
            out[j][i] = a[i][j]
    return out


def _destandardize_jacobian(means: list[float], stds: list[float]) -> Matrix:
    """Jacobian of the raw-parameter transform w.r.t. the standardized-
    parameter fit, [intercept, weight_0, ...] order both sides — used to map
    the fitted covariance matrix from standardized-parameter space back to
    raw-parameter space (Cov_orig = J . Cov_std . J^T), the same way the
    point-estimate weights/intercept themselves get mapped back."""
    num_features = len(means)
    dim = num_features + 1
    j_mat = [[0.0] * dim for _ in range(dim)]
    j_mat[0][0] = 1.0
    for j in range(num_features):
        j_mat[0][j + 1] = -means[j] / stds[j]
        j_mat[j + 1][j + 1] = 1 / stds[j]
    return j_mat


def _invert_matrix(matrix: Matrix) -> Matrix:
    """Gauss-Jordan elimination with partial pivoting — the only matrix op
    this module needs (inverting the small Fisher-information matrix below),
    so a general linear-algebra dependency isn't worth pulling in for it."""
    n = len(matrix)
    aug = [list(row) + [1.0 if i == j else 0.0 for j in range(n)] for i, row in enumerate(matrix)]

    for col in range(n):
        pivot_row = col
        max_abs = abs(aug[col][col])
        for r in range(col + 1, n):
            if abs(aug[r][col]) > max_abs:
                max_abs = abs(aug[r][col])
                pivot_row = r
        if max_abs < 1e-10:
            raise ValueError("invertMatrix: matrix is singular or near-singular (collinear features?) — cannot compute a confidence interval from it")
        if pivot_row != col:
            aug[col], aug[pivot_row] = aug[pivot_row], aug[col]

        pivot = aug[col][col]
        for j in range(2 * n):
            aug[col][j] /= pivot
        for r in range(n):
            if r == col:
                continue
            factor = aug[r][col]
            if factor == 0:
                continue
            for j in range(2 * n):
                aug[r][j] -= factor * aug[col][j]

    return [row[n:] for row in aug]


def _compute_covariance(x: Matrix, weights: list[float], intercept: float, l2: float) -> Matrix:
    """The Fisher information matrix at the fitted point, [intercept,
    weights] order, with the same ridge penalty fit_logistic_regression
    applied (scaled by n to match: gradient descent regularizes the
    *averaged* loss, so the equivalent penalty on the summed negative
    log-likelihood this Hessian comes from is l2*n, not l2)."""
    n = len(x)
    dim = len(weights) + 1  # + intercept
    h = [[0.0] * dim for _ in range(dim)]

    for i in range(n):
        x_aug = [1.0] + list(x[i])
        p = predict_prob(x[i], weights, intercept)
        w = max(p * (1 - p), 1e-6)  # guard against a fully-saturated prediction zeroing out its row's contribution to curvature
        for a in range(dim):
            for b in range(dim):
                h[a][b] += w * x_aug[a] * x_aug[b]
    for j in range(1, dim):
        h[j][j] += l2 * n  # ridge penalty, weight positions only — intercept (index 0) is never regularized

    return _invert_matrix(h)


def fit_logistic_regression(
    x: Matrix,
    y: list[float],
    learning_rate: float = 0.3,
    iterations: int = 3000,
    l2: float = 0.01,
) -> FitResult:
    """X: one row per training example, one column per feature (no intercept
    column). y: 0/1 actual outcome per row, same order as X.

    Internally standardizes each feature column (zero mean, unit variance)
    before running gradient descent, then transforms the fitted weights,
    intercept, and covariance matrix back to raw-feature units before
    returning — every caller keeps working on raw features exactly as
    before, this is purely an internal fitting-quality fix. See the TS
    source's own comment for the full "why standardize" reasoning; ported
    verbatim below, not re-derived."""
    n = len(x)
    num_features = len(x[0]) if x else 0

    x_std, means, stds = _standardize_columns(x)

    weights_std = [0.0] * num_features
    intercept_std = 0.0

    for _ in range(iterations):
        grad_w = [0.0] * num_features
        grad_b = 0.0
        for i in range(n):
            z = intercept_std
            for j in range(num_features):
                z += weights_std[j] * x_std[i][j]
            pred = _sigmoid(z)
            error = pred - y[i]
            for j in range(num_features):
                grad_w[j] += error * x_std[i][j]
            grad_b += error
        for j in range(num_features):
            weights_std[j] -= learning_rate * (grad_w[j] / n + l2 * weights_std[j])
        intercept_std -= learning_rate * (grad_b / n)

    covariance_std = _compute_covariance(x_std, weights_std, intercept_std, l2)

    # De-standardize the point estimate: x_std = (x_raw - mean) / std, so
    # z = intercept_std + sum(w_std * x_std)
    #   = [intercept_std - sum(w_std * mean / std)] + sum((w_std / std) * x_raw)
    weights = [w / stds[j] for j, w in enumerate(weights_std)]
    intercept = intercept_std
    for j in range(num_features):
        intercept -= (weights_std[j] * means[j]) / stds[j]

    # Same transform applied to the covariance matrix via its Jacobian —
    # Cov_orig = J . Cov_std . J^T, the standard delta-method mapping for a
    # linear reparameterization.
    j_mat = _destandardize_jacobian(means, stds)
    covariance = _mat_mul(_mat_mul(j_mat, covariance_std), _transpose(j_mat))

    return FitResult(weights=weights, intercept=intercept, iterations=iterations, covariance=covariance)


def predict_prob(features: list[float], weights: list[float], intercept: float) -> float:
    z = intercept
    for j in range(len(weights)):
        z += weights[j] * features[j]
    return _sigmoid(z)


def predict_prob_with_interval(
    features: list[float],
    weights: list[float],
    intercept: float,
    covariance: Matrix,
    z_score: float = 1.645,
) -> ProbInterval:
    """Wald confidence interval for a new prediction via the delta method:
    the logit z = intercept + w.x is linear in the fitted parameters, so
    Var(z) = x_aug^T Cov x_aug propagates directly from the parameter
    covariance — no resampling or refitting needed for a single prediction.
    z_score=1.645 is the default (90% interval); use 1.96 for 95%."""
    x_aug = [1.0] + list(features)
    variance = 0.0
    for a in range(len(x_aug)):
        for b in range(len(x_aug)):
            variance += x_aug[a] * covariance[a][b] * x_aug[b]
    se = math.sqrt(max(variance, 0))
    z = intercept + sum(weights[j] * x for j, x in enumerate(features))
    return ProbInterval(
        prob=_sigmoid(z),
        lower=_sigmoid(z - z_score * se),
        upper=_sigmoid(z + z_score * se),
        se=se,
    )


class PredictionRecord:
    """Matches the TS source's {prob, actual} object shape exactly — brier_score
    reads named fields, not positional ones, so a caller can't accidentally
    swap the order the way an unlabeled tuple would let them."""

    def __init__(self, prob: float, actual: float):
        self.prob = prob
        self.actual = actual


def brier_score(predictions: list[PredictionRecord]) -> float:
    if len(predictions) == 0:
        return float("nan")
    total = 0.0
    for p in predictions:
        total += (p.prob - p.actual) * (p.prob - p.actual)
    return total / len(predictions)
