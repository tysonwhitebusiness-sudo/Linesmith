"""C0: the kit page's Electric Turf + team colour + new pieces group. One-off."""

p = 'app/kit/KitPage.tsx'
s = open(p, encoding='utf-8').read()

s = s.replace("  Checkbox,\n  Chip,\n", "  Checkbox,\n  Chip,\n  Collapse,\n  PercentileCell,\n  ResultMark,\n", 1)
s = s.replace("import { KitTables } from './KitTables';", "import { KitTables } from './KitTables';\nimport { bandColors, bandGradient } from '@/lib/sports/shared/teamColors';", 1)
s = s.replace("  const [lastAction, setLastAction] = useState<string | null>(null);\n",
              "  const [lastAction, setLastAction] = useState<string | null>(null);\n  const [heroOpen, setHeroOpen] = useState(false);\n", 1)
s = s.replace("U4 the overlays, U5 the borrowed pieces, U6 the two table additions below.",
              "U4 the overlays, U5 the borrowed pieces, U6 the two table additions below, C0 Electric Turf and the team-colour pieces.")

anchor = '      <Group id="stats" title="Stats">'
group = '''      <Group
        id="turf"
        title="Electric Turf and team colour"
        sub="C0. The fill is for bars, dots and solid badges; text always uses the -ink shade. Team colour is the colour of player and team content; charcoal stays the frame, and green never marks structure."
      >
        <Row name="Palette" note="fill / ink / tint">
          {(['good', 'bad', 'warn'] as const).map((t) => (
            <span key={t} className="inline-flex items-center gap-2">
              <span className={cx('h-6 w-10 rounded-ctl', t === 'good' ? 'bg-good' : t === 'bad' ? 'bg-bad' : 'bg-warn')} />
              <span className={cx('text-body-sm font-semibold', t === 'good' ? 'text-good-ink' : t === 'bad' ? 'text-bad-ink' : 'text-warn-ink')}>{t}-ink text</span>
              <Chip tone={t}>{t} chip</Chip>
            </span>
          ))}
        </Row>
        <Row name="Team bands" note="bandColors(): white text at 4.5:1, or charcoal">
          {[
            { name: 'Vikings', c: { primary: '#4f2683', secondary: '#ffc62f' } },
            { name: 'Bengals', c: { primary: '#fb4f14', secondary: '#000000' } },
            { name: 'Saints (falls back)', c: { primary: '#d3bc8d', secondary: null } },
            { name: 'Golf (no team)', c: null },
          ].map(({ name, c }) => {
            const b = bandColors(c);
            return (
              <span key={name} className="inline-flex h-16 w-56 flex-col justify-center gap-1 rounded-card px-3 text-white" style={{ backgroundImage: bandGradient(b) }}>
                <span className="text-title">{name}</span>
                <span className="flex gap-1.5">
                  {b.accent ? (
                    <span className="rounded-full px-2 py-[3px] text-overline" style={{ background: b.accent.bg, color: b.accent.ink }}>
                      WR
                    </span>
                  ) : null}
                  <Chip tone="onColor">onColor chip</Chip>
                </span>
              </span>
            );
          })}
        </Row>
        <Row name="Avatar ring · AvatarGroup tooltip" note="the hero headshot; stacked book marks">
          <span className="inline-flex h-20 items-center rounded-card px-4" style={{ backgroundImage: bandGradient(bandColors({ primary: '#4f2683', secondary: null })) }}>
            <Avatar label="Aaron Jones" size={56} ring />
          </span>
          <AvatarGroup
            tooltip
            size={20}
            max={4}
            people={['draftkings', 'fanduel', 'betmgm', 'caesars', 'espnbet', 'fanatics'].map((b) => ({ key: b, name: b, kind: 'logo' as const }))}
          />
        </Row>
        <Row name="ResultMark" note="square: a game; dot: a graded call">
          <ResultMark result="W" />
          <ResultMark result="L" />
          <ResultMark result="D" />
          <ResultMark result="W" mark="-4" />
          <ResultMark result="hit" kind="dot" />
          <ResultMark result="miss" kind="dot" />
          <ResultMark result="dnp" kind="dot" />
        </Row>
        <Row name="PercentileCell" note="the colour is the percentile, not a verdict">
          <PercentileCell value="21.8%" percentile={98} />
          <PercentileCell value="119.1" percentile={62} />
          <PercentileCell value="4.02" percentile={12} />
          <PercentileCell value="3.10 ERA" percentile={88} direction="lower" />
          <PercentileCell value="—" percentile={null} />
        </Row>
        <Row name="Collapse · peek" note="once per viewer; not remembered; never with reduced motion">
          <div className="w-full max-w-md rounded-card border border-line-soft">
            <Button variant="tertiary" className="w-full justify-between" aria-expanded={heroOpen} aria-controls="kit-collapse" onPress={() => setHeroOpen((v) => !v)}>
              2026 season & form <span>{heroOpen ? 'Hide ▴' : 'Show ▾'}</span>
            </Button>
            <Collapse id="kit-collapse" open={heroOpen} peek="lb.kitPeekSeen">
              <div className="grid grid-cols-2 gap-3 p-3">
                <PercentileCell value="548 yds" percentile={76} align="left" />
                <PercentileCell value="4.7 ypc" percentile={64} align="left" />
              </div>
            </Collapse>
          </div>
        </Row>
      </Group>

'''
assert anchor in s
s = s.replace(anchor, group + anchor, 1)
open(p, 'w', encoding='utf-8', newline='').write(s)
print('ok')
