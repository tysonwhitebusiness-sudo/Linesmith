"""U6: diagnostics' last 13 raw buttons onto the kit (one-off)."""
import re

P = 'app/diagnostics/page.tsx'
s = open(P, encoding='utf-8').read()


def element_end(src, start, name):
    depth, i = 0, start
    pat = re.compile(r'<(/?)' + name + r'\b')
    while True:
        m = pat.search(src, i)
        # find end of this tag honoring braces
        j, d = m.end(), 0
        while True:
            c = src[j]
            if c == '{':
                d += 1
            elif c == '}':
                d -= 1
            elif c == '>' and d == 0:
                break
            j += 1
        selfclose = src[j - 1] == '/'
        if m.group(1) == '/':
            depth -= 1
        elif not selfclose:
            depth += 1
        i = j + 1
        if depth == 0:
            return i


def replace_button(anchor, new, wrap_tooltip=False):
    """Replace the <button> (or <Tooltip><button>…</button></Tooltip>) containing `anchor`."""
    global s
    k = s.index(anchor)
    start = s.rfind('<button', 0, k)
    end = element_end(s, start, 'button')
    if wrap_tooltip:
        # keep the Tooltip wrapper: only swap the button inside it
        pass
    s = s[:start] + new + s[end:]


# 1. group bar -> Tabs
a = s.index('        <nav className="mt-2 flex gap-1 overflow-x-auto text-label font-normal">\n          {ADMIN_GROUPS.map((g) => (')
b = s.index('        </nav>\n', a) + len('        </nav>\n')
s = s[:a] + '''        <Tabs<AdminGroup>
          className="mt-2"
          label="Admin sections"
          value={activeGroup}
          onChange={setActiveGroup}
          items={ADMIN_GROUPS.map((g) => ({ value: g.id, label: g.label }))}
        />
''' + s[b:]

replace_button('View resume instructions', '''<Button variant="secondary" size="sm" className="shrink-0 text-warn" onPress={() => setShowNhlNbaResumeModal(true)}>
                      View resume instructions
                    </Button>''')
replace_button("{aiSummaryLoading ? 'Asking…' : 'Ask again'}", '''<Button variant="secondary" size="sm" isDisabled={aiSummaryLoading} onPress={() => fetchAiSummary(true)}>
                      {aiSummaryLoading ? 'Asking…' : 'Ask again'}
                    </Button>''')
replace_button("'Load pitcher rankings'", '''<Button variant="secondary" size="sm" isDisabled={pitcherRanksLoading} onPress={() => void fetchPitcherRanks(pitcherRanksLoaded)}>
                    {pitcherRanksLoading ? 'Loading…' : pitcherRanksLoaded ? 'Refresh now' : 'Load pitcher rankings'}
                  </Button>''')
replace_button("'Load batter rankings'", '''<Button variant="secondary" size="sm" isDisabled={batterRanksLoading} onPress={() => void fetchBatterRanks(batterRanksLoaded)}>
                    {batterRanksLoading ? 'Loading…' : batterRanksLoaded ? 'Refresh now' : 'Load batter rankings'}
                  </Button>''')

# filters -> SegmentedToggle (replace the whole map wrapper div)
a = s.index("                      {(['all', 'starter', 'closer', 'reliever'] as const).map((role) => (")
div0 = s.rfind('<div', 0, a)
div1 = element_end(s, div0, 'div')
s = s[:div0] + '''<SegmentedToggle
                      label="Pitcher role"
                      size="sm"
                      value={pitcherRoleFilter}
                      onChange={setPitcherRoleFilter}
                      options={(['all', 'starter', 'closer', 'reliever'] as const).map((role) => ({ value: role, label: role === 'all' ? 'All' : PITCHER_ROLE_LABEL[role] }))}
                    />''' + s[div1:]
a = s.index('                      {BATTER_POSITION_FILTERS.map((position) => (')
div0 = s.rfind('<div', 0, a)
div1 = element_end(s, div0, 'div')
s = s[:div0] + '''<SegmentedToggle
                      label="Batter position"
                      size="sm"
                      value={batterPositionFilter}
                      onChange={setBatterPositionFilter}
                      options={BATTER_POSITION_FILTERS.map((position) => ({ value: position, label: position === 'all' ? 'All' : position }))}
                    />''' + s[div1:]

replace_button('void fetchPickHistory(pickHistoryFrom || undefined, pickHistoryTo || undefined)', '''<Button variant="secondary" size="sm" onPress={() => void fetchPickHistory(pickHistoryFrom || undefined, pickHistoryTo || undefined)}>
                  Apply
                </Button>''')
k = s.index("setPickHistoryFrom('');\n                      setPickHistoryTo('');")
start = s.rfind('<button', 0, k)
end = element_end(s, start, 'button')
inner = s[s.index('>', s.index('className="text-ink-muted underline hover:text-masters"', start)) + 1:end - len('</button>')].strip()
s = s[:start] + '''<Button
                    variant="link"
                    size="sm"
                    onPress={() => {
                      setPickHistoryFrom('');
                      setPickHistoryTo('');
                      void fetchPickHistory();
                    }}
                  >
                    ''' + inner + '''
                  </Button>''' + s[end:]

for running, action, label in [
    ('backfillRunning', 'runBackfill', "{backfillRunning ? 'Running backfill…' : 'Run historical backfill'}"),
    ('gameBackfillRunning', 'runGameBackfill', "{gameBackfillRunning ? 'Running…' : 'Backfill'}"),
    ('totalBackfillRunning', 'runTotalBackfill', "{totalBackfillRunning ? 'Running…' : 'Backfill'}"),
]:
    replace_button(label, f'''<Button variant="secondary" size="sm" isDisabled={{{running}}} onPress={{() => void {action}()}}>
                  {label}
                </Button>''')
k = s.index('onClick={() => void runTotalBaselinesCheck()}')
start = s.rfind('<button', 0, k)
end = element_end(s, start, 'button')
inner = s[s.index('>', s.index('className=', start)) + 1:end - len('</button>')].strip()
s = s[:start] + '''<Button variant="secondary" size="sm" isDisabled={totalBaselinesRunning} onPress={() => void runTotalBaselinesCheck()}>
                    ''' + inner + '''
                  </Button>''' + s[end:]

s = s.replace("import { Button, Chip, DataTable, Input, Modal, SearchIcon, Tooltip } from '@/components/ui';",
              "import { Button, Chip, DataTable, Input, Modal, SearchIcon, SegmentedToggle, Tabs, Tooltip } from '@/components/ui';")
open(P, 'w', encoding='utf-8').write(s)
print('raw buttons left:', len(re.findall(r'<button\b', s)))
