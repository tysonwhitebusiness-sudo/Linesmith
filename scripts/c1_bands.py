"""C1: charcoal section bands (variant A). One-off; see the C1 commit."""
import re


def edit(path, pairs, count=1):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        assert old in s, (path, old[:70])
        s = s.replace(old, new, count)
    open(path, 'w', encoding='utf-8', newline='').write(s)


# 1. tokens
edit('app/globals.css', [
    ("    --good-on: 4 49 26;",
     "    --good-on: 4 49 26;\n    /* C1: the charcoal band (variant A). */\n    --char: 29 31 35; /* #1d1f23 */\n    --char3: 52 55 61; /* #34373d */\n    --char-ink: 244 245 247; /* #f4f5f7 */\n    --char-ink2: 167 171 179; /* #a7abb3 */\n    --char-rule: 110 114 122; /* #6e727a, the 2px top line */\n    --char-btn: 69 72 80; /* #454850, a band button's border */"),
    ("  --color-good-on: rgb(var(--good-on));",
     "  --color-good-on: rgb(var(--good-on));\n  --color-char: rgb(var(--char));\n  --color-char3: rgb(var(--char3));\n  --color-char-ink: rgb(var(--char-ink));\n  --color-char-ink2: rgb(var(--char-ink2));\n  --color-char-rule: rgb(var(--char-rule));\n  --color-char-btn: rgb(var(--char-btn));"),
])

# 2. each page's gutter, so a band bleeds exactly to it
import glob
for f in glob.glob('app/**/page.tsx', recursive=True) + ['components/AppShell.tsx']:
    f = f.replace('\\', '/')
    s = open(f, encoding='utf-8').read()
    o = s
    s = s.replace('<main className="mx-auto max-w-[1280px] px-3 py-3 md:px-6">', '<main className="mx-auto max-w-[1280px] px-3 py-3 [--lb-gutter:12px] md:px-6 md:[--lb-gutter:24px]">')
    s = s.replace('<main className="px-3 py-3">', '<main className="px-3 py-3 [--lb-gutter:12px]">')
    s = s.replace('<main className="space-y-3 px-3 py-3">', '<main className="space-y-3 px-3 py-3 [--lb-gutter:12px]">')
    s = s.replace('<main className="px-4 py-3">', '<main className="px-4 py-3 [--lb-gutter:16px]">')
    if s != o:
        open(f, 'w', encoding='utf-8', newline='').write(s)

# 3. Button: a variant for controls on a charcoal band
edit('components/ui/Button.tsx', [
    ("export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'link' | 'destructive' | 'destructive-secondary';",
     "export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'link' | 'destructive' | 'destructive-secondary' | 'onDark';"),
    ("  'destructive-secondary': 'bg-card text-bad-ink ring-1 ring-bad/25 ring-inset hover:bg-bad/5',",
     "  'destructive-secondary': 'bg-card text-bad-ink ring-1 ring-bad/25 ring-inset hover:bg-bad/5',\n  // C1: a control on a charcoal section band (the mockup's `.band .btn`).\n  onDark: 'bg-char3 text-char-ink ring-1 ring-char-btn ring-inset hover:brightness-110',"),
])

