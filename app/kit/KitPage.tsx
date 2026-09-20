'use client';

import { useState } from 'react';
import {
  Avatar,
  Button,
  CloseButton,
  IconButton,
  Card,
  Chip,
  DataTable,
  EmptyState,
  ErrorState,
  SegmentedToggle,
  SelectBox,
  Skeleton,
  StatGrid,
  StatValue,
  StatusPill,
  Tabs,
  Tooltip,
  cx,
  type Column,
} from '@/components/ui';

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

interface KitRow {
  team: string;
  games: number;
  rate: number;
  diff: number;
}

const ROWS: KitRow[] = [
  { team: 'New York', games: 148, rate: 0.62, diff: 41 },
  { team: 'Boston', games: 147, rate: 0.55, diff: 12 },
  { team: 'Toronto', games: 149, rate: 0.48, diff: -6 },
  { team: 'Baltimore', games: 148, rate: 0.41, diff: -33 },
];

const COLUMNS: Column<KitRow>[] = [
  { key: 'team', label: 'Team', sortable: false },
  { key: 'games', label: 'G', numeric: true },
  {
    key: 'rate',
    label: 'Win%',
    numeric: true,
    render: (r) => `${(r.rate * 100).toFixed(1)}%`,
    sortValue: (r) => r.rate,
    bar: (r) => r.rate,
    strong: (r) => r.rate === Math.max(...ROWS.map((x) => x.rate)),
  },
  { key: 'diff', label: 'Diff', numeric: true, render: (r) => (r.diff > 0 ? `+${r.diff}` : String(r.diff)) },
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
          tables, U5 the borrowed pieces.
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

      <Group id="chip" title="Chip" sub="Semantic tones only. U5 adds `dot`, and the 33 in-scope `.lb-chip` uses move here.">
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

      <Group id="controls" title="Controls" sub="U1 adds the Button family, U3 the field family. These are what exists today.">
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
        </Row>
        <Row name="Tabs">
          <Tabs
            label="Kit tabs"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'all', label: 'All' },
              { value: 'home', label: 'Home' },
              { value: 'away', label: 'Away' },
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

      <Group id="avatar" title="Avatar" sub="Silhouette fallback, never initials. U5 adds AvatarLabel and AvatarGroup.">
        <Row name="Sizes">
          <Avatar label="No photo" size={24} />
          <Avatar label="No photo" size={32} />
          <Avatar label="No photo" size={40} />
          <Avatar label="No logo" size={32} kind="logo" />
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

      <Group id="table" title="DataTable" sub="U2 replaces this with the Hybrid and adds the fifteen reference tables.">
        <Row name="Default">
          <div className="w-full">
            <DataTable caption="Kit demo table" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.team} initialSort={{ key: 'rate', desc: true }} />
          </div>
        </Row>
        <Row name="Dense">
          <div className="w-full">
            <DataTable caption="Kit demo table, dense" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.team} dense />
          </div>
        </Row>
      </Group>

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
          <EmptyState title="Nothing to show" reason="NHL has no props before the season starts." />
        </Row>
        <Row name="ErrorState" note="stale data is kept under the message">
          <ErrorState message="Could not refresh the lines." />
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
