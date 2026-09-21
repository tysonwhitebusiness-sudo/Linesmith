"""C0.3: `Column.percentile` on DataTable, rendered with PercentileCell. One-off."""

p = 'components/ui/DataTable.tsx'
s = open(p, encoding='utf-8').read()


def rep(old, new):
    global s
    assert old in s, old[:70]
    s = s.replace(old, new, 1)


rep("  ink?: (row: Row) => 'good' | 'bad' | null;",
    """  ink?: (row: Row) => 'good' | 'bad' | null;
  /**
   * C0.3: a value with its percentile under it (`PercentileCell`): the
   * Specials factor tables (C5). 0-100 within the pool; null prints the
   * value alone. `percentileDirection` flips the colour where less is better.
   */
  percentile?: (row: Row) => number | null | undefined;
  percentileDirection?: 'higher' | 'lower' | 'neutral';""")
rep("import { Chip } from './Chip';", "import { Chip } from './Chip';\nimport { PercentileCell } from './Stats';")
rep("            const ink = c.ink?.(row) ?? null;", "            const ink = c.ink?.(row) ?? null;\n            const pct = isTotals || !c.percentile ? undefined : c.percentile(row);")
rep("                  ) : ink ? (", """                  ) : c.percentile && pct !== undefined ? (
                    <PercentileCell value={v ?? '—'} percentile={pct} direction={c.percentileDirection} align={align(c) === 'left' ? 'left' : 'right'} />
                  ) : ink ? (""")
open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
