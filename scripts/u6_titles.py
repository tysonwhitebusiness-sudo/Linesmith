"""U6: count native `title=` on lowercase (DOM) JSX tags in scope.

Kit components take a `title` PROP (Card, Modal) — that is not a native
tooltip, so only lowercase tags count. Run: python scripts/u6_titles.py
"""
import os
import re
import sys

OUT = {
    'components/ScanTable.tsx', 'components/ScanCard.tsx', 'components/FilterBar.tsx',
    'components/FilterSidebar.tsx', 'components/PlayerFilterDrawer.tsx',
    'components/DateGameStrip.tsx', 'components/useFilters.ts', 'components/AppShell.tsx',
}


def tags_with_title(src):
    src = re.sub(r'/\*[\s\S]*?\*/', '', src)
    hits = []
    for m in re.finditer(r'<([a-z][a-zA-Z0-9]*)\b', src):
        i, depth = m.end(), 0
        while i < len(src):
            c = src[i]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
            elif c == '>' and depth == 0:
                break
            i += 1
        flat, d = [], 0
        for c in src[m.start():i]:
            if c == '{':
                d += 1
                if d == 1:
                    flat.append(c)
                continue
            if c == '}':
                d -= 1
                if d == 0:
                    flat.append(c)
                continue
            if d == 0:
                flat.append(c)
        if re.search(r'\stitle=', ''.join(flat)):
            hits.append((src.count('\n', 0, m.start()) + 1, m.group(1)))
    return hits


def main():
    total, per = 0, {}
    for root in ('components', 'app'):
        for dp, _dn, fn in os.walk(root):
            for f in fn:
                if not f.endswith('.tsx'):
                    continue
                p = os.path.join(dp, f).replace(os.sep, '/')
                if p in OUT:
                    continue
                with open(p, encoding='utf-8') as fh:
                    hits = tags_with_title(fh.read())
                if hits:
                    per[p] = hits
                    total += len(hits)
    for p, hits in sorted(per.items(), key=lambda kv: -len(kv[1])):
        print(len(hits), p, ' '.join(f'{ln}:{t}' for ln, t in hits[:12]) if '-v' in sys.argv else '')
    print('TOTAL', total)


if __name__ == '__main__':
    main()
