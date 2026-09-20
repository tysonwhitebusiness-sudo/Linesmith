import { extendTailwindMerge } from 'tailwind-merge';

/**
 * U0: `cx` was a plain join. It is now `tailwind-merge`, so a `className` passed
 * into a primitive REPLACES the base class it conflicts with instead of racing
 * it in the cascade — which is what every call site already assumed, and what
 * the adopted Untitled UI components assume outright.
 *
 * The extension exists because tailwind-merge has to be told which of our
 * `text-*` names are SIZES. Out of the box it reads `text-<anything>` it does
 * not recognise as a color, so `cx('text-label', 'text-ink')` would drop one of
 * the two — the type ramp and the ink role are not in conflict and both must
 * survive. Same story for the named motion tokens, which are not numbers.
 *
 * Adding a token to `@theme` in `app/globals.css` means adding it here too when
 * it lands in one of these groups. `tests/ui-primitives.test.ts` covers the
 * cases that actually bite.
 */
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      // The R3 type ramp (eight steps), the chart tick and the U spec's `field`.
      'font-size': [
        {
          text: [
            'display',
            'heading',
            'title',
            'card-title',
            'body',
            'body-sm',
            'label',
            'overline',
            'tick',
            'field',
          ],
        },
      ],
      // Motion tokens are names, not numbers, so the stock groups miss them.
      duration: [{ duration: ['instant', 'quick', 'smooth', 'data', 'live'] }],
      ease: [{ ease: ['standard', 'emphasized'] }],
    },
  },
});

/** Joins class names, dropping falsy entries, and resolves Tailwind conflicts. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return merge(parts.filter(Boolean).join(' '));
}