# 4. Section + SectionBand
sec = 'components/ui/Section.tsx'
s = open(sec, encoding='utf-8').read()
a = s.index('export function Section({ id, title, sub, children, className }')
b = s.index('export function SectionNav({')
s = s[:a] + '''/**
 * C1 (D-C3, variant A): the one section header. A full-bleed charcoal band
 * with a 2px `char-rule` top line; green never marks structure. It bleeds to
 * the page gutter each `<main>` declares as `--lb-gutter`, so it never
 * overflows a page with a narrower gutter (the right-edge bug, SL-25).
 * Research sections render it through `Section`; the Slate's sections use it
 * directly. `tests/ui-primitives` bans a page's own `<h2 className="text-title`.
 */
export function SectionBand({
  title,
  count,
  sub,
  right,
  className,
}: {
  title: ReactNode;
  count?: number | null;
  sub?: ReactNode;
  /** Controls at the band's right; on a phone they drop to their own row. */
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        'mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t-2 border-b border-t-char-rule border-b-char3 bg-char px-4 py-3.5 text-char-ink sm:flex-nowrap sm:px-6 sm:py-4',
        className,
      )}
      style={{ marginInline: 'calc(var(--lb-gutter, 0px) * -1)' }}
    >
      <h2 className="text-title text-char-ink sm:text-heading">{title}</h2>
      {count != null ? <span className="rounded-full bg-char3 px-2 py-0.5 text-label tabular-nums text-char-ink2">{count}</span> : null}
      {sub ? <span className="text-body-sm text-char-ink2">{sub}</span> : null}
      {right ? <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">{right}</div> : null}
    </div>
  );
}

export function Section({ id, title, sub, children, className }: { id: string; title: ReactNode; sub?: ReactNode; children: ReactNode; className?: string }) {
  const [collapsed, setCollapsed] = useState(false);
  const bodyId = `sec-body-${id}`;
  return (
    <section id={`sec-${id}`} data-sec={id} className={cx('mt-8 scroll-mt-[110px] first:mt-0', className)}>
      <SectionBand
        title={title}
        sub={sub}
        className={collapsed ? 'mb-0' : undefined}
        right={
          <Button variant="onDark" size="sm" onPress={() => setCollapsed((c) => !c)} aria-expanded={!collapsed} aria-controls={bodyId}>
            <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" className={cx('transition-transform', collapsed ? '-rotate-90' : '')}>
              <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {collapsed ? 'Show' : 'Hide'}
            <span className="sr-only"> {typeof title === 'string' ? title : 'section'}</span>
          </Button>
        }
      />
      <div id={bodyId} className="space-y-3" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}

''' + s[b:]
s = s.replace("import { cx } from './cx';", "import { Button } from './Button';\nimport { cx } from './cx';", 1)
s = s.replace("className={cx('sticky z-20 border-b border-line bg-paper/90 backdrop-blur',", "className={cx('sticky z-20 border-b border-char3 bg-paper/90 backdrop-blur',", 1)
open(sec, 'w', encoding='utf-8', newline='').write(s)
edit('components/ui/index.ts', [("export { Section, SectionNav } from './Section';", "export { Section, SectionBand, SectionNav } from './Section';")])

# 5. the Slate's own headings
H2 = '<h2 className="mb-2 text-title text-ink">'
for f, titles in {
    'components/slate/SlateMarket.tsx': ['Where the books differ'],
    'components/slate/SlateModel.tsx': ['Model'],
    'components/slate/SlateMovers.tsx': ['Movers'],
    'components/slate/SlateSpecials.tsx': ['Specials'],
    'components/slate/SlateSpotlights.tsx': ['Spotlights'],
    'components/slate/SlateYourLines.tsx': ['Your lines'],
    'components/AppShell.tsx': ['Winner prices', 'Props'],
    'components/slate/SlateSections.tsx': ['Games'],
}.items():
    s = open(f, encoding='utf-8').read()
    for t in titles:
        s = s.replace(f'{H2}{t}</h2>', f'<SectionBand title="{t}" />')
    if f == 'components/slate/SlateSections.tsx':
        s = s.replace('''      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-title text-ink">{games.noun === 'matches' ? 'Matches' : 'Games'}</h2>
        {games.cards.length > 0 ? (
          <SegmentedToggle
            label="Game status"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ value: f.value, label: `${f.label} ${count(f.value)}` }))}
          />
        ) : null}
      </div>''', '''      <SectionBand
        title={games.noun === 'matches' ? 'Matches' : 'Games'}
        right={
          games.cards.length > 0 ? (
            <SegmentedToggle
              label="Game status"
              size="sm"
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((f) => ({ value: f.value, label: `${f.label} ${count(f.value)}` }))}
            />
          ) : null
        }
      />''')
        # the sticky Slate nav gets the same 1px rule
        s = s.replace('className="lb-scroll-x sticky z-10 -mx-4 mb-3 flex gap-1 bg-paper/95 px-4 py-2 backdrop-blur"', 'className="lb-scroll-x sticky z-10 -mx-4 mb-3 flex gap-1 border-b border-char3 bg-paper/95 px-4 py-2 backdrop-blur"')
    assert '<h2 className="mb-2 text-title' not in s and '<h2 className="text-title text-ink">' not in s, f
    # import SectionBand from the kit
    m = re.search(r"import \{([^}]*)\} from '(@/components/ui|\./ui|\.\./ui)';", s)
    assert m, f
    if 'SectionBand' not in m.group(1):
        s = s[:m.start()] + "import {" + m.group(1).rstrip().rstrip(',') + ", SectionBand } from '" + m.group(2) + "';" + s[m.end():]
    open(f, 'w', encoding='utf-8', newline='').write(s)
print('ok')
