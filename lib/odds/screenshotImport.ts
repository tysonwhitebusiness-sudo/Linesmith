/**
 * Screenshot → structured odds.
 *
 * One-shot only: the user takes a screenshot of their own bet slip or an odds
 * screen, and Claude reads it. Nothing here scrapes a sportsbook, polls a site,
 * or refreshes odds — it parses an image the user supplied, once.
 *
 * Anything that doesn't match a subject on the current slate is handed back for
 * the user to confirm rather than silently attached to the wrong player.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SubjectSummary } from '../core/types';
import { normalizeName } from '../core/normalizeName';

export { normalizeName } from '../core/normalizeName';

export interface ExtractedLeg {
  subjectName: string;
  dimensionLabel: string;
  categoryLabel: string;
  americanOdds: string;
}

export interface MatchedLeg extends ExtractedLeg {
  subjectId: string;
  matchedName: string;
  confidence: number;
}

export interface ImportResult {
  matched: MatchedLeg[];
  /** Extracted but not confidently tied to anyone on the slate. */
  unmatched: Array<ExtractedLeg & { suggestions: Array<{ subjectId: string; subjectName: string; confidence: number }> }>;
  warnings: string[];
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    legs: {
      type: 'array',
      description: 'Every distinct wager visible in the screenshot.',
      items: {
        type: 'object',
        properties: {
          subjectName: {
            type: 'string',
            description: 'The player or team the wager is on, exactly as printed.',
          },
          dimensionLabel: {
            type: 'string',
            description:
              'What is being measured, e.g. "Hole 7", "Hits", "1st inning". Empty string if not shown.',
          },
          categoryLabel: {
            type: 'string',
            description:
              'The outcome being wagered on, e.g. "Birdie or better", "Over 0.5", "No run". Empty string if not shown.',
          },
          americanOdds: {
            type: 'string',
            description: 'American odds exactly as printed, including sign, e.g. "+240" or "-115".',
          },
        },
        required: ['subjectName', 'dimensionLabel', 'categoryLabel', 'americanOdds'],
        additionalProperties: false,
      },
    },
  },
  required: ['legs'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You read a single screenshot from a sports betting app and extract the wagers shown.

Rules:
- Report only what is legibly printed in the image. Never infer, complete, or correct a name, a market, or a price.
- If a field is not visible, return an empty string for it rather than guessing.
- Preserve the odds exactly as printed, including the leading + or -.
- If the image contains no betting selections at all, return an empty list.`;

/** Media types the vision API accepts. */
const SUPPORTED_MEDIA = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export async function extractLegsFromScreenshot(
  base64Image: string,
  mediaType: string,
): Promise<{ legs: ExtractedLeg[]; warnings: string[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env.local to use screenshot import.');
  }
  if (!SUPPORTED_MEDIA.includes(mediaType)) {
    throw new Error(`Unsupported image type "${mediaType}". Use PNG, JPEG, GIF or WebP.`);
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType as 'image/png', data: base64Image },
          },
          { type: 'text', text: 'Extract every wager shown in this screenshot.' },
        ],
      },
    ],
  });

  const warnings: string[] = [];

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to read this image.');
  }
  if (response.stop_reason === 'max_tokens') {
    warnings.push('The response was cut short — some legs may be missing from a long screenshot.');
  }

  const text = response.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text') {
    return { legs: [], warnings: [...warnings, 'No readable content came back from the model.'] };
  }

  let parsed: { legs?: ExtractedLeg[] };
  try {
    parsed = JSON.parse(text.text);
  } catch {
    return { legs: [], warnings: [...warnings, 'Could not parse the extraction result.'] };
  }

  return { legs: parsed.legs ?? [], warnings };
}

// ---------------------------------------------------------------------------
// Fuzzy matching against the live slate
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Score a screenshot name against a roster name.
 *
 * Handles the abbreviation case explicitly: "T. Kim" should match "Tom Kim" on
 * a shared surname plus a first initial, but must not outscore an exact match.
 */
export function scoreNameMatch(candidate: string, rosterName: string): number {
  const a = normalizeName(candidate);
  const b = normalizeName(rosterName);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aParts = a.split(' ').filter(Boolean);
  const bParts = b.split(' ').filter(Boolean);
  const aLast = aParts[aParts.length - 1];
  const bLast = bParts[bParts.length - 1];

  // Surname carries most of the signal.
  if (aLast === bLast && aParts.length > 1 && bParts.length > 1) {
    const aFirst = aParts[0];
    const bFirst = bParts[0];
    if (aFirst === bFirst) return 0.99;
    // Initial-only form: "t" vs "tom".
    if (aFirst.length === 1 || bFirst.length === 1) {
      return aFirst[0] === bFirst[0] ? 0.92 : 0.4;
    }
    // Nickname or shortened first name: "mike" vs "michael".
    if (bFirst.startsWith(aFirst) || aFirst.startsWith(bFirst)) return 0.9;
    return 0.75;
  }

  // Last-name-only entry, e.g. "Scheffler".
  if (aParts.length === 1 && aLast === bLast) return 0.85;

  return similarity(a, b) * 0.8;
}

/** Confidence at or above this auto-fills; anything less asks the user. */
const AUTO_MATCH_THRESHOLD = 0.85;
/** How much clear water a top match needs over the runner-up. */
const AMBIGUITY_MARGIN = 0.05;

export function matchLegsToSubjects(legs: ExtractedLeg[], subjects: SubjectSummary[]): ImportResult {
  const matched: MatchedLeg[] = [];
  const unmatched: ImportResult['unmatched'] = [];
  const warnings: string[] = [];

  if (subjects.length === 0) {
    return {
      matched: [],
      unmatched: legs.map((leg) => ({ ...leg, suggestions: [] })),
      warnings: ['No players are loaded for this sport, so nothing could be matched.'],
    };
  }

  for (const leg of legs) {
    const ranked = subjects
      .map((subject) => ({
        subjectId: subject.subjectId,
        subjectName: subject.subjectName,
        confidence: scoreNameMatch(leg.subjectName, subject.subjectName),
      }))
      .sort((a, b) => b.confidence - a.confidence);

    const best = ranked[0];
    const runnerUp = ranked[1];

    const confident =
      best &&
      best.confidence >= AUTO_MATCH_THRESHOLD &&
      (!runnerUp || best.confidence - runnerUp.confidence >= AMBIGUITY_MARGIN);

    if (confident) {
      matched.push({
        ...leg,
        subjectId: best.subjectId,
        matchedName: best.subjectName,
        confidence: best.confidence,
      });
    } else {
      unmatched.push({ ...leg, suggestions: ranked.slice(0, 3) });
    }
  }

  if (unmatched.length > 0) {
    warnings.push(`${unmatched.length} leg(s) need confirming — they didn't match a player clearly enough to fill in automatically.`);
  }

  return { matched, unmatched, warnings };
}
