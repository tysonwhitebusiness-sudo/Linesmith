"""C0: in-scope `text-good|bad|warn` -> `text-*-ink` (the fill is never text).

Skips the frozen Scan surface (tests/ui-scope.ts OUT_OF_SCOPE, plus Scan's cell
components StatCells/OddsChip), whose bytes are pinned; the global @utility
override in app/globals.css gives them the ink shade instead.
Run: python scripts/c0_ink_sweep.py
"""
import os
import re

SKIP = {
    'components/ScanTable.tsx', 'components/ScanCard.tsx', 'components/FilterBar.tsx',
    'components/FilterSidebar.tsx', 'components/PlayerFilterDrawer.tsx', 'components/DateGameStrip.tsx',
    'components/useFilters.ts', 'components/AppShell.tsx', 'components/SegmentedToggle.tsx',
    'components/StatCells.tsx', 'components/OddsChip.tsx',
}
PAT = re.compile(r'(?<![\w-])((?:[a-z-]+:)*)text-(good|bad|warn)(?![\w-])')

total = 0
for root in ('components', 'app', 'lib'):
    for dp, _dn, fn in os.walk(root):
        for f in fn:
            if not f.endswith(('.tsx', '.ts')):
                continue
            p = os.path.join(dp, f).replace(os.sep, '/')
            if p in SKIP:
                continue
            src = open(p, encoding='utf-8').read()
            out, n = PAT.subn(lambda m: f'{m.group(1)}text-{m.group(2)}-ink', src)
            if n:
                open(p, 'w', encoding='utf-8', newline='').write(out)
                total += n
                print(n, p)
print('TOTAL', total)
