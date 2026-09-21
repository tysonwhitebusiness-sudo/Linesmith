"""U6: rewrite every native `title=` on a DOM tag into the kit Tooltip.

`<span title={x} className="…">…</span>` becomes
`<Tooltip content={x}><span className="…">…</span></Tooltip>`; a `key` on the
element moves to the Tooltip (it is now the outer element of a map). Adds the
Tooltip import. Run once: python scripts/u6_titles_to_tooltip.py <file>...
"""
import re
import sys


def attr_span(tag, name):
    """(start, end) of attribute `name=...` inside an opening tag, at brace depth 0."""
    i, depth = 0, 0
    while i < len(tag):
        c = tag[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        elif depth == 0 and tag.startswith(name + '=', i) and tag[i - 1].isspace():
            j = i + len(name) + 1
            if tag[j] in '"\'':
                q = tag[j]
                k = tag.index(q, j + 1) + 1
            else:  # {...}
                d, k = 0, j
                while True:
                    if tag[k] == '{':
                        d += 1
                    elif tag[k] == '}':
                        d -= 1
                        if d == 0:
                            k += 1
                            break
                    k += 1
            s = i
            while s > 0 and tag[s - 1].isspace():
                s -= 1
            return s, k, tag[j:k]
        i += 1
    return None


def open_tag_end(src, start):
    i, depth = start, 0
    while True:
        c = src[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        elif c == '>' and depth == 0:
            return i + 1
        i += 1


def element_end(src, start, name):
    """End index of the element opening at `start` (handles nesting of the same tag)."""
    end = open_tag_end(src, start)
    if src[end - 2] == '/':
        return end
    depth, i = 1, end
    pat = re.compile(r'<(/?)' + name + r'\b')
    while depth:
        m = pat.search(src, i)
        if m.group(1) == '/':
            depth -= 1
            i = src.index('>', m.end()) + 1
        else:
            oe = open_tag_end(src, m.start())
            if src[oe - 2] != '/':
                depth += 1
            i = oe
    return i


def convert(src):
    count = 0
    pos = 0
    while True:
        m = re.compile(r'<([a-z][a-zA-Z0-9]*)\b').search(src, pos)
        if not m:
            break
        oe = open_tag_end(src, m.start())
        tag = src[m.start():oe]
        a = attr_span(tag, 'title')
        if not a:
            pos = m.end()
            continue
        s, e, value = a
        content = value if value.startswith('{') else '{' + value + '}'
        new_tag = tag[:s] + tag[e:]
        key = attr_span(new_tag, 'key')
        key_attr = ''
        if key:
            ks, ke, kv = key
            key_attr = ' key=' + kv
            new_tag = new_tag[:ks] + new_tag[ke:]
        end = element_end(src, m.start(), m.group(1))
        element = new_tag + src[oe:end]
        wrapped = '<Tooltip' + key_attr + ' content=' + content + '>' + element + '</Tooltip>'
        src = src[:m.start()] + wrapped + src[end:]
        count += 1
        pos = m.start() + len('<Tooltip')
    return src, count


def ensure_import(src, path):
    if re.search(r'\bTooltip\b[^;]*from', src.split('export', 1)[0]) and re.search(r'import[^;]*\bTooltip\b', src):
        return src
    if path.startswith('components/ui/'):
        line = "import { Tooltip } from './Tooltip';\n"
    else:
        m = re.search(r"import \{([^}]*)\} from '(\./ui|@/components/ui|\.\./ui)';", src)
        if m:
            names = m.group(1).strip().rstrip(',')
            return src[:m.start()] + "import { " + names + ", Tooltip } from '" + m.group(2) + "';" + src[m.end():]
        line = "import { Tooltip } from '@/components/ui';\n"
    # after the last import
    last = list(re.finditer(r'^import .*?;\s*$', src, re.M | re.S))
    idx = last[-1].end() + 1 if last else 0
    return src[:idx] + line + src[idx:]


def main():
    for path in sys.argv[1:]:
        with open(path, encoding='utf-8') as fh:
            src = fh.read()
        out, n = convert(src)
        if n:
            out = ensure_import(out, path.replace('\\', '/'))
            with open(path, 'w', encoding='utf-8', newline='') as fh:
                fh.write(out)
        print(n, path)


if __name__ == '__main__':
    main()
