'use client';

import { useState, type ReactNode } from 'react';
import { SubjectAvatar, TeamLogo } from './SubjectAvatar';
import { C } from './GameHeroCard';

/**
 * Sport-agnostic pieces of the Live tab visual system — extracted from the
 * MLB-only primitives in `GameHeroCard.tsx` (`LiveTeamPanel`,
 * `LiveCenterStatus`, `CurrentPitcherSpotlight`/`CurrentBatterSpotlight`,
 * `InningStrip`, `LiveSubTabBar`) so every other sport's own Live tab
 * (`NhlLiveTab`, `NbaLiveTab`, etc.) gets the same dark live-band, pulse-dot,
 * spotlight-card visual language without re-implementing it or forcing MLB's
 * baseball-specific component to pretend to be generic. MLB's `LiveTab`
 * itself is untouched — it already works, and baseball's bases/innings
 * concepts don't generalize cleanly enough to be worth bending into this
 * shape retroactively.
 */

// ---------------------------------------------------------------------------
// Live band header — team panels + center score/status
// ---------------------------------------------------------------------------

export interface LiveBandTeamData {
  abbr: string;
  name?: string;
  logoUrl?: string;
  /** e.g. NHL "33 SOG", NBA "48% FG" — one compact stat line under the team name. Omit for nothing. */
  statLine?: string;
}

function LiveBandTeamPanel({ side, team }: { side: 'away' | 'home'; team: LiveBandTeamData }) {
  const away = side === 'away';
  return (
    <div className={`flex flex-col gap-2.5 px-[26px] py-7 ${away ? '' : 'items-end text-right'}`}>
      <div className={`flex items-center gap-3 ${away ? '' : 'flex-row-reverse'}`}>
        <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-white/5" style={{ border: `1px solid ${C.liveMuted}` }}>
          <TeamLogo logoUrl={team.logoUrl} abbreviation={team.abbr} size={36} />
        </div>
        <div>
          <div className="text-meta tracking-[.12em]" style={{ color: C.liveSecondary }}>{away ? 'AWAY' : 'HOME'}</div>
          <div className="text-display-sm font-bold tracking-[-.02em] text-white">{team.name ?? team.abbr}</div>
        </div>
      </div>
      {team.statLine ? <div className="text-body tabular-nums" style={{ color: C.liveSecondary }}>{team.statLine}</div> : null}
    </div>
  );
}

