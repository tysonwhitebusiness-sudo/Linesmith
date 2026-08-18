/**
 * The one de-vig function. `impliedPair` (OddsChip.tsx, prop over/under) and
 * `homeShare` (display.ts, game moneyline) implemented this same math twice
 * before Phase C.1 — both now call through here, so a two-sided price is
 * normalised identically everywhere it's used, including the edge calc.
 *
 * Standard multiplicative de-vig: each side's raw implied probability
 * (1/decimal) divided by the sum of both raw probabilities, so they sum to
 * exactly 1.0. Only valid for a genuine two-sided price from the same book —
 * mixing books or grading a one-sided price would misrepresent the vig.
 */
export function devigTwoWay(
  aDecimal: number | null | undefined,
  bDecimal: number | null | undefined,
): { a: number; b: number } | null {
  if (aDecimal == null || bDecimal == null || !Number.isFinite(aDecimal) || !Number.isFinite(bDecimal)) return null;
  if (aDecimal <= 1 || bDecimal <= 1) return null;
  const rawA = 1 / aDecimal;
  const rawB = 1 / bDecimal;
  const total = rawA + rawB;
  if (total <= 0) return null;
  return { a: rawA / total, b: rawB / total };
}

/**
 * There used to be a one-sided-price fallback here (`estimateOneSidedEdge`)
 * for the ~7 in 8 subject/market/line combos with no genuine two-sided
 * price — meant to recover edge coverage, but its numbers turned out to be
 * unverifiable: a thin, longshot-priced line has no real "fair probability"
 * to estimate, and every affected candidate ended up clustering at the same
 * capped value regardless of how different the underlying picks actually
 * were. Removed rather than re-tuned — `devigTwoWay` above is the only edge
 * math in this app now, and `edge`/`marketProb` are null whenever a real
 * two-sided price doesn't exist, same as before that fallback was added.
 */
