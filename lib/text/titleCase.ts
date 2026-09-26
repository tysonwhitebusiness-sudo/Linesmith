/**
 * Title Case — the one rule (docs/design/title-case-plan.md §2, operator
 * 2026-09-26). Short text that NAMES something is Title Case; text that reads
 * as a sentence is not, and never comes through here.
 *
 * The same function drives the codemod that rewrote the source strings, the
 * guard that keeps them that way (tests/title-case.test.ts), and the one
 * render-time use: text from outside the app (a provider's market name
 * `marketLabel` does not know), applied in the adapter, never in a component.
 *
 *  1. A word that is ENTIRELY lowercase letters gets a capital first letter.
 *  2. Small words stay lowercase unless first or last in their run.
 *  3. A word that already has a capital, a digit or a symbol is left alone —
 *     HR/PA, K/9, aDOT, xwOBA, L10, +EV. This is what keeps "aDOT" from
 *     becoming "ADOT".
 *  4. A hyphenated word capitalises each part (HR-Friendly, Two-Way).
 *  5. "vs", "v" and units (mph, ft, yds…) stay lowercase even first.
 *
 * A separator — `·`, `—`, `–`, `:`, `|`, `/` standing alone, or a word ending
 * in `:` — starts a new run: "Matchup · At the Start".
 */

export const SMALL_WORDS: ReadonlySet<string> = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'per', 'vs', 'by', 'for']);

/**
 * Lowercase EVERYWHERE, even first: "vs" as it is today (operator, 2026-09-26),
 * tennis's "v", and units, which are never capitalised ("98 mph", "404 ft").
 */
export const ALWAYS_LOWER: ReadonlySet<string> = new Set(['vs', 'v', 'mph', 'ft', 'yd', 'yds', 'lb', 'lbs', 'x']);

const SEPARATOR = /^[·—–:|/&+=→←]+$/;
/** Letters, optionally one apostrophe inside ("day's"). */
const PLAIN = /^[a-z]+(?:['’][a-z]+)?$/;

function cap(w: string): string {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** One word, given whether it opens or closes its run. */
function word(core: string, edge: boolean): string {
  if (!core.includes('-')) {
    if (!PLAIN.test(core) || ALWAYS_LOWER.has(core)) return core;
    return !edge && SMALL_WORDS.has(core) ? core : cap(core);
  }
  // Hyphenated: each plain part capitalised; a small word inside stays small.
  return core
    .split('-')
    .map((p, i) => (!PLAIN.test(p) ? p : i > 0 && SMALL_WORDS.has(p) ? p : cap(p)))
    .join('-');
}

export function titleCase(text: string): string {
  const parts = text.split(/(\s+)/);
  // Mark each word's run position: first/last word of the text, or next to a separator.
  const words: Array<{ i: number; lead: string; core: string; trail: string; sep: boolean }> = [];
  parts.forEach((p, i) => {
    if (!p || /^\s+$/.test(p)) return;
    const m = /^([("'“‘[]*)(.*?)([)"'”’\],;!?.]*)$/.exec(p)!;
    words.push({ i, lead: m[1], core: m[2], trail: m[3], sep: SEPARATOR.test(p) });
  });
  const real = words.filter((w) => !w.sep);
  words.forEach((w, k) => {
    if (w.sep || !w.core) return;
    const prev = words[k - 1];
    const next = words[k + 1];
    const edge =
      w === real[0] ||
      w === real[real.length - 1] ||
      !prev ||
      prev.sep ||
      /:$/.test(prev.core + prev.trail) ||
      !next ||
      next.sep ||
      w.trail.includes(':');
    const core = w.core.endsWith(':') ? w.core.slice(0, -1) : w.core;
    const colon = w.core.endsWith(':') ? ':' : '';
    parts[w.i] = w.lead + word(core, edge) + colon + w.trail;
  });
  return parts.join('');
}

/** A caption or subtitle: stays sentence case, but starts with a capital (operator, 2026-09-26). */
export function sentenceStart(text: string): string {
  // Only a plain lowercase first word: "aDOT leaders" stays as it is (rule 3).
  const m = /^(\s*[("'“‘]*)([a-z]+(?:['’][a-z]+)?)(?=$|[\s,.;:)!?-])/.exec(text);
  return m && !ALWAYS_LOWER.has(m[2]) ? m[1] + cap(m[2]) + text.slice(m[0].length) : text;
}
