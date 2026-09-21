'use client';

import { useState } from 'react';
import {
  Avatar,
  AvatarGroup,
  AvatarLabel,
  Button,
  CloseButton,
  IconButton,
  Card,
  Checkbox,
  Chip,
  DataTable,
  DrillDownPanel,
  Dropdown,
  Modal,
  Popover,
  SlideoutMenu,
  ComboBox,
  Field,
  Input,
  PickList,
  RadioGroup,
  SearchIcon,
  Select,
  Textarea,
  Toggle,
  EmptyState,
  FeaturedIcon,
  ErrorState,
  SegmentedToggle,
  SelectBox,
  Skeleton,
  StatGrid,
  StatValue,
  StatusPill,
  Tabs,
  Tag,
  Tooltip,
  cx,
} from '@/components/ui';
import { KitTables } from './KitTables';

/** One labelled block. The kit is a long page; every row says what it is. */
function Row({ name, note, children }: { name: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line-soft py-4 last:border-b-0">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-card-title text-ink">{name}</h3>
        {note ? <span className="text-label text-ink-muted">{note}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Group({ id, title, sub, children }: { id: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-6 first:mt-0">
      <h2 className="text-heading text-ink">{title}</h2>
      {sub ? <p className="mt-1 max-w-[70ch] text-body-sm text-ink-muted">{sub}</p> : null}
      <div className="mt-3 rounded-card border border-line-soft bg-card px-4 shadow-card">{children}</div>
    </section>
  );
}

const TYPE_RAMP: Array<[string, string, string]> = [
  ['text-display', '32 / 1.1 / 700', 'Display'],
  ['text-heading', '22 / 1.2 / 600', 'Heading'],
  ['text-title', '17 / 1.3 / 600', 'Title'],
  ['text-card-title', '14 / 1.3 / 600', 'Card title'],
  ['text-body', '14 / 1.5', 'Body — the default'],
  ['text-body-sm', '13 / 1.45', 'Body small — tables, card headers'],
  ['text-label', '12 / 1.35 / 500', 'Label'],
  ['text-overline', '11 / 1.3 / 600 / +0.04em', 'OVERLINE'],
  ['text-field', '16 / 1.4 — form fields below 768px only', 'Field (iOS zoom floor)'],
  ['text-tick', '10 — components/charts/ only', 'Chart tick'],
];

const SURFACES: Array<[string, string]> = [
  ['bg-paper', 'the page ground — DARKER than a card'],
  ['bg-card', 'a raised card'],
  ['bg-card-sunk', 'inset inside a card: toggle tracks, hover rows'],
];

const INK: Array<[string, string]> = [
  ['text-ink', 'primary'],
  ['text-ink-secondary', 'secondary'],
  ['text-ink-muted', 'the lightest grey allowed for TEXT'],
  ['text-ink-faint', 'DECORATION ONLY — never text'],
  ['text-ink-disabled', 'DECORATION ONLY — never text'],
];

const SEMANTIC: Array<[string, string]> = [
  ['good', 'hit, over, positive'],
  ['bad', 'miss, under, negative'],
  ['warn', 'caution'],
  ['cmp-a', 'compare slot A'],
  ['cmp-b', 'compare slot B'],
];

function PlusGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

export default function KitPage() {
  const [seg, setSeg] = useState('l10');
  const [tab, setTab] = useState('all');
  const [sel, setSel] = useState('2026');
  const [text, setText] = useState('');
  const [check, setCheck] = useState(true);
  const [radio, setRadio] = useState<'over' | 'under'>('over');
  const [on, setOn] = useState(false);
  const [sport, setSport] = useState('mlb');
  const [pick, setPick] = useState('a');
  const [modal, setModal] = useState(false);
  const [slide, setSlide] = useState(false);
  const [drill, setDrill] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-8">
      <header>
        <h1 className="text-display text-ink">The kit</h1>
        <p className="mt-2 max-w-[70ch] text-body text-ink-secondary">
          Every primitive in every state. Dev only — this page 404s in production. Check it at 1440
          and at 400 after any phase that changes a primitive.
        </p>
        <p className="mt-2 max-w-[70ch] text-body-sm text-ink-muted">
          U0 built the skeleton: the tokens, the primitives that exist today, and the Tailwind 4
          traps below. U1 adds the Button family, U2 the Hybrid table and the fifteen reference
          tables, U3 the field family, U4 the overlays, U5 the borrowed pieces, U6 the two table additions below.
        </p>
      </header>

      <Group id="type" title="Type" sub="Eight steps plus the chart tick and the form field. Nothing below 11px outside components/charts/.">
        {TYPE_RAMP.map(([cls, spec, sample]) => (
          <Row key={cls} name={cls} note={spec}>
            <span className={cx(cls, 'text-ink')}>{sample}</span>
          </Row>
        ))}
      </Group>

      <Group id="color" title="Color" sub="Every value lives in a CSS variable in app/globals.css; the theme only points at it.">
        <Row name="Surfaces" note="raised elevation — paper is darker than card">
          {SURFACES.map(([cls, what]) => (
            <div key={cls} className="flex items-center gap-2">
              <span className={cx('h-8 w-8 rounded-ctl border border-line', cls)} />
              <span className="text-label text-ink-muted">
                <span className="text-ink">{cls}</span> · {what}
              </span>
            </div>
          ))}
        </Row>
        <Row name="Ink">
          <div className="flex flex-col gap-1">
            {INK.map(([cls, what]) => (
              <span key={cls} className={cx('text-body-sm', cls)}>
                {cls} — {what}
              </span>
            ))}
          </div>
        </Row>
        <Row name="Semantic" note="functional signals, not brand identity">
          {SEMANTIC.map(([name, what]) => (
            <div key={name} className="flex items-center gap-2">
              <span className={cx('h-8 w-8 rounded-ctl', name === 'good' ? 'bg-good' : name === 'bad' ? 'bg-bad' : name === 'warn' ? 'bg-warn' : name === 'cmp-a' ? 'bg-cmp-a' : 'bg-cmp-b')} />
              <span className="text-label text-ink-muted">
                <span className="text-ink">{name}</span> · {what}
              </span>
            </div>
          ))}
        </Row>
        <Row name="Brand" note="graphite — `masters` is the primary">
          <span className="h-8 w-8 rounded-ctl bg-masters" />
          <span className="h-8 w-8 rounded-ctl bg-masters-dark" />
          <span className="h-8 w-8 rounded-ctl bg-masters-deep" />
          <span className="h-8 w-8 rounded-ctl bg-accent" />
          <span className="h-8 w-8 rounded-ctl bg-accent-soft" />
        </Row>
      </Group>

      <Group
        id="traps"
        title="Tailwind 4 traps"
        sub="U spec §9. Each of these was a real behaviour change in the 3.4 → 4 move and each is checked by eye here: the tints must have colour, the bare border must be `line` and not ink-dark, and the ring must be 1px in the colour it names."
      >
        <Row name="bg-good/10" note="tinted chip fill — alpha now compiles to color-mix()">
          <span className="rounded-ctl bg-good/10 px-3 py-1.5 text-body-sm text-good">good at 10%</span>
          <span className="rounded-ctl bg-bad/10 px-3 py-1.5 text-body-sm text-bad">bad at 10%</span>
          <span className="rounded-ctl bg-warn/10 px-3 py-1.5 text-body-sm text-warn">warn at 10%</span>
        </Row>
        <Row name="border-cmp-a/30" note="tinted border">
          <span className="rounded-ctl border border-cmp-a/30 bg-cmp-a/10 px-3 py-1.5 text-body-sm text-cmp-a">compare A</span>
          <span className="rounded-ctl border border-cmp-b/30 bg-cmp-b/10 px-3 py-1.5 text-body-sm text-cmp-b">compare B</span>
        </Row>
        <Row name="bg-ink/[0.08]" note="the table's magnitude bar — arbitrary alpha">
          <span className="relative block h-8 w-56 overflow-hidden rounded-ctl bg-card-sunk">
            <span className="absolute inset-y-[5px] left-0 w-2/3 rounded-[3px] bg-ink/[0.08]" />
            <span className="relative block px-3 py-1.5 text-body-sm text-ink">0.624</span>
          </span>
        </Row>
        <Row name="bare border" note="v4's default border colour is currentColor; globals.css pins it back to `line`">
          <span className="rounded-ctl border px-3 py-1.5 text-body-sm text-ink">no border-* class</span>
          <span className="rounded-ctl border border-line px-3 py-1.5 text-body-sm text-ink">border-line</span>
          <span className="rounded-ctl border border-line-soft px-3 py-1.5 text-body-sm text-ink">border-line-soft</span>
        </Row>
        <Row name="ring" note="v4's `ring` is 1px (was 3px); nothing in this app used it bare">
          <span className="rounded-ctl bg-card px-3 py-1.5 text-body-sm text-ink ring-2 ring-line">ring-2 ring-line</span>
        </Row>
        <Row name="outline-hidden" note="v4's `outline-none` sets outline-style:none; `outline-hidden` is v3's behaviour">
          <Button variant="secondary" size="sm">Tab to me — the focus ring must still show</Button>
        </Row>
        <Row name="named motion" note="v4 has no duration namespace, so these are @utility rules">
          {['duration-instant', 'duration-quick', 'duration-smooth', 'duration-data', 'duration-live'].map((d) => (
            <span key={d} className={cx('rounded-ctl bg-card-sunk px-3 py-1.5 text-body-sm text-ink-secondary transition-colors ease-standard hover:bg-accent-soft', d)}>
              {d}
            </span>
          ))}
        </Row>
      </Group>

      <Group id="shape" title="Shape and elevation">
        <Row name="Radius" note="8 control · 12 card · 16 hero">
          <span className="grid h-14 w-14 place-items-center rounded-ctl bg-card-sunk text-label text-ink-muted">ctl</span>
          <span className="grid h-14 w-14 place-items-center rounded-card bg-card-sunk text-label text-ink-muted">card</span>
          <span className="grid h-14 w-14 place-items-center rounded-card-hero bg-card-sunk text-label text-ink-muted">hero</span>
        </Row>
        <Row name="Shadow">
          <span className="grid h-14 w-24 place-items-center rounded-card bg-card text-label text-ink-muted shadow-card">card</span>
          <span className="grid h-14 w-24 place-items-center rounded-card bg-card text-label text-ink-muted shadow-card-hover">hover</span>
          <span className="grid h-14 w-24 place-items-center rounded-card bg-card text-label text-ink-muted shadow-pop">pop</span>
          <span className="grid h-14 w-24 place-items-center rounded-card bg-card text-label text-ink-muted shadow-drawer">drawer</span>
        </Row>
      </Group>

      <Group
        id="button"
        title="Button"
        sub="One primary per view — it is the main action. Behaviour is React Aria's: press, focus, and href routed through the root layout's RouterProvider, so a link-button navigates client-side rather than reloading the app."
      >
        <Row name="Variants" note="md, the default size">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="tertiary">Tertiary</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="destructive-secondary">Destructive secondary</Button>
        </Row>
        <Row name="Sizes" note="32 / 36 / 44 — 44 is the touch floor">
          <Button variant="primary" size="sm">Small</Button>
          <Button variant="primary" size="md">Medium</Button>
          <Button variant="primary" size="lg">Large</Button>
        </Row>
        <Row name="With icons" note="16px in sm, 18px in md and lg">
          <Button variant="secondary" icon={<PlusGlyph />}>Add to slip</Button>
          <Button variant="secondary" iconTrailing={<ChevronGlyph />}>Game page</Button>
          <Button variant="secondary" size="sm" icon={<PlusGlyph />}>Small with icon</Button>
        </Row>
        <Row name="Loading and disabled" note="a loading button keeps its label and its width, and ignores presses">
          <Button variant="primary" loading>Submitting</Button>
          <Button variant="secondary" loading>Refreshing</Button>
          <Button variant="primary" isDisabled>Disabled</Button>
          <Button variant="secondary" isDisabled>Disabled</Button>
        </Row>
        <Row name="As a link" note="href goes through RouterProvider — a client-side navigation">
          <Button variant="secondary" href="/kit#type">Jump to Type</Button>
        </Row>
        <Row name="IconButton" note="square, and aria-label is not optional">
          <IconButton size="sm" aria-label="Add" icon={<PlusGlyph />} />
          <IconButton size="md" aria-label="Add" icon={<PlusGlyph />} />
          <IconButton size="lg" aria-label="Add" icon={<PlusGlyph />} />
          <IconButton size="md" variant="secondary" aria-label="Add" icon={<PlusGlyph />} />
        </Row>
        <Row name="CloseButton">
          <CloseButton size="sm" />
          <CloseButton size="md" />
          <CloseButton size="lg" />
        </Row>
      </Group>

      <Group id="chip" title="Chip" sub="Semantic tones only, plus an identity dot. U5 moved every in-scope legacy chip here and deleted the three dead CSS recipes; diagnostics keeps its 16 until U6.">
        <Row name="Tones">
          {(['neutral', 'good', 'bad', 'warn', 'live', 'cmpA', 'cmpB', 'masters'] as const).map((t) => (
            <Chip key={t} tone={t}>
              {t}
            </Chip>
          ))}
        </Row>
        <Row name="Sizes and shapes">
          <Chip size="sm">sm pill</Chip>
          <Chip size="md">md pill</Chip>
          <Chip size="lg">lg pill</Chip>
          <Chip shape="box" size="sm">
            sm box
          </Chip>
          <Chip shape="box" size="md">
            md box
          </Chip>
        </Row>
        <Row name="StatusPill">
          <StatusPill>Final</StatusPill>
        </Row>
      </Group>

      <Group id="controls" title="Controls" sub="U1 added the Button family; the field family is its own group below.">
        <Row name="SegmentedToggle">
          <SegmentedToggle
            label="Window"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'l5', label: 'L5' },
              { value: 'l10', label: 'L10' },
              { value: 'season', label: 'Season' },
            ]}
          />
          <SegmentedToggle
            label="Window, small"
            size="sm"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'l5', label: 'L5' },
              { value: 'l10', label: 'L10' },
              { value: 'season', label: 'Season' },
            ]}
          />
          <SegmentedToggle
            label="View"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'l5', label: 'Table', icon: <PlusGlyph /> },
              { value: 'l10', label: 'Bars', icon: <PlusGlyph /> },
              { value: 'season', label: 'Lines', icon: <PlusGlyph /> },
            ]}
          />
        </Row>
        <Row name="Tabs">
          <Tabs
            label="Kit tabs"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'all', label: 'All', count: 2726 },
              { value: 'home', label: 'Home', count: 68 },
              { value: 'away', label: 'Away', count: 65 },
              { value: 'none', label: 'No count' },
            ]}
          />
        </Row>
        <Row name="SelectBox" note="the native select, kept for plain short lists">
          <SelectBox
            label="Season"
            value={sel}
            onChange={setSel}
            options={[
              { value: '2026', label: '2026' },
              { value: '2025', label: '2025' },
            ]}
          />
        </Row>
        <Row name="Tooltip" note="ours, not React Aria's — theirs never opens on touch">
          <Tooltip content="Hover, focus AND tap all open this.">
            <span className="cursor-help rounded-ctl border border-line bg-card px-3 py-1.5 text-body-sm text-ink">What is this?</span>
          </Tooltip>
        </Row>
      </Group>

      <Group
        id="pieces"
        title="Borrowed pieces"
        sub="Untitled UI's look on components we already own the rules for. The Avatar still falls back to a silhouette and never to initials; the Chip still only carries semantic tones."
      >
        <Row name="Avatar" note="silhouette fallback, never initials">
          <Avatar label="No photo" size={24} />
          <Avatar label="No photo" size={32} />
          <Avatar label="No photo" size={40} />
          <Avatar label="No logo" size={32} kind="logo" />
        </Row>
        <Row name="AvatarLabel" note="the standard person-or-team row: a photo, a name, and ONE sub-line">
          <AvatarLabel name="Marcus Semien" sub="NYM · 2B" size={24} />
          <AvatarLabel name="Marcus Semien" sub="NYM · 2B" size={32} />
          <AvatarLabel name="Marcus Semien" sub="NYM · 2B" size={40} />
        </Row>
        <Row name="AvatarGroup" note="overlapped, then +N">
          <AvatarGroup people={[{ key: 'a', name: 'Neal Shipley' }, { key: 'b', name: 'Ben Kohles' }, { key: 'c', name: 'Eric Cole' }]} />
          <AvatarGroup
            people={[
              { key: 'a', name: 'Neal Shipley' },
              { key: 'b', name: 'Ben Kohles' },
              { key: 'c', name: 'Eric Cole' },
              { key: 'd', name: 'Ricky Castillo' },
              { key: 'e', name: 'Max Greyserman' },
              { key: 'f', name: 'Marco Penge' },
            ]}
          />
        </Row>
        <Row name="Chip.dot" note="sport and status IDENTITY — a dot, not a tone, because a sport has no good or bad">
          <Chip dot="rgb(var(--good))">Grass</Chip>
          <Chip dot="rgb(var(--bad))">Clay</Chip>
          <Chip dot="oklch(var(--ink-muted))">Hard</Chip>
          <Chip dot="rgb(var(--cmp-a))">MLB</Chip>
        </Row>
        <Row name="Tag" note="removable — the compare targets on the player and team pages">
          <Tag label="Aaron Judge" onRemove={() => {}} />
          <Tag label="New York" dot="rgb(var(--cmp-a))" onRemove={() => {}} />
          <Tag label="Not removable" />
        </Row>
        <Row name="FeaturedIcon" note="40px; what an empty or error state leads with instead of grey text">
          <FeaturedIcon icon={<PlusGlyph />} />
          <FeaturedIcon icon={<PlusGlyph />} tone="good" />
          <FeaturedIcon icon={<PlusGlyph />} tone="bad" />
          <FeaturedIcon icon={<PlusGlyph />} tone="warn" />
          <FeaturedIcon icon={<PlusGlyph />} variant="outline" />
        </Row>
      </Group>

      <Group
        id="fields"
        title="Fields"
        sub="U3. Every field is 16px below 768px so iOS does not zoom on focus, and body above. Select and ComboBox are React Aria: a button trigger and a popover list."
      >
        <Row name="Input" note="sm 32 · md 36 · lg 44; leading icon; hint; error">
          <Field label="Player" hint="Search by name." htmlFor="kit-in" className="w-64">
            <Input id="kit-in" leading={SearchIcon} placeholder="Search players…" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Field label="Line" error="A line is a number like 1.5." htmlFor="kit-bad" className="w-40">
            <Input id="kit-bad" size="sm" invalid defaultValue="one and a half" />
          </Field>
          <Input size="lg" placeholder="lg — login" aria-label="Large input" className="w-56" />
        </Row>
        <Row name="Textarea">
          <Textarea aria-label="Notes" placeholder="Notes…" className="w-80" />
        </Row>
        <Row name="Checkbox · Radio · Toggle">
          <Checkbox isSelected={check} onChange={setCheck} hint="Hides players without a line.">
            Only priced
          </Checkbox>
          <RadioGroup
            label="Side"
            orientation="horizontal"
            value={radio}
            onChange={setRadio}
            options={[
              { value: 'over', label: 'Over' },
              { value: 'under', label: 'Under' },
            ]}
          />
          <Toggle isSelected={on} onChange={setOn}>
            Dense rows
          </Toggle>
        </Row>
        <Row name="Select" note="sizes sm and md; the header passes its own compact trigger">
          <Select
            label="Sport"
            value={sport}
            onChange={setSport}
            options={[
              { value: 'mlb', label: 'MLB' },
              { value: 'nfl', label: 'NFL', sub: 'Week 3' },
              { value: 'golf', label: 'Golf' },
            ]}
          />
          <Select label="Season" size="sm" value={sel} onChange={setSel} options={[{ value: '2026', label: '2026' }, { value: '2025', label: '2025' }]} />
        </Row>
        <Row name="ComboBox" note="filters as you type">
          <ComboBox
            label="Compare with"
            placeholder="Search 3 players…"
            className="w-64"
            onPick={setPick}
            options={[
              { value: 'a', label: 'Aaron Judge', sub: 'RF' },
              { value: 'b', label: 'Juan Soto', sub: 'RF' },
              { value: 'c', label: 'Cal Raleigh', sub: 'C' },
            ]}
          />
        </Row>
        <Row name="PickList" note="the master side of a master/detail page">
          <div className="w-64 rounded-card border border-line-soft p-1.5">
            <PickList
              label="Players"
              value={pick}
              onChange={setPick}
              items={[
                { key: 'a', label: 'Aaron Judge', sub: 'NYY · RF', badge: 12, group: 'Hitters' },
                { key: 'b', label: 'Juan Soto', sub: 'NYM · RF', badge: 9, group: 'Hitters' },
                { key: 'c', label: 'Tarik Skubal', sub: 'DET · SP', badge: 4, group: 'Pitchers' },
              ]}
            />
          </div>
        </Row>
      </Group>

      <Group
        id="overlays"
        title="Overlays"
        sub="U4. React Aria's: focus in on open and back on close, Tab trapped, Escape and the scrim close, the page stops scrolling. Below 768px a Modal is a bottom sheet and a SlideoutMenu is full width."
      >
        <Row name="Modal" note="400 · 560 · 720; footer right-aligned, stacked on a phone">
          <Button variant="secondary" onPress={() => setModal(true)}>
            Open a modal
          </Button>
          <Modal
            isOpen={modal}
            onClose={() => setModal(false)}
            width={400}
            title="Track this line"
            description="We will tell you when a book moves it."
            icon={<FeaturedIcon tone="neutral" icon={<PlusGlyph />} />}
            footer={
              <>
                <Button variant="secondary" onPress={() => setModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onPress={() => setModal(false)}>
                  Track
                </Button>
              </>
            }
          >
            <p className="text-body text-ink-secondary">Aaron Judge · Hits · Over 1.5</p>
          </Modal>
        </Row>
        <Row name="SlideoutMenu · DrillDownPanel" note="560 by default; DrillDownPanel is the SlideoutMenu with its old props">
          <Button variant="secondary" onPress={() => setSlide(true)}>
            Open a slideout
          </Button>
          <SlideoutMenu isOpen={slide} onClose={() => setSlide(false)} title="Every book" subtitle="Hits · Over 1.5" footer={<Button variant="secondary" onPress={() => setSlide(false)}>Done</Button>}>
            <p className="text-body text-ink-secondary">The body scrolls; the footer stays.</p>
          </SlideoutMenu>
          <Button variant="secondary" onPress={() => setDrill(true)}>
            Open a DrillDownPanel
          </Button>
          <DrillDownPanel open={drill} onClose={() => setDrill(false)} title="Line movement" subtitle="All books">
            <p className="text-body text-ink-secondary">Same panel, same props as before U4.</p>
          </DrillDownPanel>
        </Row>
        <Row name="Dropdown" note={lastAction ? `last action: ${lastAction}` : 'min width 240; sections; overline headers'}>
          <Dropdown
            label="Row actions"
            header="aaron.judge@example.com"
            trigger={<Button variant="secondary" iconTrailing={<ChevronGlyph />}>Actions</Button>}
            sections={[
              { id: 'a', items: [{ id: 'track', label: 'Track line', shortcut: 'T', onAction: () => setLastAction('track') }, { id: 'copy', label: 'Copy link', onAction: () => setLastAction('copy') }] },
              { id: 'b', title: 'Danger', items: [{ id: 'remove', label: 'Remove', onAction: () => setLastAction('remove') }] },
            ]}
          />
        </Row>
        <Row name="Popover" note="non-modal content from a trigger">
          <Popover label="What Heat means" trigger={<Button variant="tertiary">What is heat?</Button>}>
            <p className="text-body-sm text-ink-secondary">A cell tinted by where it sits in the column, not by whether it is good.</p>
          </Popover>
        </Row>
      </Group>

      <Group
        id="table-additions"
        title="Table additions"
        sub="U6. columnGroups puts a header row over the columns when a table compares two sides; ink colours a value that is good or bad by definition (under par), where tone would draw a W/L chip and heat would rank it."
      >
        <Row name="columnGroups" note="the pitch mix: what he throws beside what the batter sees">
          <div className="w-full max-w-md">
            <DataTable<{ k: string; p: string; a: string; av: string; b: string; bv: string }>
              caption="Pitch mix"
              density="compact"
              rowKey={(r) => r.k}
              columnGroups={[{ label: '', span: 1 }, { label: 'Skubal throws', span: 2 }, { label: 'Judge sees', span: 2 }]}
              rows={[
                { k: 'ff', p: 'Four-seam', a: '38.2%', av: '.301', b: '35.0%', bv: '.412' },
                { k: 'ch', p: 'Changeup', a: '27.5%', av: '.214', b: '11.8%', bv: '.288' },
              ]}
              columns={[
                { key: 'p', label: 'Pitch', sortable: false },
                { key: 'a', label: 'Share', numeric: true, sortable: false },
                { key: 'av', label: 'Outcome', numeric: true, sortable: false },
                { key: 'b', label: 'Share', numeric: true, sortable: false },
                { key: 'bv', label: 'Outcome', numeric: true, sortable: false },
              ]}
            />
          </div>
        </Row>
        <Row name="ink" note="under par good, over par bad, par plain">
          <div className="w-full max-w-md">
            <DataTable<{ id: string; name: string; h: number[] }>
              caption="Scorecard"
              density="compact"
              rowKey={(r) => r.id}
              rows={[
                { id: 'a', name: 'Bridgeman', h: [-1, 0, 1, -2, 0] },
                { id: 'b', name: 'James', h: [0, -1, 0, 0, 2] },
              ]}
              columns={[
                { key: 'name', label: '', sortable: false },
                ...[0, 1, 2, 3, 4].map((i) => ({
                  key: `h${i}`,
                  label: String(i + 1),
                  numeric: true,
                  sortable: false,
                  align: 'center' as const,
                  render: (r: { h: number[] }) => (r.h[i] === 0 ? 'E' : r.h[i] > 0 ? `+${r.h[i]}` : String(r.h[i])),
                  ink: (r: { h: number[] }) => (r.h[i] === 0 ? null : r.h[i] < 0 ? ('good' as const) : ('bad' as const)),
                })),
              ]}
            />
          </div>
        </Row>
      </Group>

      <Group id="stats" title="Stats">
        <Row name="StatValue">
          <StatGrid>
            <StatValue label="Hit rate" value="62.4%" rank={{ rank: 3, of: 30 }} percentile={88} direction="higher" />
            <StatValue label="Line" value="1.5" />
            <StatValue label="Move" value="-14" delta={{ value: '-14', better: false }} />
          </StatGrid>
        </Row>
      </Group>

      <KitTables />

      <Group id="card" title="Card and its states" sub="Loading, empty and error are built in, so a card cannot forget one.">
        <Row name="Ready">
          <div className="w-full max-w-[420px]">
            <Card title="Hitter stats" scope="2026 season" caption="148 games · as of today">
              <p className="text-body-sm text-ink-secondary">A card body.</p>
            </Card>
          </div>
        </Row>
        <Row name="Loading">
          <div className="w-full max-w-[420px]">
            <Card title="Hitter stats" state={{ kind: 'loading', lines: 3 }} />
          </div>
        </Row>
        <Row name="Empty">
          <div className="w-full max-w-[420px]">
            <Card title="Hitter stats" state={{ kind: 'empty', title: 'No games yet', reason: 'The season starts in October.' }} />
          </div>
        </Row>
        <Row name="Error">
          <div className="w-full max-w-[420px]">
            <Card title="Hitter stats" state={{ kind: 'error', message: 'Could not load the season.' }} />
          </div>
        </Row>
      </Group>

      <Group id="states" title="States on their own">
        <Row name="EmptyState" note="a reason is required">
          <EmptyState title="Nothing to show" reason="NHL has no props before the season starts." icon={<PlusGlyph />} />
        </Row>
        <Row name="ErrorState" note="stale data is kept under the message">
          <ErrorState message="Could not refresh the lines." icon={<PlusGlyph />} />
        </Row>
        <Row name="Skeleton">
          <Skeleton w={180} />
          <Skeleton w={120} />
          <Skeleton w={64} />
        </Row>
      </Group>
    </main>
  );
}
