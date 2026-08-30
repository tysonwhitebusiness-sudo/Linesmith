/**
 * Matching one feed's team name against another's — a real, recurring defect,
 * not a tidiness helper.
 *
 * ===================== THE BUG THIS EXISTS FOR ============================
 *
 * Two feeds name the same club differently and an exact `===` silently never
 * matches. Nothing throws, nothing type-checks, and the only symptom is a block
 * that quietly renders nothing forever.
 *
 * Found three times now, in three sports:
 *
 *   CFB     CFBD says "Alabama", ESPN says "Alabama Crimson Tide".
 *   MLB/CFB the same class again in `adapter.ts`'s own H2H split.
 *   SOCCER  measured 2026-08-30 on a real EPL page: the player's history says
 *           **"Leeds"** (Understat's short form) while `subjectMeta.opponentName`
 *           says **"Leeds United"** (ESPN's). 0 of 273 history entries matched,
 *           so the h2h window box, the `careerH2H` card and the "vs opponent"
 *           filter chip were ALL dead — and had been since soccer shipped.
 *
 * Understat's EPL vocabulary is a mix: "Manchester City" and "West Bromwich
 * Albion" are full, while "Leeds", "Tottenham", "Brighton" and "Wolverhampton
 * Wanderers" disagree with ESPN in both directions. That is why the test is a
 * BIDIRECTIONAL substring rather than a prefix — neither feed is reliably the
 * longer one.
 *
 * WHY NOT A LOOKUP TABLE: one would have to be maintained per league per feed,
 * and would go stale on promotion and relegation every season. A substring
 * match after normalisation is looser, and the looseness is bounded by the fact
 * that both sides are already known team names from the same league — not
 * free text.
 * =========================================================================
 */

/** Case, accents and punctuation removed; whitespace collapsed. */
export function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Apostrophes are REMOVED, not spaced. CFB's original spaced them, which
    // turns "Nott'm Forest" into "nott m forest" and stops it matching a feed
    // that writes "Nottm Forest" -- the exact failure this file exists to
    // prevent, reintroduced by the normaliser itself. Hyphens and periods
    // still become spaces, since those genuinely separate words.
    .replace(/['`’]/g, '')
    .replace(/[.\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when two team names from different feeds refer to the same team.
 *
 * Empty strings never match — an absent opponent must not match every row,
 * which would turn an "insufficient" h2h into a full-season one.
 */
export function isTeamNameMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const x = normalizeTeamName(a);
  const y = normalizeTeamName(b);
  return x !== '' && y !== '' && (x.includes(y) || y.includes(x));
}
