import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    // R3 3d BREAKPOINTS: 400 / 768 / 1024 / 1440 are the design targets. Declared
    // as the WHOLE ordered set (not `extend`), because Tailwind emits screens in
    // the order given and an extended `xs` would land after `2xl` and lose every
    // cascade. The defaults keep their values, so no existing class moves.
    screens: {
      xs: '400px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      wide: '1440px',
      '2xl': '1536px',
    },
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
        // R3: EVERY PALETTE VALUE LIVES IN A CSS VARIABLE (`app/globals.css`
        // :root), and these entries only point at it. Components that need a
        // color in an inline style or SVG attribute (`var(--good)`) then read
        // the same value Tailwind classes do, instead of a second literal.
        //
        // RAISED ELEVATION: paper is DARKER than card. Before R3 the card
        // (93%) sat below the paper (96%).
        //
        // TEXT ROLES: `ink-muted` is the lightest gray allowed for text and
        // passes AA on card, paper and card-sunk. `ink-faint` / `ink-disabled`
        // are DECORATION ONLY. F2 measured `ink-faint` as 41% of all text at
        // about 2.4:1; R3 moved every `text-ink-faint` / `text-ink-soft` to
        // `text-ink-muted`.
        good: 'rgb(var(--good) / <alpha-value>)',
        bad: 'rgb(var(--bad) / <alpha-value>)',
        warn: 'rgb(var(--warn) / <alpha-value>)',
        paper: 'oklch(var(--paper) / <alpha-value>)',
        card: {
          DEFAULT: 'oklch(var(--card) / <alpha-value>)',
          /** Inset surfaces inside a card: toggle tracks, hover rows, skeletons. */
          sunk: 'oklch(var(--card-sunk) / <alpha-value>)',
        },
        // Kept as names for existing callers; both resolve to `card-sunk`.
        surface: {
          subtle: 'oklch(var(--card-sunk) / <alpha-value>)',
          header: 'oklch(var(--card-sunk) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'oklch(var(--ink) / <alpha-value>)',
          secondary: 'oklch(var(--ink-secondary) / <alpha-value>)',
          muted: 'oklch(var(--ink-muted) / <alpha-value>)',
          soft: 'oklch(var(--ink-muted) / <alpha-value>)',
          faint: 'oklch(var(--ink-faint) / <alpha-value>)',
          disabled: 'oklch(var(--ink-disabled) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'oklch(var(--line) / <alpha-value>)',
          soft: 'oklch(var(--line-soft) / <alpha-value>)',
          hair: 'oklch(var(--line-hair) / <alpha-value>)',
        },
        // Compare slots (R10). Validated: worst colorblind deltaE 22.2.
        cmp: {
          a: 'rgb(var(--cmp-a) / <alpha-value>)',
          b: 'rgb(var(--cmp-b) / <alpha-value>)',
        },
        focus: 'oklch(var(--ink) / <alpha-value>)',
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
        // R3: the IBM Plex Mono load is gone (F2: loaded on every page, used by
        // one element). Numbers are sans with tabular figures.
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // THE TYPE RAMP (R3 3a, F2 section 1). Eight steps. Nothing below 11px
      // outside `components/charts/` (chart ticks are 10px, `text-tick`).
      // Hierarchy by size first, weight second, uppercase only with `overline`.
      //
      // R3 moved every use of the old ten-step scale onto this one by F2's
      // mapping: micro/label (9-10px) -> `overline` when the class list was
      // already uppercase, else `label`; meta/dense (11-12) -> `label`; the old
      // 13px `body` -> `body-sm`; emphasis (14) -> `body`; 16-20 -> `title`;
      // 28 -> `heading`; 44 -> `display`. Hand-typed `text-[Npx]` sizes are
      // replaced as each page is rebuilt (R6-R8), not mechanically here.
      fontSize: {
        display: ['32px', { lineHeight: '1.1', fontWeight: '700', letterSpacing: '-0.01em' }],
        heading: ['22px', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.005em' }],
        title: ['17px', { lineHeight: '1.3', fontWeight: '600' }],
        'card-title': ['14px', { lineHeight: '1.3', fontWeight: '600' }],
        body: ['14px', { lineHeight: '1.5' }],
        'body-sm': ['13px', { lineHeight: '1.45' }],
        label: ['12px', { lineHeight: '1.35', fontWeight: '500' }],
        overline: ['11px', { lineHeight: '1.3', fontWeight: '600', letterSpacing: '0.04em' }],
        /** Chart ticks only, inside `components/charts/`. */
        tick: ['10px', { lineHeight: '1.2' }],
      },
      boxShadow: {
        // Neutral now that the page itself is graphite grey rather than warm
        // cream — a tinted shadow would read as arbitrary on a neutral ground.
        // Raised elevation (G2 pick): a soft lift on every card.
        card: '0 1px 2px rgba(15, 18, 24, 0.05), 0 2px 8px -4px rgba(15, 18, 24, 0.08)',
        'card-hover': '0 2px 6px rgba(0, 0, 0, 0.10), 0 12px 24px -8px rgba(0, 0, 0, 0.16)',
        /** Expanded disclosures sit above the card they came from. */
        pop: '0 8px 28px -8px rgba(15, 18, 24, 0.28), 0 2px 6px rgba(15, 18, 24, 0.08)',
        /** Inner glow marking the one thing on the page that's actually live — the pulse dot carries the "live" signal, this glow is just depth. */
        live: 'inset 0 0 0 1px rgba(0, 0, 0, 0.16), inset 0 1px 10px rgba(0, 0, 0, 0.10)',
        drawer: '0 -8px 32px rgba(0, 0, 0, 0.18)',
        /** The one card allowed real elevation — see .lb-card-hero in globals.css. */
        hero: '0 1px 2px rgba(0, 0, 0, 0.04)',
      },
      // Radius: 12 card, 16 hero, 8 controls.
      borderRadius: {
        card: '12px',
        'card-hero': '16px',
        ctl: '8px',
      },
      // Motion (R3 3a). `live` is the value tween; the flash is `lb-flash`.
      transitionDuration: {
        instant: '100ms',
        quick: '180ms',
        smooth: '280ms',
        data: '450ms',
        live: '400ms',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
        emphasized: 'cubic-bezier(0.3, 0, 0, 1)',
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
        /** A live value that just changed. */
        'lb-flash': {
          '0%': { backgroundColor: 'rgb(15 122 79 / 0.22)' },
          '100%': { backgroundColor: 'transparent' },
        },
      },
      animation: {
        'lb-pulse': 'lb-pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'lb-shimmer': 'lb-shimmer 1.6s ease-in-out infinite',
        'lb-fade-slide': 'lb-fade-slide 0.4s ease-out',
        'lb-flash': 'lb-flash 1.2s cubic-bezier(0.2, 0, 0, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
