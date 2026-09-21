"""U6: diagnostics' 16 legacy `.lb-chip` spans onto the kit Chip (one-off)."""
import re

P = 'app/diagnostics/page.tsx'
s = open(P, encoding='utf-8').read()


def rep(old, new, count=1):
    global s
    assert s.count(old) >= count, old[:80]
    s = s.replace(old, new)


# class maps -> tone maps
rep("""function statusBadge(status: string) {
  const map: Record<string, string> = {
    live: 'bg-good text-white',
    cached: 'bg-warn text-white',
    disabled: 'bg-bad text-white',
    unknown: 'bg-ink/10 text-ink-muted',
  };
  return `lb-chip text-overline tracking-normal font-semibold ${map[status] ?? map.unknown}`;
}""", """function statusTone(status: string): ChipTone {
  const map: Record<string, ChipTone> = { live: 'good', cached: 'warn', disabled: 'bad' };
  return map[status] ?? 'neutral';
}""")
rep("<span className={statusBadge(data.oddsApi.status)}>{data.oddsApi.status}</span>",
    "<Chip tone={statusTone(data.oddsApi.status)} size=\"sm\">{data.oddsApi.status}</Chip>")

rep("""const DOMINANCE_STYLE: Record<FeatureExplanation['label'], string> = {
  dominant: 'bg-masters/15 text-masters',
  meaningful: 'bg-good/15 text-good',
  minor: 'bg-ink/10 text-ink-muted',
  negligible: 'bg-ink/5 text-ink-muted',
};""", """const DOMINANCE_TONE: Record<FeatureExplanation['label'], ChipTone> = {
  dominant: 'strong',
  meaningful: 'good',
  minor: 'neutral',
  negligible: 'neutral',
};""")
rep("<span className={`lb-chip text-overline tracking-normal font-semibold ${DOMINANCE_STYLE[f.label]}`}>{f.label}</span>",
    "<Chip tone={DOMINANCE_TONE[f.label]} size=\"sm\">{f.label}</Chip>")

rep("""const DRIFT_STATUS_STYLE: Record<DriftResult['status'], string> = {
  'on-track': 'bg-good/15 text-good',
  underperforming: 'bg-bad/15 text-bad',
  'insufficient-sample': 'bg-ink/10 text-ink-muted',
  'no-active-model': 'bg-ink/5 text-ink-muted',
};""", """const DRIFT_STATUS_TONE: Record<DriftResult['status'], ChipTone> = {
  'on-track': 'good',
  underperforming: 'bad',
  'insufficient-sample': 'neutral',
  'no-active-model': 'neutral',
};""")
m = re.search(r"<span className=\{`lb-chip shrink-0 text-overline tracking-normal font-semibold \$\{DRIFT_STATUS_STYLE\[d\.status\]\}`\}>([\s\S]*?)</span>", s)
s = s[:m.start()] + '<Chip tone={DRIFT_STATUS_TONE[d.status]} size="sm" className="shrink-0">' + m.group(1) + '</Chip>' + s[m.end():]

rep("""const PITCHER_ROLE_BADGE_CLASS: Record<RankedPitcherRow['role'], string> = {
  starter: 'bg-accent-soft text-masters',
  closer: 'bg-warn/15 text-warn',
  reliever: 'bg-ink/8 text-ink-muted',
};""", """const PITCHER_ROLE_TONE: Record<RankedPitcherRow['role'], ChipTone> = {
  starter: 'strong',
  closer: 'warn',
  reliever: 'neutral',
};""")
m = re.search(r"<span className=\{`lb-chip text-overline tracking-normal font-semibold \$\{PITCHER_ROLE_BADGE_CLASS\[p\.role\]\}`\}>([\s\S]*?)</span>", s)
s = s[:m.start()] + '<Chip tone={PITCHER_ROLE_TONE[p.role]} size="sm">' + m.group(1) + '</Chip>' + s[m.end():]

# literal chips
pairs = [
    (r'<span\s+className="lb-chip bg-warn/15 text-warn"\s*>([\s\S]*?)</span>', 'warn'),
    (r'<span className="lb-chip bg-good/15 text-good">([\s\S]*?)</span>', 'good'),
    (r'<span className="lb-chip bg-bad/10 text-bad">([\s\S]*?)</span>', 'bad'),
    (r'<span className="lb-chip bg-ink-faint/10 text-ink-muted">([\s\S]*?)</span>', 'neutral'),
    (r'<span className="lb-chip bg-warn/10 text-warn">([\s\S]*?)</span>', 'warn'),
    (r'<span className="lb-chip bg-bad/10 text-bad text-overline font-normal tracking-normal">([\s\S]*?)</span>', 'bad'),
    (r'<span className="lb-chip bg-ink/5 text-overline font-normal tracking-normal text-ink-muted">([\s\S]*?)</span>', 'neutral'),
]
for pat, tone in pairs:
    s = re.sub(pat, lambda m: f'<Chip tone="{tone}" size="sm">' + m.group(1) + '</Chip>', s)
m = re.search(r"<span className=\{`lb-chip \$\{mean != null && mean > 0 \? 'bg-good/15 text-good' : 'bg-bad/10 text-bad'\}`\}>([\s\S]*?)</span>", s)
s = s[:m.start()] + "<Chip tone={mean != null && mean > 0 ? 'good' : 'bad'} size=\"sm\">" + m.group(1) + '</Chip>' + s[m.end():]

s = s.replace("import { Button, Chip, DataTable, Input, Modal, SearchIcon, SegmentedToggle, Tabs, Tooltip } from '@/components/ui';",
              "import { Button, Chip, DataTable, Input, Modal, SearchIcon, SegmentedToggle, Tabs, Tooltip, type ChipTone } from '@/components/ui';")
open(P, 'w', encoding='utf-8').write(s)
print('lb-chip left:', s.count('lb-chip'))
