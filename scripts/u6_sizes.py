"""U6: replace hand-typed `text-[Npx]` with the type ramp.

Snaps each size to the nearest step, never below 11px (U spec §2b):
  8-11.5 -> overline · 12-12.5 -> label · 13 -> body-sm · 14-15 -> body
  16-18 -> title · 20-26 -> heading
The ramp tokens carry a default weight (label 500, overline/title/heading
600) and overline a letter-spacing. A hand-typed size had neither, so where
the class string names no weight / tracking of its own, `font-normal` /
`tracking-normal` are added: the page keeps its weight and only the size
moves. Run: python scripts/u6_sizes.py <file>...
"""
import re
import sys

WEIGHTED = {'overline', 'label', 'title', 'heading', 'card-title'}


def token(px):
    if px < 12:
        return 'overline'
    if px < 13:
        return 'label'
    if px < 14:
        return 'body-sm'
    if px < 16:
        return 'body'
    if px < 20:
        return 'title'
    return 'heading'


QUOTES = '"\'`'


def segment(line, i, j):
    s = max(line.rfind(q, 0, i) for q in QUOTES)
    ends = [line.find(q, j) for q in QUOTES]
    ends = [e for e in ends if e != -1]
    e = min(ends) if ends else len(line)
    return s + 1, e


def fix_line(line):
    out = line
    while True:
        m = re.search(r'(?<![\w-])((?:[a-z-]+:)*)text-\[(\d+(?:\.\d+)?)px\]', out)
        if not m:
            return out
        variant, px = m.group(1), float(m.group(2))
        t = token(px)
        s, e = segment(out, m.start(), m.end())
        seg = out[s:e]
        extra = ''
        if not variant:
            if t in WEIGHTED and not re.search(r'(?<![\w-])font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b', seg):
                extra += ' font-normal'
            if t == 'overline' and not re.search(r'(?<![\w-])tracking-', seg):
                extra += ' tracking-normal'
        out = out[:m.start()] + variant + 'text-' + t + extra + out[m.end():]


def main():
    for path in sys.argv[1:]:
        with open(path, encoding='utf-8', newline='') as fh:
            src = fh.read()
        n = len(re.findall(r'text-\[\d+(?:\.\d+)?px\]', src))
        out = ''.join(fix_line(l) for l in src.splitlines(keepends=True))
        with open(path, 'w', encoding='utf-8', newline='') as fh:
            fh.write(out)
        print(n, path)


if __name__ == '__main__':
    main()
