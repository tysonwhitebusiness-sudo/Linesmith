"""C0.3: the hero's hand-rolled W/L squares -> ResultMark. One-off."""
import re

p = 'components/PlayerResearchSections.tsx'
s = open(p, encoding='utf-8').read()
m = re.search(r"<span\n\s+className=\{cx\(\n\s+// A mark \(\"-4\"\) can be two characters[\s\S]*?\{g\.result \?\? g\.mark \?\? '·'\}\n\s+</span>", s)
assert m, 'hero squares not found'
s = s[:m.start()] + """<span>
                        <ResultMark
                          result={g.result ?? (g.tone === 'good' ? 'W' : g.tone === 'bad' ? 'L' : null)}
                          mark={g.result ? undefined : (g.mark ?? undefined)}
                          label={`${g.opponent}${g.result ? ` ${g.result}` : g.mark ? ` ${g.mark}` : ''}`}
                        />
                      </span>""" + s[m.end():]
s = s.replace("import { Avatar, Card, Chip, cx, DataTable,", "import { Avatar, Card, Chip, cx, DataTable, ResultMark,", 1)
open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
