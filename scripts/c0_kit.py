"""C0.3: tokens + kit additions (one-off). Run: python scripts/c0_kit.py"""

def edit(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        assert old in s, (path, old[:60])
        s = s.replace(old, new, 1)
    open(path, 'w', encoding='utf-8', newline='').write(s)


edit('app/globals.css', [
    ("    --warn-ink: 154 98 0; /* #9a6200 */",
     "    --warn-ink: 154 98 0; /* #9a6200 */\n    /* Dark text ON a solid good fill (the W square, a hit dot): #04311a. */\n    --good-on: 4 49 26;"),
    ("  --color-warn-ink: rgb(var(--warn-ink));",
     "  --color-warn-ink: rgb(var(--warn-ink));\n  --color-good-on: rgb(var(--good-on));"),
    ("/* U4 overlay motion. */",
     "/* C0 `Collapse` peek (C2.4): open a little, hold, close, once per viewer. */\n@keyframes lb-peek {\n  0% { max-height: 0; }\n  32% { max-height: 96px; }\n  62% { max-height: 96px; }\n  100% { max-height: 0; }\n}\n\n/* U4 overlay motion. */"),
])

edit('components/ui/Chip.tsx', [
    ("export type ChipTone = 'neutral' | 'good' | 'bad' | 'warn' | 'live' | 'cmpA' | 'cmpB' | 'strong' | 'masters';",
     "export type ChipTone = 'neutral' | 'good' | 'bad' | 'warn' | 'live' | 'cmpA' | 'cmpB' | 'strong' | 'masters' | 'onColor';"),
    ("  masters: 'border-masters bg-masters text-white',\n};",
     "  masters: 'border-masters bg-masters text-white',\n  // C0.3: a translucent white chip on a coloured band (the player/team hero).\n  onColor: 'border-white/20 bg-white/15 text-white',\n};"),
])

edit('components/ui/Avatar.tsx', [
    ("  decorative?: boolean;\n  className?: string;\n}",
     "  decorative?: boolean;\n  /** C0.3: a 3px white ring on a translucent disc, for a headshot overlapping a coloured hero band. */\n  ring?: boolean;\n  className?: string;\n}"),
    ("export function Avatar({ label, src, fallbackSrc, size = 32, kind = 'player', rounded, teamColor, href, decorative, className }: AvatarProps) {",
     "export function Avatar({ label, src, fallbackSrc, size = 32, kind = 'player', rounded, teamColor, href, decorative, ring, className }: AvatarProps) {"),
    ("    kind === 'logo' ? 'border border-line-soft bg-card' : '',\n    className,\n  );",
     "    kind === 'logo' ? 'border border-line-soft bg-card' : '',\n    ring && 'bg-white/12 ring-[3px] ring-white/85',\n    className,\n  );"),
])

pieces = 'components/ui/Pieces.tsx'
s = open(pieces, encoding='utf-8').read()
s = s.replace("import { Avatar } from './Avatar';\nimport { cx } from './cx';", "import { Avatar } from './Avatar';\nimport { Tooltip } from './Tooltip';\nimport { cx } from './cx';", 1)
s = s.replace("  size?: 24 | 32;\n  className?: string;\n}", "  size?: 18 | 20 | 24 | 32;\n  /** C0.3: name every mark in a Tooltip on the group (book marks, whose logos don't explain themselves). */\n  tooltip?: boolean;\n  className?: string;\n}", 1)
s = s.replace("export function AvatarGroup({ people, max = 4, size = 24, className }: AvatarGroupProps) {", "export function AvatarGroup({ people, max = 4, size = 24, tooltip, className }: AvatarGroupProps) {", 1)
a = s.index("  return (\n    <span className={cx('inline-flex items-center', className)} role=\"img\"")
b = s.index("    </span>\n  );\n}", a) + len("    </span>\n  );\n}")
body = s[a:b].replace("  return (\n    <span", "  const group = (\n    <span", 1)
body = body[: -len("    </span>\n  );\n}")] + "    </span>\n  );\n  return tooltip ? <Tooltip content={people.map((p) => p.name).join(', ')}>{group}</Tooltip> : group;\n}"
s = s[:a] + body + s[b:]
s += '''
/* ---------------------------------------------------------------- ResultMark */

export type ResultKind = 'W' | 'L' | 'D' | 'hit' | 'miss' | 'dnp';

/**
 * C0.3 `ResultMark`: the one mark for "what happened". Replaces the W/L
 * squares hand-rolled in the player hero and the Specials receipts.
 *
 * `square` (22px, radius 6) for a game result: W on the solid good fill with
 * dark text, L on solid bad with white, D neutral. `dot` (18px circle) for a
 * graded call: a tick for a hit, a cross for a miss, a dash for did not play.
 * A `mark` ("-4" for a golf round) replaces the letter; the square grows.
 */
export function ResultMark({
  result,
  mark,
  kind = 'square',
  label,
  className,
}: {
  result: ResultKind | null;
  mark?: string;
  kind?: 'square' | 'dot';
  label?: string;
  className?: string;
}) {
  const good = result === 'W' || result === 'hit';
  const bad = result === 'L' || result === 'miss';
  const tone = good ? 'bg-good text-good-on' : bad ? 'bg-bad text-white' : 'bg-card-sunk text-ink-secondary';
  const glyph =
    kind === 'dot'
      ? good
        ? '\\u2713'
        : bad
          ? '\\u2715'
          : '\\u2013'
      : (mark ?? (result === 'hit' ? 'W' : result === 'miss' ? 'L' : result === 'dnp' ? '\\u2013' : (result ?? '\\u00b7')));
  const name = label ?? (good ? 'Win' : bad ? 'Loss' : result === 'D' ? 'Draw' : result === 'dnp' ? 'Did not play' : 'No result');
  return (
    <span
      role="img"
      aria-label={name}
      className={cx(
        'inline-grid shrink-0 place-items-center font-bold tabular-nums',
        kind === 'dot' ? 'h-[18px] w-[18px] rounded-full text-overline' : 'h-[22px] min-w-[22px] rounded-[6px] px-1 text-label',
        tone,
        className,
      )}
    >
      <span aria-hidden>{glyph}</span>
    </span>
  );
}
'''
open(pieces, 'w', encoding='utf-8', newline='').write(s)

stats = 'components/ui/Stats.tsx'
s = open(stats, encoding='utf-8').read()
s = s.replace("import { Tooltip, TipRow } from './Tooltip';", "import { Tooltip, TipRow } from './Tooltip';\nimport { heatFill, heatInk } from '@/lib/ui/heat';", 1)
s += '''
/* ---------------------------------------------------------------- PercentileCell */

/**
 * C0.3 `PercentileCell`: a value, then its percentile ("98th pct") in the heat
 * ink, then a 3px bar in the heat fill. Hero tiles use it (C2) and the
 * Specials tables as a column (C5, `Column.percentile`).
 *
 * THE COLOUR IS THE PERCENTILE, not a verdict on the value: 98th is green
 * because it ranks high in its pool, `direction: 'lower'` flips it for a stat
 * where less is better, and a `neutral` stat gets the ramp's midpoint.
 */
export function PercentileCell({
  value,
  percentile,
  direction = 'higher',
  align = 'right',
  className,
}: {
  value: ReactNode;
  /** 0-100 within the pool; null prints the value alone. */
  percentile: number | null | undefined;
  direction?: StatDirection;
  align?: 'left' | 'right';
  className?: string;
}) {
  if (percentile == null || !Number.isFinite(percentile)) {
    return <span className={cx('tabular-nums text-ink', className)}>{value}</span>;
  }
  const p = Math.max(0, Math.min(100, Math.round(percentile)));
  const g = goodness(p, direction);
  const t = g == null ? 0.5 : g / 100;
  return (
    <span className={cx('inline-flex min-w-[64px] flex-col gap-0.5', align === 'right' ? 'items-end' : 'items-start', className)}>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
      <span className="text-overline font-semibold tabular-nums" style={{ color: heatInk(t) }}>
        {ordinal(p)} pct
      </span>
      <span aria-hidden className="block h-[3px] w-full overflow-hidden rounded-full bg-card-sunk">
        <span className="block h-full rounded-full" style={{ width: `${p}%`, background: heatFill(t) }} />
      </span>
    </span>
  );
}
'''
open(stats, 'w', encoding='utf-8', newline='').write(s)

edit('components/ui/index.ts', [
    ("export { Tag, AvatarLabel, AvatarGroup, FeaturedIcon, type TagProps, type AvatarLabelProps, type AvatarGroupProps, type FeaturedIconProps, type FeaturedIconTone } from './Pieces';",
     "export { Tag, AvatarLabel, AvatarGroup, FeaturedIcon, ResultMark, type TagProps, type AvatarLabelProps, type AvatarGroupProps, type FeaturedIconProps, type FeaturedIconTone, type ResultKind } from './Pieces';\nexport { Collapse } from './Collapse';"),
    ("export { StatValue, StatGrid, RankRow, LeagueStripRow, FactList, VizLegend, goodness,",
     "export { StatValue, StatGrid, RankRow, LeagueStripRow, FactList, VizLegend, PercentileCell, goodness,"),
])
print('ok')
