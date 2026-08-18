import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Graphite theme (2026-08): neutral grey brand identity replacing the
        // old "Masters green" palette. Token *names* are unchanged on purpose
        // — every page/component references these by name, so repointing the
        // values here is what actually reskins the app; nothing else needs
        // to be touched for plain chrome (nav, buttons, borders, text, page
        // and card backgrounds).
        // Every value below carries the `<alpha-value>` placeholder Tailwind
        // needs to support opacity modifiers (`bg-line/70`, `text-masters/30`,
        // etc.) — plain `oklch(...)` strings silently break those utilities.
        masters: {
          DEFAULT: 'oklch(20% 0.006 260 / <alpha-value>)',
          dark: 'oklch(14% 0.005 260 / <alpha-value>)',
          deep: 'oklch(10% 0.004 260 / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'oklch(55% 0.005 260 / <alpha-value>)',
          soft: 'oklch(89% 0.004 260 / <alpha-value>)',
        },
        // Result semantics: green = good, red = bad, amber = caution.
        // Untouched by the graphite reskin — these are functional signals
        // (hit rate, live status, positive/negative), not brand identity,
        // and stay exactly as they were.
        good: '#0f7a4f',
        bad: '#c23b2c',
        warn: '#c98a1f',
        paper: 'oklch(96% 0.002 260 / <alpha-value>)',
        card: 'oklch(93% 0.003 260 / <alpha-value>)',
        // Subtle inset surfaces used inside cards (score filter bars, header
        // fills) — distinct from the page background itself.
        surface: {
          subtle: 'oklch(96% 0.002 260 / <alpha-value>)',
          header: 'oklch(96% 0.002 260 / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'oklch(16% 0.004 260 / <alpha-value>)',
          secondary: 'oklch(32% 0.004 260 / <alpha-value>)',
          muted: 'oklch(50% 0.005 260 / <alpha-value>)',
          soft: 'oklch(60% 0.004 260 / <alpha-value>)',
          faint: 'oklch(68% 0.004 260 / <alpha-value>)',
          disabled: 'oklch(78% 0.004 260 / <alpha-value>)',
        },
        // `line` is the standard card border; `line-soft`/`line-hair` are
        // progressively lighter dividers for rows within a card.
        line: {
          DEFAULT: 'oklch(87% 0.004 260 / <alpha-value>)',
          soft: 'oklch(90% 0.004 260 / <alpha-value>)',
          hair: 'oklch(93% 0.003 260 / <alpha-value>)',
        },
        // Placeholder fill behind subject initials (SubjectAvatar) — sits
        // between `card` and `line` in lightness, distinct enough from both
        // to read as a deliberate placeholder rather than a stray surface.
        avatar: 'oklch(82% 0.005 260 / <alpha-value>)',
        // The one surface dark enough to need its own scale rather than a
        // token remap — GameHeroCard's live-inning band. Nothing in `ink-*`
        // covers text/accents sitting on a near-black ground.
        live: {
          bg: 'oklch(18% 0.004 260 / <alpha-value>)',
          green: 'oklch(88% 0.004 260 / <alpha-value>)',
          muted: 'oklch(45% 0.006 260 / <alpha-value>)',
          secondary: 'oklch(60% 0.005 260 / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // The full sitewide type scale — every card picks a role from this
      // list rather than an arbitrary text-[Npx] value. "display" sizes are
      // for the one anchor number a card is allowed; everything else is
      // for labels/body copy. See the design spec for the audit that
      // produced this list.
      fontSize: {
        micro: ['9px', { lineHeight: '1.3' }],
        label: ['10px', { lineHeight: '1.3' }],
        meta: ['11px', { lineHeight: '1.4' }],
        dense: ['12px', { lineHeight: '1.4' }],
        body: ['13px', { lineHeight: '1.5' }],
        emphasis: ['14px', { lineHeight: '1.45' }],
        title: ['16px', { lineHeight: '1.3' }],
        'display-sm': ['20px', { lineHeight: '1.1' }],
        'display-md': ['28px', { lineHeight: '1.05' }],
        'display-lg': ['44px', { lineHeight: '.95' }],
      },
      boxShadow: {
        // Neutral now that the page itself is graphite grey rather than warm
        // cream — a tinted shadow would read as arbitrary on a neutral ground.
        card: '0 1px 3px rgba(0, 0, 0, 0.06), 0 6px 16px -6px rgba(0, 0, 0, 0.10)',
        'card-hover': '0 2px 6px rgba(0, 0, 0, 0.10), 0 12px 24px -8px rgba(0, 0, 0, 0.16)',
        /** Expanded disclosures sit above the card they came from. */
        pop: '0 4px 10px rgba(0, 0, 0, 0.10), 0 16px 32px -12px rgba(0, 0, 0, 0.18)',
        /** Inner glow marking the one thing on the page that's actually live — the pulse dot carries the "live" signal, this glow is just depth. */
        live: 'inset 0 0 0 1px rgba(0, 0, 0, 0.16), inset 0 1px 10px rgba(0, 0, 0, 0.10)',
        drawer: '0 -8px 32px rgba(0, 0, 0, 0.18)',
        /** The one card allowed real elevation — see .lb-card-hero in globals.css. */
        hero: '0 1px 2px rgba(0, 0, 0, 0.04)',
      },
      borderRadius: {
        card: '10px',
        'card-hero': '14px',
      },
      keyframes: {
        // Slower and shallower than Tailwind's stock pulse: a live indicator
        // should register in peripheral vision, not compete with the numbers.
        'lb-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.82)' },
        },
        'lb-shimmer': {
          '0%': { backgroundPosition: '-160% 0' },
          '100%': { backgroundPosition: '260% 0' },
        },
        // The hero spotlight carousel's between-card transition — a small
        // slide-in-from-right paired with a fade, so cycling through
        // Leader/Top 3/Movers reads as one card handing off to the next
        // rather than a hard cut.
        'lb-fade-slide': {
          '0%': { opacity: '0', transform: 'translateX(8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'lb-pulse': 'lb-pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'lb-shimmer': 'lb-shimmer 1.6s ease-in-out infinite',
        'lb-fade-slide': 'lb-fade-slide 0.4s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
