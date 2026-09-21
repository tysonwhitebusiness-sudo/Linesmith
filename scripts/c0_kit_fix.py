"""C0.3 repair: drop the duplicated tokens/keyframes, then apply only the kit
edits that didn't land (ResultMark, PercentileCell, exports). One-off."""
import re

css_path = 'app/globals.css'
css = open(css_path, encoding='utf-8').read()
dup_token = "    /* Dark text ON a solid good fill (the W square, a hit dot): #04311a. */\n    --good-on: 4 49 26;\n"
while css.count(dup_token) > 1:
    i = css.rindex(dup_token)
    css = css[:i] + css[i + len(dup_token):]
dup_color = "  --color-good-on: rgb(var(--good-on));\n"
while css.count(dup_color) > 1:
    i = css.rindex(dup_color)
    css = css[:i] + css[i + len(dup_color):]
blocks = list(re.finditer(r"/\* C0 `Collapse` peek[^\n]*\n@keyframes lb-peek \{[\s\S]*?\n\}\n\n", css))
for m in reversed(blocks[1:]):
    css = css[:m.start()] + css[m.end():]
open(css_path, 'w', encoding='utf-8', newline='').write(css)

exec(open('scripts/c0_kit.py', encoding='utf-8').read().split("pieces = 'components/ui/Pieces.tsx'")[1].split("edit('components/ui/index.ts'")[0].replace(
    "s = s.replace(\"import { Avatar } from './Avatar';\\nimport { cx } from './cx';\"", "s = s if 'ResultMark' in s else s").replace(
    "s = s.replace(\"  size?: 24 | 32;", "s = s  # already: size").replace(
    "s = s.replace(\"export function AvatarGroup(", "s = s  # already: signature"), {'pieces': 'components/ui/Pieces.tsx', 'stats': 'components/ui/Stats.tsx', '__builtins__': __builtins__}) if False else None

# Apply the two appends directly (the earlier run stopped before them).
from importlib.machinery import SourceFileLoader  # noqa: F401  (kept simple below)

src = open('scripts/c0_kit.py', encoding='utf-8').read()
result_mark = src[src.index("s += '''\n/* ---------------------------------------------------------------- ResultMark */") + len("s += '''"):]
result_mark = result_mark[: result_mark.index("'''")]
percentile = src[src.index("s += '''\n/* ---------------------------------------------------------------- PercentileCell */") + len("s += '''"):]
percentile = percentile[: percentile.index("'''")]
# The \\u escapes were written doubled for Python; in the file they must be single.
result_mark = result_mark.replace('\\\\u', '\\u')

p = 'components/ui/Pieces.tsx'
s = open(p, encoding='utf-8').read()
if 'export function ResultMark' not in s:
    s += result_mark
open(p, 'w', encoding='utf-8', newline='').write(s)

p = 'components/ui/Stats.tsx'
s = open(p, encoding='utf-8').read()
if "import { heatFill, heatInk } from '@/lib/ui/heat';" not in s:
    s = s.replace("import { Tooltip, TipRow } from './Tooltip';", "import { Tooltip, TipRow } from './Tooltip';\nimport { heatFill, heatInk } from '@/lib/ui/heat';", 1)
if 'export function PercentileCell' not in s:
    s += percentile
open(p, 'w', encoding='utf-8', newline='').write(s)

p = 'components/ui/index.ts'
s = open(p, encoding='utf-8').read()
if 'ResultMark' not in s:
    s = s.replace("FeaturedIcon, type TagProps", "FeaturedIcon, ResultMark, type TagProps", 1).replace("type FeaturedIconTone } from './Pieces';", "type FeaturedIconTone, type ResultKind } from './Pieces';\nexport { Collapse } from './Collapse';", 1)
if 'PercentileCell' not in s:
    s = s.replace("VizLegend, goodness,", "VizLegend, PercentileCell, goodness,", 1)
open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