export function LiveBandHeader({
  away,
  home,
  isFinal,
  statusLabel,
  score,
  subLabel,
  extra,
}: {
  away: LiveBandTeamData;
  home: LiveBandTeamData;
  isFinal: boolean;
  /** e.g. NHL "2ND · 14:22", NBA "Q3 · 8:41", Soccer "67'". Shown next to the pulse dot when live. */
  statusLabel?: string;
  score: { away: number | string; home: number | string };
  /** e.g. "VGK leads" / tied text, or a tiebreak note for tennis. */
  subLabel?: string;
  /** Extra content under the score — MLB uses this for the bases diamond; other sports can slot in a power-play indicator, red-zone marker, etc. */
  extra?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr]" style={{ backgroundColor: C.liveBandBg }}>
      <LiveBandTeamPanel side="away" team={away} />
      <div
        className="flex flex-col items-center justify-center gap-2.5 px-[24px] py-7"
        style={{ borderLeft: `1px solid ${C.liveMuted}`, borderRight: `1px solid ${C.liveMuted}` }}
      >
        {isFinal ? (
          <span className="text-meta font-medium tabular-nums tracking-[.14em]" style={{ color: C.liveSecondary }}>FINAL</span>
        ) : (
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 animate-lb-pulse rounded-full" style={{ backgroundColor: C.liveGreen }} />
            <span className="text-meta font-medium tabular-nums tracking-[.14em]" style={{ color: C.liveGreen }}>
              {statusLabel ?? 'LIVE'}
            </span>
          </div>
        )}
        <div className="text-display-lg font-extrabold leading-none tabular-nums tracking-[-.04em] text-white">
          {score.away}–{score.home}
        </div>
        {subLabel ? <div className="text-dense" style={{ color: C.liveSecondary }}>{subLabel}</div> : null}
        {extra}
      </div>
      <LiveBandTeamPanel side="home" team={home} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spotlight card — "on the mound"/"at the plate" generalized to any role
// ---------------------------------------------------------------------------

export function LiveSpotlightCard({
  role,
  name,
  teamAbbr,
  teamLogoUrl,
  headshotUrl,
  statLine,
  border,
}: {
  /** e.g. "ON THE MOUND", "TOP SCORER", "AT SERVE" */
  role: string;
  name: string;
  teamAbbr: string;
  teamLogoUrl?: string;
  headshotUrl?: string;
  statLine: string;
  border?: 'right';
}) {
  return (
    <div className="flex items-center gap-3 px-[26px] py-4" style={border === 'right' ? { borderRight: `1px solid ${C.divider}` } : undefined}>
      <SubjectAvatar name={name} headshotUrl={headshotUrl} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-meta tracking-[.1em]" style={{ color: C.faintMono }}>
          <TeamLogo logoUrl={teamLogoUrl} abbreviation={teamAbbr} size={13} /> {role} · {teamAbbr}
        </div>
        <div className="truncate text-title font-semibold" style={{ color: C.ink }}>{name}</div>
        <div className="text-dense tabular-nums" style={{ color: C.recordText }}>{statLine}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Period/quarter/inning/set strip — generalized from InningStrip
// ---------------------------------------------------------------------------

export interface LiveSegment {
  label: string;
  away: number | string | null;
  home: number | string | null;
  /** Segment index/number this strip's `currentIndex` compares against. */
  index: number;
}

export function LivePeriodStrip({
  title,
  segments,
  currentIndex,
  totalsLine,
  renderDetail,
}: {
  /** e.g. "BY PERIOD", "BY QUARTER", "BY SET" */
  title: string;
  segments: LiveSegment[];
  currentIndex: number | null;
  /** e.g. "SOG 33–35", "FG 44%–48%" */
  totalsLine?: string;
  renderDetail?: (segment: LiveSegment) => ReactNode;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-2.5 px-[26px] py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
      <div className="flex items-center justify-between">
        <div className="text-meta tracking-[.12em]" style={{ color: C.faintMono }}>{title}</div>
        {totalsLine ? <div className="text-dense tabular-nums" style={{ color: C.recordText }}>{totalsLine}</div> : null}
      </div>
      <div className="flex gap-1.5">
        {segments.map((seg) => {
          const played = seg.away != null || seg.home != null;
          const current = seg.index === currentIndex;
          const isExpanded = expanded === seg.index;
          return (
            <button
              key={seg.index}
              type="button"
              disabled={!played || !renderDetail}
              onClick={() => setExpanded((e) => (e === seg.index ? null : seg.index))}
              className="flex-1 rounded-lg py-1.5 text-center disabled:cursor-default"
              style={{
                border: isExpanded
                  ? `1px solid ${C.olive}`
                  : played
                    ? (current ? `1px solid ${C.inningCurrentBorder}` : `1px solid ${C.divider}`)
                    : `1px dashed ${C.divider}`,
                backgroundColor: isExpanded || current ? C.inningCurrentBg : undefined,
                cursor: played && renderDetail ? 'pointer' : 'default',
              }}
            >
              <div className="text-label tabular-nums" style={{ color: played ? (current || isExpanded ? C.olive : C.faintMono) : C.inningFuture }}>{seg.label}</div>
              <div
                className="text-body tabular-nums"
                style={{ color: played ? (current || isExpanded ? C.olive : C.ink) : C.inningFuture, fontWeight: current || isExpanded ? 500 : 400 }}
              >
                {played ? `${seg.away ?? '–'} · ${seg.home ?? '–'}` : '·'}
              </div>
            </button>
          );
        })}
      </div>
      {expanded != null && renderDetail ? renderDetail(segments.find((s) => s.index === expanded)!) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Event timeline row — generalized from InningPlayRow
// ---------------------------------------------------------------------------

export function LiveEventRow({
  primary,
  secondary,
  badgeText,
  highlighted,
}: {
  primary: string;
  secondary?: string;
  badgeText?: string;
  /** Goal/scoring-play styling on the badge — matches InningPlayRow's RBI highlight. */
  highlighted?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5" style={{ borderTop: `1px solid ${C.divider}` }}>
      <div className="min-w-0">
        <span className="text-dense font-medium" style={{ color: C.ink }}>{primary}</span>
        {secondary ? <span className="text-dense" style={{ color: C.recordText }}> — {secondary}</span> : null}
      </div>
      {badgeText ? (
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-label font-medium tracking-[.04em]"
          style={{ backgroundColor: highlighted ? C.statusPillBg : C.tabTrack, color: highlighted ? C.olive : C.tabInactiveText }}
        >
          {badgeText}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-tab bar — generalized from LiveSubTabBar (any string-keyed tab list)
// ---------------------------------------------------------------------------

export function LiveSubTabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: T; label: string }>;
  active: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="flex gap-1.5 px-[26px] py-2.5" style={{ borderBottom: `1px solid ${C.divider}`, backgroundColor: C.tabTrack }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className="rounded-full px-3 py-1 text-dense font-medium tracking-[.04em]"
          style={{
            backgroundColor: active === t.key ? C.tabActiveBg : 'transparent',
            color: active === t.key ? C.tabActiveText : C.tabInactiveText,
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple box-score table — generalized from BoxScoreTable
// ---------------------------------------------------------------------------

export interface LiveBoxRow {
  id: string | number;
  name: string;
  headshotUrl?: string;
  /** Ordered to match `columns` — plain formatted strings, each sport formats its own decimals/units. */
  cells: string[];
}

export function LiveBoxTable({
  teamAbbr,
  teamLogoUrl,
  summaryLine,
  columns,
  rows,
  emptyLabel,
}: {
  teamAbbr: string;
  teamLogoUrl?: string;
  summaryLine?: string;
  columns: string[];
  rows: LiveBoxRow[];
  emptyLabel: string;
}) {
  return (
    <div className="px-[26px] py-4">
      <div className="mb-2 flex items-center gap-2">
        <TeamLogo logoUrl={teamLogoUrl} abbreviation={teamAbbr} size={18} />
        <span className="text-title font-semibold" style={{ color: C.ink }}>{teamAbbr}</span>
        {summaryLine ? <span className="ml-auto text-dense tabular-nums" style={{ color: C.recordText }}>{summaryLine}</span> : null}
      </div>
      {rows.length === 0 ? (
        <p className="py-1 text-dense" style={{ color: C.faintMono }}>{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-dense">
            <thead>
              <tr style={{ color: C.faintMono }}>
                <th className="py-1 text-left font-medium">Player</th>
                {columns.map((c) => (
                  <th key={c} className="py-1 text-right font-medium">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      <SubjectAvatar name={r.name} headshotUrl={r.headshotUrl} size={20} />
                      <span className="truncate" style={{ color: C.ink }}>{r.name}</span>
                    </span>
                  </td>
                  {r.cells.map((cell, i) => (
                    <td key={i} className="py-1.5 text-right tabular-nums" style={{ color: C.ink }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty/loading state — matches MLB LiveTab's own copy pattern
// ---------------------------------------------------------------------------

export function LiveTabEmptyState({ loading, isFinal, notStartedText }: { loading: boolean; isFinal: boolean; notStartedText: string }) {
  return (
    <div className="px-[26px] py-10 text-center text-body" style={{ color: C.recordText }}>
      {loading ? 'Loading live details…' : isFinal ? 'Live details are unavailable for this game.' : notStartedText}
    </div>
  );
}
