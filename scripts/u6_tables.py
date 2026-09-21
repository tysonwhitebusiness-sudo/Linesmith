"""U6: convert regular hand-rolled tables to the kit DataTable.

Handles the shape
    <table ...><thead><tr><th>Label</th>...</tr></thead>
    <tbody>{ROWS.map((r) => (<tr key={K}><td ...>X</td>...</tr>))}</tbody></table>
(with optional `, i` index and `=> {... return (<tr>...)}` bodies left alone).
Each td's text classes (not padding/alignment) are kept on a span around its
content. Prints what it converted and what it skipped, with the line.
Run: python scripts/u6_tables.py <file> [caption-prefix]
"""
import re
import sys

PAD = re.compile(r'^(p[xytrbl]?-|align-|w-|min-w-|max-w-|whitespace-|sticky|left-|z-|bg-paper|bg-card$|border|last:|first:)')


def find_close(src, start, name):
    depth, i = 0, start
    pat = re.compile(r'<(/?)' + name + r'\b[^>]*?(/?)>', re.S)
    while True:
        m = pat.search(src, i)
        if m.group(1) == '/':
            depth -= 1
            if depth == 0:
                return m.end()
        elif m.group(2) != '/':
            depth += 1
        i = m.end()


def text_classes(cls):
    keep = [c for c in cls.split() if not PAD.match(c)]
    return ' '.join(keep)


def attr(tag, name):
    m = re.search(r'\s' + name + r'=(\{[^}]*\}|"[^"]*")', tag)
    return m.group(1) if m else None


def convert_table(block, caption):
    thead = re.search(r'<thead>(.*?)</thead>', block, re.S)
    if not thead:
        return None, 'no thead'
    ths = re.findall(r'<th\b([^>]*?)(?:/>|>(.*?)</th>)', thead.group(1), re.S)
    if re.search(r'colSpan', thead.group(1)):
        return None, 'colSpan'
    body = re.search(r'<tbody>\s*\{\s*([\w.?()\[\]!]+)\.map\(\((\w+)(?:,\s*(\w+))?\)\s*=>\s*\(\s*(<tr\b.*?</tr>)\s*\)\)\s*\}\s*</tbody>', block, re.S)
    if not body:
        return None, 'tbody not a plain map'
    rows, var, idx, tr = body.group(1), body.group(2), body.group(3), body.group(4)
    tr_open = re.match(r'<tr\b([^>]*)>', tr, re.S).group(1)
    key = attr(tr_open, 'key')
    if not key:
        return None, 'no row key'
    tds, i = [], tr.index('>') + 1
    while True:
        m = re.compile(r'<td\b').search(tr, i)
        if not m:
            break
        end = find_close(tr, m.start(), 'td')
        cell = tr[m.start():end]
        om = re.match(r'<td\b(.*?)>', cell, re.S)
        # opening tag end honoring braces
        d, j = 0, 3
        while True:
            c = cell[j]
            if c == '{':
                d += 1
            elif c == '}':
                d -= 1
            elif c == '>' and d == 0:
                break
            j += 1
        open_tag = cell[:j + 1]
        inner = cell[j + 1:-len('</td>')]
        tds.append((open_tag, inner))
        i = end
    if len(tds) != len(ths):
        return None, f'{len(tds)} tds vs {len(ths)} ths'
    if idx:
        return None, 'row index used'
    cols = []
    for n, ((th_attrs, th_inner), (open_tag, inner)) in enumerate(zip(ths, tds)):
        label = re.sub(r'\s+', ' ', (th_inner or '').strip())
        if '{' in label or '<' in label:
            label_js = '<>' + label + '</>'
        else:
            label_js = repr(label).replace("\\'", "'") if "'" not in label else '"' + label + '"'
        cls_m = re.search(r'className="([^"]*)"', open_tag)
        dyn = re.search(r'className=\{', open_tag)
        if dyn:
            return None, 'dynamic td className'
        if re.search(r'\s(colSpan|style|onClick)=', open_tag):
            return None, 'td has colSpan/style/onClick'
        tc = text_classes(cls_m.group(1)) if cls_m else ''
        align = ''
        if cls_m and 'text-right' in cls_m.group(1):
            align = ", align: 'right'"
            tc = ' '.join(c for c in tc.split() if c != 'text-right')
        elif cls_m and 'text-center' in cls_m.group(1):
            align = ", align: 'center'"
            tc = ' '.join(c for c in tc.split() if c != 'text-center')
        content = inner.strip()
        render = f'<span className="{tc}">{content}</span>' if tc else f'<>{content}</>'
        cols.append(f"{{ key: 'c{n}', label: {label_js}, sortable: false{align}, render: ({var}) => ({render}) }}")
    out = (
        f'<DataTable\n  caption="{caption}"\n  density="compact"\n  rows={{{rows}}}\n'
        f'  rowKey={{({var}) => String({key[1:-1] if key.startswith("{") else key})}}\n'
        f'  columns={{[\n    ' + ',\n    '.join(cols) + '\n  ]}\n/>'
    )
    return out, None


def main():
    path, prefix = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else 'Table')
    src = open(path, encoding='utf-8').read()
    pos, n = 0, 0
    while True:
        m = re.compile(r'<table\b').search(src, pos)
        if not m:
            break
        end = find_close(src, m.start(), 'table')
        line = src.count('\n', 0, m.start()) + 1
        # caption from the nearest preceding h2/h3/p text
        before = src[max(0, m.start() - 3000):m.start()]
        heads = re.findall(r'<h[23][^>]*>([^<{]+)</h[23]>', before)
        caption = (heads[-1].strip() if heads else f'{prefix} {n + 1}').replace('"', "'")
        out, why = convert_table(src[m.start():end], caption)
        if out:
            src = src[:m.start()] + out + src[end:]
            print(f'converted line {line} ({caption})')
            pos = m.start() + len(out)
            n += 1
        else:
            print(f'SKIPPED line {line}: {why}')
            pos = end
    open(path, 'w', encoding='utf-8').write(src)


if __name__ == '__main__':
    main()
